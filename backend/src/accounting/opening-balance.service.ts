import { Injectable, Logger } from '@nestjs/common';
import { JournalEntryStatus, JournalSourceType, Prisma, SystemAccountKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountResolverService } from './account-resolver.service';
import { JournalService } from './journal.service';
import { endOfBusinessDay, resolveTimezone, todayBusinessDate, toBusinessDate } from './business-date';

export type OpeningSide = 'AR' | 'AP';

export type OpeningSideResult = {
  amount: number;
  // Business date the entry is dated on; null when nothing is owed either way.
  date: string | null;
  action: 'posted' | 'replaced' | 'removed' | 'unchanged' | 'none';
  // Documents dated after today: left out until their date arrives.
  futureDated: number;
  error?: string;
};

// One posted entry per side, replaced as the documents change.
const SOURCE_ID: Record<OpeningSide, string> = { AR: 'accurate:AR', AP: 'accurate:AP' };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Opening balances for documents that never posted to the ledger — the
// Accurate import's invoices, supplier bills and supplier payments (it
// brings history in without replaying it into the books), and anything
// issued before the ledger existed. Without them AR/AP in the books stay
// near zero while the aging reports show what's really owed.
//
// Each side's amount mirrors its aging report exactly, so the report's
// reconciliation holds for any date on or after the entry:
//   AR: for each ISSUED invoice with no posted INVOICE entry, what the AR
//       aging counts for it, minus what the ledger already holds for it
//       (its posted payments/refunds and posted sales returns).
//   AP: for each PO the AP aging covers, the imported bills it counts as
//       owed (POs with no goods receipt), minus supplier payments that
//       never posted (Accurate's payments, discounts and returns).
// The other side of both is Opening Balance Equity. Re-running after a
// re-import recomputes and replaces the entry, dated at the latest
// document it covers.
@Injectable()
export class OpeningBalanceService {
  private readonly logger = new Logger(OpeningBalanceService.name);

  constructor(
    private prisma: PrismaService,
    private journal: JournalService,
    private accounts: AccountResolverService,
  ) {}

  async sync(organizationId: string, userId?: string): Promise<Record<OpeningSide, OpeningSideResult>> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const tz = resolveTimezone(org);
    const asOf = endOfBusinessDay(todayBusinessDate(tz), tz);

    const [ar, ap] = await Promise.all([this.receivables(organizationId, asOf), this.payables(organizationId, asOf)]);
    return {
      AR: await this.apply(organizationId, 'AR', ar, tz, userId),
      AP: await this.apply(organizationId, 'AP', ap, tz, userId),
    };
  }

  private async receivables(organizationId: string, asOf: Date) {
    const [row] = await this.prisma.$queryRaw<{ amount: string | null; latest: Date | null; future: bigint }[]>(Prisma.sql`
      WITH unposted AS (
        SELECT i.id, i.total, i."amountPaid", i."creditedAmount", i."paymentStatus",
               COALESCE(i."issuedAt", i."invoiceDate") AS dated
        FROM "Invoice" i
        WHERE i."organizationId" = ${organizationId} AND i.status = 'ISSUED'
          AND NOT EXISTS (
            SELECT 1 FROM "JournalEntry" e
            WHERE e."organizationId" = ${organizationId} AND e."sourceType" = 'INVOICE'
              AND e."sourceId" = i.id AND e.status = 'POSTED')
      ), ledgered AS (
        -- Payment rows the ledger already has: posted payments/refunds, and
        -- credit applications (which move amountPaid but never post).
        SELECT p."invoiceId",
               SUM(CASE WHEN p.kind IN ('PAYMENT', 'CREDIT_IN') THEN p.amount ELSE -p.amount END) AS signed
        FROM "Payment" p
        JOIN unposted u ON u.id = p."invoiceId"
        WHERE p."voidedAt" IS NULL
          AND (p.kind IN ('CREDIT_IN', 'CREDIT_OUT') OR EXISTS (
            SELECT 1 FROM "JournalEntry" e
            WHERE e."organizationId" = ${organizationId} AND e."sourceType" = 'PAYMENT'
              AND e."sourceId" = p.id AND e.status = 'POSTED'))
        GROUP BY p."invoiceId"
      )
      SELECT
        -- AR aging: open invoices' remainder, less overpayments (customer
        -- credits); creditedAmount is added back since returns always post.
        SUM(CASE WHEN u."paymentStatus" <> 'PAID' THEN u.total - u."amountPaid" - u."creditedAmount" ELSE 0 END
            - GREATEST(0, u."amountPaid" + u."creditedAmount" - u.total)
            + u."creditedAmount" + COALESCE(l.signed, 0)) FILTER (WHERE u.dated <= ${asOf}) AS amount,
        MAX(u.dated) FILTER (WHERE u.dated <= ${asOf}) AS latest,
        COUNT(*) FILTER (WHERE u.dated > ${asOf}) AS future
      FROM unposted u
      LEFT JOIN ledgered l ON l."invoiceId" = u.id
    `);
    return { amount: round2(Number(row?.amount ?? 0)), latest: row?.latest ?? null, future: Number(row?.future ?? 0) };
  }

  private async payables(organizationId: string, asOf: Date) {
    const [row] = await this.prisma.$queryRaw<{ amount: string | null; latest: Date | null; future: bigint }[]>(Prisma.sql`
      WITH po AS (
        -- The same purchase orders the AP aging covers.
        SELECT p.id, EXISTS (SELECT 1 FROM "GoodsReceipt" g WHERE g."purchaseOrderId" = p.id) AS received
        FROM "PurchaseOrder" p
        WHERE p."organizationId" = ${organizationId}
          AND p.status IN ('SENT', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED')
          AND (EXISTS (SELECT 1 FROM "GoodsReceipt" g WHERE g."purchaseOrderId" = p.id)
            OR EXISTS (SELECT 1 FROM "SupplierBill" b
                       WHERE b."purchaseOrderId" = p.id AND b."externalId" IS NOT NULL AND b."voidedAt" IS NULL))
      ), docs AS (
        -- Imported bills count as owed only where nothing was received in WareSys.
        SELECT b.amount AS amount, b."billDate"::timestamp AS dated
        FROM "SupplierBill" b
        JOIN po ON po.id = b."purchaseOrderId" AND NOT po.received
        WHERE b."externalId" IS NOT NULL AND b."voidedAt" IS NULL
        UNION ALL
        SELECT -sp.amount, sp."paidAt"
        FROM "SupplierPayment" sp
        JOIN po ON po.id = sp."purchaseOrderId"
        WHERE NOT EXISTS (
          SELECT 1 FROM "JournalEntry" e
          WHERE e."organizationId" = ${organizationId} AND e."sourceType" = 'SUPPLIER_PAYMENT'
            AND e."sourceId" = sp.id AND e.status = 'POSTED')
      )
      SELECT SUM(amount) FILTER (WHERE dated <= ${asOf}) AS amount,
             MAX(dated) FILTER (WHERE dated <= ${asOf}) AS latest,
             COUNT(*) FILTER (WHERE dated > ${asOf}) AS future
      FROM docs
    `);
    return { amount: round2(Number(row?.amount ?? 0)), latest: row?.latest ?? null, future: Number(row?.future ?? 0) };
  }

  private async apply(
    organizationId: string,
    side: OpeningSide,
    computed: { amount: number; latest: Date | null; future: number },
    tz: string,
    userId?: string,
  ): Promise<OpeningSideResult> {
    const { amount, latest, future } = computed;
    const date = amount !== 0 && latest ? toBusinessDate(latest, tz) : null;
    const dateStr = date ? date.toISOString().slice(0, 10) : null;
    const result: OpeningSideResult = { amount, date: dateStr, action: 'none', futureDated: future };

    try {
      const [control, equity] = await Promise.all([
        this.accounts.resolve(
          organizationId,
          side === 'AR' ? SystemAccountKey.ACCOUNTS_RECEIVABLE : SystemAccountKey.ACCOUNTS_PAYABLE,
        ),
        this.accounts.resolve(organizationId, SystemAccountKey.OPENING_BALANCE_EQUITY),
      ]);
      const existing = await this.prisma.journalEntry.findFirst({
        where: {
          organizationId,
          sourceType: JournalSourceType.OPENING_BALANCE,
          sourceId: SOURCE_ID[side],
          status: JournalEntryStatus.POSTED,
        },
        include: { lines: true },
      });
      const existingAmount = existing ? this.amountOf(side, control, existing.lines) : 0;
      const existingDate = existing ? existing.entryDate.toISOString().slice(0, 10) : null;
      if (existing && existingAmount === amount && existingDate === dateStr) return { ...result, action: 'unchanged' };
      if (!existing && amount === 0) return result;

      await this.prisma.$transaction(async (tx) => {
        if (existing) {
          await this.journal.voidEntry(organizationId, existing.id, userId, 'Opening balance recomputed', tx);
        }
        if (amount === 0 || !date) return;
        // AR is a debit balance, AP a credit one; a negative amount (credits
        // exceed what's owed) just flips the sides.
        const controlDebit = side === 'AR' ? amount > 0 : amount < 0;
        const value = Math.abs(amount);
        await this.journal.postEntry(
          organizationId,
          {
            date,
            memo:
              side === 'AR'
                ? 'Opening balance: receivables from imported / unposted invoices'
                : 'Opening balance: payables from imported supplier bills',
            sourceType: JournalSourceType.OPENING_BALANCE,
            sourceId: SOURCE_ID[side],
            userId,
            lines: controlDebit
              ? [
                  { accountId: control, debit: value, description: side === 'AR' ? 'Receivables' : 'Payables' },
                  { accountId: equity, credit: value, description: 'Opening balance equity' },
                ]
              : [
                  { accountId: equity, debit: value, description: 'Opening balance equity' },
                  { accountId: control, credit: value, description: side === 'AR' ? 'Receivables' : 'Payables' },
                ],
          },
          tx,
        );
      });
      return { ...result, action: existing ? (amount === 0 ? 'removed' : 'replaced') : 'posted' };
    } catch (err) {
      // A closed period, or a chart missing an account: the import itself
      // still succeeded, so report it rather than fail.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Opening balance (${side}) not posted for org ${organizationId}: ${message}`);
      return { ...result, error: message };
    }
  }

  // The entry's signed balance on its control account (AR debit-positive,
  // AP credit-positive), to compare with a fresh computation.
  private amountOf(
    side: OpeningSide,
    controlAccountId: string,
    lines: { accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[],
  ) {
    const net = lines
      .filter((l) => l.accountId === controlAccountId)
      .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    return round2(side === 'AR' ? net : -net);
  }
}
