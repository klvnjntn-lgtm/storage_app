import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  JournalEntryStatus,
  JournalSourceType,
  PaymentMethod,
  SystemAccountKey,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// What a line on the statement was. The frontend turns these into words.
export type StatementKind =
  | 'CUSTOMER_PAYMENT'
  | 'CUSTOMER_REFUND'
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE'
  | 'PAYROLL'
  | 'ASSET_PURCHASE'
  | 'ASSET_SALE'
  | 'TRANSFER'
  | 'OWNER'
  | 'LOAN'
  | 'OTHER';

export type StatementLine = {
  date: Date;
  entryNumber: string | null;
  kind: StatementKind;
  // Who the money came from or went to (customer, supplier, …).
  party: string | null;
  // The document behind it: invoice, PO + supplier bills, expense, payroll period.
  reference: string | null;
  // Expense category, asset name, the other account of a transfer, …
  detail: string | null;
  memo: string | null;
  method: PaymentMethod | null;
  moneyIn: number;
  moneyOut: number;
  balance: number;
  link: {
    type:
      | 'invoice'
      | 'purchase-order'
      | 'expense'
      | 'payroll'
      | 'fixed-asset'
      | 'journal';
    id: string;
  } | null;
};

export type StatementCategory = {
  kind: StatementKind;
  moneyIn: number;
  moneyOut: number;
  count: number;
};

export type StatementAccount = {
  accountId: string;
  code: string;
  name: string;
  bankName: string | null;
  accountNumber: string | null;
  opening: number;
  moneyIn: number;
  moneyOut: number;
  closing: number;
  byKind: StatementCategory[];
  lines: StatementLine[];
  // More lines than MAX_LINES in the period; totals still cover all of them.
  truncated: boolean;
};

export type CashStatement = {
  from: Date;
  to: Date;
  business: {
    name: string;
    legalName: string | null;
    npwp: string | null;
    address: string | null;
  };
  accounts: StatementAccount[];
  totals: {
    opening: number;
    moneyIn: number;
    moneyOut: number;
    closing: number;
  };
  byKind: StatementCategory[];
};

const MAX_LINES = 2000;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const KIND_BY_SOURCE: Partial<Record<JournalSourceType, StatementKind>> = {
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  EXPENSE: 'EXPENSE',
  PAYROLL: 'PAYROLL',
  FIXED_ASSET_PURCHASE: 'ASSET_PURCHASE',
  FIXED_ASSET_DISPOSAL: 'ASSET_SALE',
};

type Enriched = Pick<
  StatementLine,
  'party' | 'reference' | 'detail' | 'method' | 'link'
> & { kind?: StatementKind };

// A bank-statement-style view of every cash and bank account: opening
// balance, each payment in or out with who and what it was for, running
// balance and closing balance. Read entirely from POSTED journal lines, so
// it always agrees with the Account Ledger, Cash Flow and Balance Sheet.
@Injectable()
export class CashStatementService {
  constructor(private prisma: PrismaService) {}

  async getStatement(
    organizationId: string,
    from: Date,
    to: Date,
    accountId?: string,
  ): Promise<CashStatement> {
    if (from.getTime() > to.getTime())
      throw new BadRequestException('"from" must be on or before "to"');

    const [org, allCash] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true, legalName: true, npwp: true, address: true },
      }),
      // Same definition of "cash" as CashFlowService.
      this.prisma.chartOfAccount.findMany({
        where: {
          organizationId,
          type: AccountType.ASSET,
          OR: [
            {
              systemKey: { in: [SystemAccountKey.CASH, SystemAccountKey.BANK] },
            },
            { bankAccountId: { not: null } },
          ],
        },
        select: {
          id: true,
          code: true,
          name: true,
          bankAccount: { select: { bankName: true, accountNumber: true } },
        },
        orderBy: { code: 'asc' },
      }),
    ]);
    const cashIds = new Set(allCash.map((a) => a.id));
    const accounts = accountId
      ? allCash.filter((a) => a.id === accountId)
      : allCash;
    if (accountId && accounts.length === 0)
      throw new NotFoundException('Not a cash or bank account');

    const posted = { organizationId, status: JournalEntryStatus.POSTED };
    const ids = accounts.map((a) => a.id);
    const [openRows, lines] = await Promise.all([
      this.prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: {
          accountId: { in: ids },
          journalEntry: { ...posted, entryDate: { lt: from } },
        },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalEntryLine.findMany({
        where: {
          accountId: { in: ids },
          journalEntry: { ...posted, entryDate: { gte: from, lte: to } },
        },
        orderBy: [
          { journalEntry: { entryDate: 'asc' } },
          { journalEntry: { entryNumber: 'asc' } },
          { id: 'asc' },
        ],
        select: {
          accountId: true,
          debit: true,
          credit: true,
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              entryDate: true,
              memo: true,
              sourceType: true,
              sourceId: true,
              lines: {
                select: {
                  accountId: true,
                  account: { select: { name: true, type: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const enriched = await this.enrich(
      organizationId,
      lines.map((l) => l.journalEntry),
    );

    const opening = new Map(
      openRows.map((r) => [
        r.accountId,
        Number(r._sum.debit ?? 0) - Number(r._sum.credit ?? 0),
      ]),
    );
    const overall = new Map<StatementKind, StatementCategory>();
    const result: StatementAccount[] = accounts.map((a) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      bankName: a.bankAccount?.bankName ?? null,
      accountNumber: a.bankAccount?.accountNumber ?? null,
      opening: round2(opening.get(a.id) ?? 0),
      moneyIn: 0,
      moneyOut: 0,
      closing: 0,
      byKind: [],
      lines: [],
      truncated: false,
    }));
    const byId = new Map(result.map((a) => [a.accountId, a]));
    const kinds = new Map<string, Map<StatementKind, StatementCategory>>();
    const running = new Map(result.map((a) => [a.accountId, a.opening]));

    for (const l of lines) {
      const acc = byId.get(l.accountId)!;
      const moneyIn = Number(l.debit);
      const moneyOut = Number(l.credit);
      const e = l.journalEntry;
      const others = e.lines.filter((x) => x.accountId !== l.accountId);
      const extra = enriched.get(e.id);

      let kind: StatementKind;
      let detail = extra?.detail ?? null;
      if (extra?.kind) kind = extra.kind;
      else if (KIND_BY_SOURCE[e.sourceType])
        kind = KIND_BY_SOURCE[e.sourceType]!;
      else if (
        others.length > 0 &&
        others.every((x) => cashIds.has(x.accountId))
      ) {
        kind = 'TRANSFER';
        detail = others.map((x) => x.account.name).join(', ');
      } else if (
        e.sourceType === JournalSourceType.MANUAL &&
        others.some((x) => x.account.type === AccountType.EQUITY)
      ) {
        kind = 'OWNER';
      } else if (
        e.sourceType === JournalSourceType.MANUAL &&
        others.some((x) => x.account.type === AccountType.LIABILITY)
      ) {
        kind = 'LOAN';
      } else kind = 'OTHER';

      const balance = round2(
        (running.get(l.accountId) ?? 0) + moneyIn - moneyOut,
      );
      running.set(l.accountId, balance);
      acc.moneyIn += moneyIn;
      acc.moneyOut += moneyOut;

      for (const bucket of [kinds.get(acc.accountId) ?? new Map(), overall]) {
        const c = bucket.get(kind) ?? {
          kind,
          moneyIn: 0,
          moneyOut: 0,
          count: 0,
        };
        c.moneyIn += moneyIn;
        c.moneyOut += moneyOut;
        c.count += 1;
        bucket.set(kind, c);
        if (bucket !== overall) kinds.set(acc.accountId, bucket);
      }

      if (acc.lines.length < MAX_LINES) {
        acc.lines.push({
          date: e.entryDate,
          entryNumber: e.entryNumber,
          kind,
          party: extra?.party ?? null,
          reference: extra?.reference ?? null,
          detail,
          memo: e.memo,
          method: extra?.method ?? null,
          moneyIn,
          moneyOut,
          balance,
          link: extra?.link ?? { type: 'journal', id: e.id },
        });
      } else acc.truncated = true;
    }

    const finishKinds = (
      m: Map<StatementKind, StatementCategory> | undefined,
    ) =>
      [...(m?.values() ?? [])]
        .map((c) => ({
          ...c,
          moneyIn: round2(c.moneyIn),
          moneyOut: round2(c.moneyOut),
        }))
        .sort((a, b) => b.moneyIn + b.moneyOut - (a.moneyIn + a.moneyOut));
    for (const acc of result) {
      acc.moneyIn = round2(acc.moneyIn);
      acc.moneyOut = round2(acc.moneyOut);
      acc.closing = round2(acc.opening + acc.moneyIn - acc.moneyOut);
      acc.byKind = finishKinds(kinds.get(acc.accountId));
    }

    const sum = (f: (a: StatementAccount) => number) =>
      round2(result.reduce((s, a) => s + f(a), 0));
    return {
      from,
      to,
      business: org,
      accounts: result,
      totals: {
        opening: sum((a) => a.opening),
        moneyIn: sum((a) => a.moneyIn),
        moneyOut: sum((a) => a.moneyOut),
        closing: sum((a) => a.closing),
      },
      byKind: finishKinds(overall),
    };
  }

  // Looks up who/what each entry was about, a handful of queries per type.
  private async enrich(
    organizationId: string,
    entries: {
      id: string;
      sourceType: JournalSourceType;
      sourceId: string | null;
    }[],
  ): Promise<Map<string, Enriched>> {
    const out = new Map<string, Enriched>();
    const idsOf = (type: JournalSourceType) => [
      ...new Set(
        entries
          .filter((e) => e.sourceType === type && e.sourceId)
          .map((e) => e.sourceId!.split(':')[0]),
      ),
    ];
    const each = (
      type: JournalSourceType,
      fn: (sourceId: string, entryId: string) => Enriched | null,
    ) => {
      for (const e of entries) {
        if (e.sourceType !== type || !e.sourceId || out.has(e.id)) continue;
        const r = fn(e.sourceId.split(':')[0], e.id);
        if (r) out.set(e.id, r);
      }
    };

    const paymentIds = idsOf(JournalSourceType.PAYMENT);
    const supplierPaymentIds = idsOf(JournalSourceType.SUPPLIER_PAYMENT);
    const expenseIds = idsOf(JournalSourceType.EXPENSE);
    const payrollIds = idsOf(JournalSourceType.PAYROLL);
    const assetIds = [
      ...idsOf(JournalSourceType.FIXED_ASSET_PURCHASE),
      ...idsOf(JournalSourceType.FIXED_ASSET_DISPOSAL),
    ];

    const [
      payments,
      supplierPayments,
      expenses,
      expensePayments,
      payrolls,
      assetPayments,
      assets,
    ] = await Promise.all([
      this.prisma.payment.findMany({
        where: { id: { in: paymentIds }, invoice: { organizationId } },
        select: {
          id: true,
          method: true,
          kind: true,
          invoice: {
            select: { id: true, invoiceNumber: true, customerName: true },
          },
        },
      }),
      this.prisma.supplierPayment.findMany({
        where: { id: { in: supplierPaymentIds }, organizationId },
        select: {
          id: true,
          method: true,
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              supplier: { select: { name: true } },
              supplierBills: {
                where: { voidedAt: null },
                select: { billNumber: true },
                orderBy: { billDate: 'asc' },
              },
            },
          },
        },
      }),
      // An expense entry's sourceId is the expense (paid when recorded) or
      // one of its payments (paid later).
      this.prisma.expense.findMany({
        where: { id: { in: expenseIds }, organizationId },
        select: {
          id: true,
          description: true,
          paymentMethod: true,
          category: { select: { name: true } },
        },
      }),
      this.prisma.expensePayment.findMany({
        where: { id: { in: expenseIds }, expense: { organizationId } },
        select: {
          id: true,
          method: true,
          expense: {
            select: {
              id: true,
              description: true,
              category: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.payroll.findMany({
        where: { id: { in: payrollIds }, organizationId },
        select: {
          id: true,
          periodMonth: true,
          periodYear: true,
          paymentMethod: true,
        },
      }),
      this.prisma.fixedAssetPayment.findMany({
        where: { id: { in: assetIds }, fixedAsset: { organizationId } },
        select: {
          id: true,
          method: true,
          fixedAsset: { select: { id: true, name: true } },
        },
      }),
      this.prisma.fixedAsset.findMany({
        where: { id: { in: assetIds }, organizationId },
        select: { id: true, name: true },
      }),
    ]);

    const paymentsById = new Map(payments.map((p) => [p.id, p]));
    each(JournalSourceType.PAYMENT, (id) => {
      const p = paymentsById.get(id);
      if (!p) return null;
      return {
        kind: p.kind === 'REFUND' ? 'CUSTOMER_REFUND' : 'CUSTOMER_PAYMENT',
        party: p.invoice.customerName,
        reference: p.invoice.invoiceNumber,
        detail: null,
        method: p.method,
        link: { type: 'invoice', id: p.invoice.id },
      };
    });

    const spById = new Map(supplierPayments.map((p) => [p.id, p]));
    each(JournalSourceType.SUPPLIER_PAYMENT, (id) => {
      const p = spById.get(id);
      if (!p) return null;
      const bills = p.purchaseOrder.supplierBills.map((b) => b.billNumber);
      return {
        party: p.purchaseOrder.supplier?.name ?? null,
        reference: p.purchaseOrder.poNumber,
        detail: bills.length ? bills.join(', ') : null,
        method: p.method,
        link: { type: 'purchase-order', id: p.purchaseOrder.id },
      };
    });

    const expById = new Map(expenses.map((x) => [x.id, x]));
    const expPayById = new Map(expensePayments.map((x) => [x.id, x]));
    each(JournalSourceType.EXPENSE, (id) => {
      const viaPayment = expPayById.get(id);
      const x = viaPayment?.expense ?? expById.get(id);
      if (!x) return null;
      return {
        party: null,
        reference: x.description,
        detail: x.category.name,
        method: viaPayment?.method ?? expById.get(id)?.paymentMethod ?? null,
        link: { type: 'expense', id: x.id },
      };
    });

    const payrollById = new Map(payrolls.map((p) => [p.id, p]));
    each(JournalSourceType.PAYROLL, (id) => {
      const p = payrollById.get(id);
      if (!p) return null;
      return {
        party: null,
        reference: `${String(p.periodMonth).padStart(2, '0')}/${p.periodYear}`,
        detail: null,
        method: p.paymentMethod,
        link: { type: 'payroll', id: p.id },
      };
    });

    const assetPayById = new Map(assetPayments.map((p) => [p.id, p]));
    const assetById = new Map(assets.map((a) => [a.id, a]));
    for (const type of [
      JournalSourceType.FIXED_ASSET_PURCHASE,
      JournalSourceType.FIXED_ASSET_DISPOSAL,
    ]) {
      each(type, (id) => {
        const viaPayment = assetPayById.get(id);
        const asset = viaPayment?.fixedAsset ?? assetById.get(id);
        if (!asset) return null;
        return {
          party: null,
          reference: null,
          detail: asset.name,
          method: viaPayment?.method ?? null,
          link: { type: 'fixed-asset', id: asset.id },
        };
      });
    }

    return out;
  }
}
