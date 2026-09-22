import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, JournalEntryStatus, JournalSourceType, SystemAccountKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type CashFlowSection = 'operating' | 'investing' | 'financing';

export type CashFlowItem = {
  key: string;
  label: string;
  inflow: number; // positive
  outflow: number; // positive
  net: number; // inflow - outflow
};

export type CashFlowSectionTotals = {
  items: CashFlowItem[];
  inflow: number;
  outflow: number;
  net: number;
};

export type CashFlowAccountLine = {
  accountId: string;
  code: string;
  name: string;
  opening: number;
  netChange: number;
  closing: number;
};

export type CashFlowReport = {
  from: Date;
  to: Date;
  openingCash: number;
  operating: CashFlowSectionTotals;
  investing: CashFlowSectionTotals; // fixed-asset purchases/disposals — see FIXED_ASSET_PURCHASE/DISPOSAL in SOURCE_CATEGORY
  financing: CashFlowSectionTotals;
  netChange: number;
  closingCash: number;
  accounts: CashFlowAccountLine[];
  // opening + netChange should equal the ledger's cash balance at `to`.
  reconciliation: { ledgerClosingCash: number; computedClosingCash: number; matches: boolean };
};

type Category = { section: CashFlowSection; key: string; label: string };

const SOURCE_CATEGORY: Record<string, Category> = {
  PAYMENT: { section: 'operating', key: 'customer_receipts', label: 'Receipts from customers' },
  SUPPLIER_PAYMENT: { section: 'operating', key: 'supplier_payments', label: 'Payments to suppliers' },
  EXPENSE: { section: 'operating', key: 'operating_expenses', label: 'Operating expenses paid' },
  PAYROLL: { section: 'operating', key: 'payroll', label: 'Payroll disbursed' },
  // FIXED_ASSET_PURCHASE covers both postFixedAssetAcquired() (never touches
  // cash, so it never actually reaches this map) and postFixedAssetPayment()
  // (the entry that does touch cash) — same one-sourceType-for-record-and-pay
  // convention as EXPENSE above.
  FIXED_ASSET_PURCHASE: { section: 'investing', key: 'fixed_asset_purchases', label: 'Purchase of fixed assets' },
  FIXED_ASSET_DISPOSAL: { section: 'investing', key: 'fixed_asset_disposals', label: 'Proceeds from disposal of fixed assets' },
};

const MANUAL_FINANCING_EQUITY: Category = {
  section: 'financing',
  key: 'owner_equity',
  label: 'Owner capital / drawings',
};
// A MANUAL entry hitting a liability account is never one of the operating
// liability flows that already have their own sourceType/category (AP via
// SUPPLIER_PAYMENT, Payroll Payable via PAYROLL, etc.) — those never reach
// this MANUAL-only branch. So an ad-hoc entry against some other liability
// is, by elimination, the closest thing this schema has to a loan proceed/
// repayment, which is a financing activity. There's no dedicated Loan
// Payable SystemAccountKey to key off of instead.
const MANUAL_FINANCING_LIABILITY: Category = {
  section: 'financing',
  key: 'loans_liabilities',
  label: 'Loan proceeds / repayments',
};
const MANUAL_OTHER: Category = { section: 'operating', key: 'manual_other', label: 'Other (manual entries)' };
const OTHER_OPERATING: Category = { section: 'operating', key: 'other_operating', label: 'Other operating' };

// Direct-method cash flow, derived entirely from POSTED journal lines on
// cash/bank accounts. No new write path.
//
// Limits: only cash that went through the ledger is visible, so payments
// recorded before ledger posting existed are missing. A MANUAL entry's
// non-cash counter-account decides its section: EQUITY -> owner
// capital/drawings, LIABILITY -> loan proceeds/repayments (the closest fit
// this schema has, absent a dedicated Loan Payable account), anything else
// -> operating. Investing comes from FixedAssetsService: postFixedAssetPayment()
// (cash paid for an asset, whether at acquisition or later) and
// postFixedAssetDisposal() (cash received on disposal) are the only entries
// tagged FIXED_ASSET_PURCHASE/FIXED_ASSET_DISPOSAL that touch a cash account —
// postFixedAssetAcquired() and postFixedAssetDepreciation() never do, so they
// never reach this report at all, direct-method being cash-only by definition.
@Injectable()
export class CashFlowService {
  constructor(private prisma: PrismaService) {}

  async getCashFlow(organizationId: string, from: Date, to: Date): Promise<CashFlowReport> {
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('"from" must be on or before "to"');
    }

    const cashAccounts = await this.prisma.chartOfAccount.findMany({
      where: {
        organizationId,
        type: AccountType.ASSET,
        OR: [
          { systemKey: { in: [SystemAccountKey.CASH, SystemAccountKey.BANK] } },
          { bankAccountId: { not: null } },
        ],
      },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });

    if (cashAccounts.length === 0) {
      return this.emptyReport(from, to);
    }

    const cashIds = cashAccounts.map((a) => a.id);
    const posted = { organizationId, status: JournalEntryStatus.POSTED };

    const [openRows, closeRows, periodLines] = await Promise.all([
      this.prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: { accountId: { in: cashIds }, journalEntry: { ...posted, entryDate: { lt: from } } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: { accountId: { in: cashIds }, journalEntry: { ...posted, entryDate: { lte: to } } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalEntryLine.findMany({
        where: {
          accountId: { in: cashIds },
          journalEntry: { ...posted, entryDate: { gte: from, lte: to } },
        },
        select: {
          accountId: true,
          debit: true,
          credit: true,
          journalEntry: { select: { id: true, sourceType: true } },
        },
      }),
    ]);

    const balanceOf = (rows: typeof openRows) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        m.set(r.accountId, Number(r._sum.debit ?? 0) - Number(r._sum.credit ?? 0));
      }
      return m;
    };
    const openingByAccount = balanceOf(openRows);
    const closingByAccount = balanceOf(closeRows);

    // Net cash effect per entry (a transfer between two cash accounts nets
    // to zero and drops out), plus per-account period change.
    const entryNet = new Map<string, { sourceType: JournalSourceType; net: number }>();
    const periodByAccount = new Map<string, number>();
    for (const l of periodLines) {
      const delta = Number(l.debit) - Number(l.credit);
      const e = entryNet.get(l.journalEntry.id);
      if (e) e.net += delta;
      else entryNet.set(l.journalEntry.id, { sourceType: l.journalEntry.sourceType, net: delta });
      periodByAccount.set(l.accountId, (periodByAccount.get(l.accountId) ?? 0) + delta);
    }

    // MANUAL entries have no inherent category; look at their non-cash side.
    const manualIds = [...entryNet.entries()]
      .filter(([, e]) => e.sourceType === JournalSourceType.MANUAL && Math.abs(e.net) >= 0.005)
      .map(([id]) => id);
    const manualTouchesEquity = new Set<string>();
    const manualTouchesLiability = new Set<string>();
    if (manualIds.length > 0) {
      const counterLines = await this.prisma.journalEntryLine.findMany({
        where: { journalEntryId: { in: manualIds }, accountId: { notIn: cashIds } },
        select: { journalEntryId: true, account: { select: { type: true } } },
      });
      for (const c of counterLines) {
        if (c.account.type === AccountType.EQUITY) manualTouchesEquity.add(c.journalEntryId);
        else if (c.account.type === AccountType.LIABILITY) manualTouchesLiability.add(c.journalEntryId);
      }
    }

    const buckets = new Map<string, { category: Category; inflow: number; outflow: number }>();
    for (const [entryId, e] of entryNet) {
      if (Math.abs(e.net) < 0.005) continue;

      let category: Category;
      if (e.sourceType === JournalSourceType.MANUAL) {
        category = manualTouchesEquity.has(entryId)
          ? MANUAL_FINANCING_EQUITY
          : manualTouchesLiability.has(entryId)
          ? MANUAL_FINANCING_LIABILITY
          : MANUAL_OTHER;
      } else {
        category = SOURCE_CATEGORY[e.sourceType] ?? OTHER_OPERATING;
      }

      const b = buckets.get(category.key) ?? { category, inflow: 0, outflow: 0 };
      if (e.net > 0) b.inflow += e.net;
      else b.outflow += -e.net;
      buckets.set(category.key, b);
    }

    const sections: Record<CashFlowSection, CashFlowSectionTotals> = {
      operating: this.newSection(),
      investing: this.newSection(),
      financing: this.newSection(),
    };
    for (const b of buckets.values()) {
      const inflow = this.round2(b.inflow);
      const outflow = this.round2(b.outflow);
      const s = sections[b.category.section];
      s.items.push({
        key: b.category.key,
        label: b.category.label,
        inflow,
        outflow,
        net: this.round2(inflow - outflow),
      });
      s.inflow = this.round2(s.inflow + inflow);
      s.outflow = this.round2(s.outflow + outflow);
      s.net = this.round2(s.net + inflow - outflow);
    }
    for (const s of Object.values(sections)) s.items.sort((a, b) => a.label.localeCompare(b.label));

    const accounts: CashFlowAccountLine[] = cashAccounts.map((a) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      opening: this.round2(openingByAccount.get(a.id) ?? 0),
      netChange: this.round2(periodByAccount.get(a.id) ?? 0),
      closing: this.round2(closingByAccount.get(a.id) ?? 0),
    }));

    const openingCash = this.round2(accounts.reduce((s, a) => s + a.opening, 0));
    const ledgerClosingCash = this.round2(accounts.reduce((s, a) => s + a.closing, 0));
    const netChange = this.round2(sections.operating.net + sections.investing.net + sections.financing.net);
    const computedClosingCash = this.round2(openingCash + netChange);

    return {
      from,
      to,
      openingCash,
      operating: sections.operating,
      investing: sections.investing,
      financing: sections.financing,
      netChange,
      closingCash: computedClosingCash,
      accounts,
      reconciliation: {
        ledgerClosingCash,
        computedClosingCash,
        matches: Math.abs(ledgerClosingCash - computedClosingCash) < 0.01,
      },
    };
  }

  private newSection(): CashFlowSectionTotals {
    return { items: [], inflow: 0, outflow: 0, net: 0 };
  }

  private emptyReport(from: Date, to: Date): CashFlowReport {
    return {
      from,
      to,
      openingCash: 0,
      operating: this.newSection(),
      investing: this.newSection(),
      financing: this.newSection(),
      netChange: 0,
      closingCash: 0,
      accounts: [],
      reconciliation: { ledgerClosingCash: 0, computedClosingCash: 0, matches: true },
    };
  }

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }
}