import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountResolverService } from './account-resolver.service';
import {
  AccountType,
  InvoiceStatus,
  JournalEntryStatus,
  JournalSourceType,
  PaymentStatus,
  Prisma,
  PurchaseOrderStatus,
  SystemAccountKey,
} from '@prisma/client';

// Half a cent — matches the tolerance convention used everywhere else in
// this codebase (journal.service.ts, expenses.service.ts,
// fixed-assets.service.ts): amounts are 2dp, so anything smaller is
// genuine float noise, not a real imbalance.
const EPS = 0.005;

export type PageParams = { page?: number; pageSize?: number };

export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

export type ProfitAndLossLine = { accountId: string; code: string; name: string; amount: number };

export type ProfitAndLossReport = {
  from: Date;
  to: Date;
  revenue: ProfitAndLossLine[];
  totalRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number; // percent
  operatingExpenses: ProfitAndLossLine[];
  totalOperatingExpenses: number;
  netProfit: number;
  netMargin: number; // percent
  // Only present when locationId was passed. Revenue/expense lines that
  // carry no locationId at all (payroll always, plus any expense entered
  // without picking a location) can't be attributed to the filtered
  // location, so they're never counted in the totals above — but they're
  // surfaced here rather than silently dropped, so a per-location P&L
  // doesn't read as "these costs don't exist."
  unallocated?: {
    revenue: ProfitAndLossLine[];
    operatingExpenses: ProfitAndLossLine[];
    totalRevenue: number;
    totalOperatingExpenses: number;
    netAmount: number;
  };
};

export type TrialBalanceLine = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number; // trial-balance column, not raw posted debit — see comment in getTrialBalance
  credit: number;
};

export type TrialBalanceReport = {
  asOf: Date;
  accounts: TrialBalanceLine[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
};

export type BalanceSheetLine = { accountId: string; code: string; name: string; amount: number };

export type BalanceSheetReport = {
  asOf: Date;
  assets: BalanceSheetLine[];
  totalAssets: number;
  liabilities: BalanceSheetLine[];
  totalLiabilities: number;
  statedEquity: BalanceSheetLine[];
  totalStatedEquity: number;
  // Revenue/Expense accounts have never been closed into Retained Earnings
  // — there's no closing-entry process yet — so this is computed live:
  // cumulative Revenue minus cumulative Expense, inception through asOf.
  accumulatedEarnings: number;
  totalEquity: number; // totalStatedEquity + accumulatedEarnings
  totalLiabilitiesAndEquity: number; // totalLiabilities + totalEquity — should equal totalAssets
  isBalanced: boolean;
};

export type AccountLedgerEntry = {
  journalEntryId: string;
  entryNumber: string | null;
  date: Date;
  memo: string | null;
  sourceType: string;
  debit: number;
  credit: number;
  runningBalance: number;
};

export type AccountLedgerReport = {
  account: { id: string; code: string; name: string; type: AccountType };
  from: Date;
  to: Date;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number; // whole range, not just this page
  totalCredit: number; // whole range, not just this page
  entries: AccountLedgerEntry[]; // ONE PAGE of the range
  pagination: Pagination;
};

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export type ARAgingLine = {
  invoiceId: string;
  invoiceNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null; // the date actually used for aging
  total: number;
  amountPaid: number;
  outstanding: number;
  daysOverdue: number; // negative/zero = not yet due
  bucket: AgingBucket;
};

export type ARAgingByCustomer = {
  customerId: string | null;
  customerName: string | null;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
};

export type ARAgingReport = {
  asOf: Date;
  lines: ARAgingLine[]; // ONE PAGE (after optional bucket/customer filters)
  pagination: Pagination;
  // byCustomer, totals and reconciliation always cover ALL open invoices,
  // regardless of page or filters.
  byCustomer: ARAgingByCustomer[];
  totals: Omit<ARAgingByCustomer, 'customerId' | 'customerName'>;
  reconciliation: { arLedgerBalance: number; sumOfOutstandingInvoices: number; matches: boolean };
};

export type APAgingLine = {
  purchaseOrderId: string;
  poNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  orderDate: Date | null;
  dueDate: Date | null;
  totalOwed: number;
  amountPaid: number;
  outstanding: number;
  daysOverdue: number;
  bucket: AgingBucket;
};

export type APAgingByBucket = {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
};

export type APAgingReport = {
  asOf: Date;
  dueDateCaveat: string;
  lines: APAgingLine[]; // ONE PAGE (after optional bucket/supplier filters)
  pagination: Pagination;
  totals: APAgingByBucket; // ALL open POs, regardless of page or filters
  reconciliation: { apLedgerBalance: number; sumOfOutstandingPOs: number; matches: boolean };
};

// Reports are read-only aggregations over JournalEntryLine — no new write
// path needed now that the ledger exists.
@Injectable()
export class AccountingReportsService {
  private readonly logger = new Logger(AccountingReportsService.name);

  constructor(
    private prisma: PrismaService,
    private accounts: AccountResolverService,
  ) {}

  // ---------------------------------------------------------------------
  // Trial Balance — cumulative from inception through `asOf`.
  // Organization-wide only: most non-sales lines (AR, cash, AP, payroll)
  // carry no locationId, so a location-filtered trial balance can never
  // balance. Reject the filter rather than return wrong numbers.
  // ---------------------------------------------------------------------
  async getTrialBalance(organizationId: string, asOf: Date, locationId?: string): Promise<TrialBalanceReport> {
    if (locationId) {
      throw new BadRequestException(
        'Trial Balance is organization-wide and cannot be filtered by location. Use the Profit & Loss report for per-location results.',
      );
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: { organizationId, status: JournalEntryStatus.POSTED, entryDate: { lte: asOf } },
      },
      select: {
        debit: true,
        credit: true,
        account: { select: { id: true, code: true, name: true, type: true } },
      },
    });

    // Accumulate true lifetime sums per account first, decide the column
    // split second, so the balancing check below checks real posted data.
    const byAccount = new Map<string, { code: string; name: string; type: AccountType; debit: number; credit: number }>();

    for (const line of lines) {
      const acc = line.account;
      const existing = byAccount.get(acc.id);
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      if (existing) {
        existing.debit += debit;
        existing.credit += credit;
      } else {
        byAccount.set(acc.id, { code: acc.code, name: acc.name, type: acc.type, debit, credit });
      }
    }

    const accounts: TrialBalanceLine[] = [];
    for (const [accountId, acc] of byAccount) {
      const net = this.round2(acc.debit - acc.credit);
      accounts.push({
        accountId,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? -net : 0,
      });
    }

    accounts.sort((a, b) => a.code.localeCompare(b.code));

    const totalDebits = this.round2(accounts.reduce((sum, a) => sum + a.debit, 0));
    const totalCredits = this.round2(accounts.reduce((sum, a) => sum + a.credit, 0));

    return {
      asOf,
      accounts,
      totalDebits,
      totalCredits,
      isBalanced: Math.abs(totalDebits - totalCredits) < EPS,
    };
  }

  // ---------------------------------------------------------------------
  // Account Ledger — paginated. Opening/closing balances and range totals
  // always cover the whole range; only `entries` is one page, and each
  // page's runningBalance continues correctly from the previous page.
  // ---------------------------------------------------------------------
  async getAccountLedger(
    organizationId: string,
    accountId: string,
    from: Date,
    to: Date,
    paging: PageParams = {},
  ): Promise<AccountLedgerReport> {
    const { page, pageSize } = this.normalizePaging(paging, 50, 500);

    const account = await this.prisma.chartOfAccount.findFirst({
      where: { id: accountId, organizationId },
      select: { id: true, code: true, name: true, type: true, normalBalance: true },
    });
    if (!account) throw new NotFoundException('Account not found');

    const signedDelta = (debit: number, credit: number) =>
      account.normalBalance === 'DEBIT' ? debit - credit : credit - debit;

    // Opening balance: everything posted strictly before `from`, as one aggregate.
    const priorAgg = await this.prisma.journalEntryLine.aggregate({
      where: {
        accountId,
        journalEntry: { organizationId, status: JournalEntryStatus.POSTED, entryDate: { lt: from } },
      },
      _sum: { debit: true, credit: true },
    });
    const openingBalance = this.round2(
      signedDelta(Number(priorAgg._sum.debit ?? 0), Number(priorAgg._sum.credit ?? 0)),
    );

    const rangeWhere: Prisma.JournalEntryLineWhereInput = {
      accountId,
      journalEntry: { organizationId, status: JournalEntryStatus.POSTED, entryDate: { gte: from, lte: to } },
    };

    const [rangeAgg, total] = await Promise.all([
      this.prisma.journalEntryLine.aggregate({ where: rangeWhere, _sum: { debit: true, credit: true } }),
      this.prisma.journalEntryLine.count({ where: rangeWhere }),
    ]);
    const totalDebit = this.round2(Number(rangeAgg._sum.debit ?? 0));
    const totalCredit = this.round2(Number(rangeAgg._sum.credit ?? 0));
    const closingBalance = this.round2(openingBalance + signedDelta(totalDebit, totalCredit));

    // Stable ordering: date, then entry number (assigned in post order), then line id.
    const orderBy: Prisma.JournalEntryLineOrderByWithRelationInput[] = [
      { journalEntry: { entryDate: 'asc' } },
      { journalEntry: { entryNumber: 'asc' } },
      { id: 'asc' },
    ];

    // Running balance at the start of this page = opening + every line before it.
    const skip = (page - 1) * pageSize;
    let running = openingBalance;
    if (skip > 0) {
      const before = await this.prisma.journalEntryLine.findMany({
        where: rangeWhere,
        orderBy,
        take: skip,
        select: { debit: true, credit: true },
      });
      for (const l of before) {
        running = this.round2(running + signedDelta(Number(l.debit), Number(l.credit)));
      }
    }

    const pageLines = await this.prisma.journalEntryLine.findMany({
      where: rangeWhere,
      orderBy,
      skip,
      take: pageSize,
      select: {
        debit: true,
        credit: true,
        journalEntry: { select: { id: true, entryNumber: true, entryDate: true, memo: true, sourceType: true } },
      },
    });

    const entries: AccountLedgerEntry[] = pageLines.map((line) => {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      running = this.round2(running + signedDelta(debit, credit));
      return {
        journalEntryId: line.journalEntry.id,
        entryNumber: line.journalEntry.entryNumber,
        date: line.journalEntry.entryDate,
        memo: line.journalEntry.memo,
        sourceType: line.journalEntry.sourceType,
        debit,
        credit,
        runningBalance: running,
      };
    });

    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type },
      from,
      to,
      openingBalance,
      closingBalance,
      totalDebit,
      totalCredit,
      entries,
      pagination: this.buildPagination(page, pageSize, total),
    };
  }

  // ---------------------------------------------------------------------
  // Balance Sheet — organization-wide only, same reason as Trial Balance.
  // ---------------------------------------------------------------------
  async getBalanceSheet(organizationId: string, asOf: Date, locationId?: string): Promise<BalanceSheetReport> {
    if (locationId) {
      throw new BadRequestException(
        'Balance Sheet is organization-wide and cannot be filtered by location. Use the Profit & Loss report for per-location results.',
      );
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: { organizationId, status: JournalEntryStatus.POSTED, entryDate: { lte: asOf } },
      },
      select: {
        debit: true,
        credit: true,
        account: { select: { id: true, code: true, name: true, type: true } },
      },
    });

    const byAccount = new Map<string, { code: string; name: string; type: AccountType; debit: number; credit: number }>();

    for (const line of lines) {
      const acc = line.account;
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      const existing = byAccount.get(acc.id);
      if (existing) {
        existing.debit += debit;
        existing.credit += credit;
      } else {
        byAccount.set(acc.id, { code: acc.code, name: acc.name, type: acc.type, debit, credit });
      }
    }

    const assets: BalanceSheetLine[] = [];
    const liabilities: BalanceSheetLine[] = [];
    const statedEquity: BalanceSheetLine[] = [];
    let revenueCumulative = 0;
    let expenseCumulative = 0;

    for (const [accountId, acc] of byAccount) {
      switch (acc.type) {
        case AccountType.ASSET:
          assets.push({ accountId, code: acc.code, name: acc.name, amount: this.round2(acc.debit - acc.credit) });
          break;
        case AccountType.LIABILITY:
          liabilities.push({ accountId, code: acc.code, name: acc.name, amount: this.round2(acc.credit - acc.debit) });
          break;
        case AccountType.EQUITY:
          statedEquity.push({ accountId, code: acc.code, name: acc.name, amount: this.round2(acc.credit - acc.debit) });
          break;
        case AccountType.REVENUE:
          revenueCumulative += acc.credit - acc.debit;
          break;
        case AccountType.EXPENSE:
          expenseCumulative += acc.debit - acc.credit;
          break;
      }
    }

    assets.sort((a, b) => a.code.localeCompare(b.code));
    liabilities.sort((a, b) => a.code.localeCompare(b.code));
    statedEquity.sort((a, b) => a.code.localeCompare(b.code));

    const totalAssets = this.round2(assets.reduce((sum, a) => sum + a.amount, 0));
    const totalLiabilities = this.round2(liabilities.reduce((sum, l) => sum + l.amount, 0));
    const totalStatedEquity = this.round2(statedEquity.reduce((sum, e) => sum + e.amount, 0));
    const accumulatedEarnings = this.round2(revenueCumulative - expenseCumulative);
    const totalEquity = this.round2(totalStatedEquity + accumulatedEarnings);
    const totalLiabilitiesAndEquity = this.round2(totalLiabilities + totalEquity);
    const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < EPS;

    if (!isBalanced) {
      this.logger.error(
        `Balance Sheet does not balance for org ${organizationId} as of ${asOf.toISOString()}: ` +
          `Assets=${totalAssets} vs Liabilities+Equity=${totalLiabilitiesAndEquity} ` +
          `(diff=${this.round2(totalAssets - totalLiabilitiesAndEquity)}). ` +
          `This indicates an account-classification or posting-engine issue, not a rounding artifact.`,
      );
    }

    return {
      asOf,
      assets,
      totalAssets,
      liabilities,
      totalLiabilities,
      statedEquity,
      totalStatedEquity,
      accumulatedEarnings,
      totalEquity,
      totalLiabilitiesAndEquity,
      isBalanced,
    };
  }

  // ---------------------------------------------------------------------
  // AR Aging — document-based. Summary (totals, byCustomer, reconciliation)
  // is computed over ALL open invoices; only `lines` is paginated, and it
  // can be narrowed by bucket and/or customerId.
  // ---------------------------------------------------------------------
async getARAging(
  organizationId: string,
  asOf: Date,
  opts: PageParams & { bucket?: AgingBucket; customerId?: string } = {},
): Promise<ARAgingReport> {
  const { page, pageSize } = this.normalizePaging(opts, 50, 200);

  const invoices = await this.prisma.invoice.findMany({
    where: {
      organizationId,
      status: InvoiceStatus.ISSUED,
      paymentStatus: { not: PaymentStatus.PAID },
      OR: [{ issuedAt: { lte: asOf } }, { issuedAt: null, invoiceDate: { lte: asOf } }],
    },
    select: {
      id: true,
      invoiceNumber: true,
      customerId: true,
      customerName: true,
      invoiceDate: true,
      dueDate: true,
      issuedAt: true,
      createdAt: true,
      total: true,
      amountPaid: true,
      creditedAmount: true,
      customer: { select: { name: true } },
    },
  });

  const allLines: ARAgingLine[] = invoices.map((inv) => {
    const amountPaid = Number(inv.amountPaid);
    // FIX — subtract creditedAmount (postSalesReturn's AR reversal), or a
    // returned invoice keeps aging on units the customer no longer owes
    // for and this report drifts from the ledger's actual AR balance.
    const outstanding = this.round2(Number(inv.total) - amountPaid - Number(inv.creditedAmount));
    const effectiveDueDate = inv.dueDate ?? inv.invoiceDate ?? inv.issuedAt ?? inv.createdAt;
    const daysOverdue = Math.floor((asOf.getTime() - effectiveDueDate.getTime()) / 86_400_000);
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customerName: inv.customer?.name ?? inv.customerName,
      invoiceDate: inv.invoiceDate,
      dueDate: effectiveDueDate,
      total: Number(inv.total),
      amountPaid,
      outstanding,
      daysOverdue,
      bucket: this.assignBucket(daysOverdue),
    };
  });

  const byCustomerMap = new Map<string, ARAgingByCustomer>();
  const totals: Omit<ARAgingByCustomer, 'customerId' | 'customerName'> = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90plus: 0,
    total: 0,
  };

  for (const line of allLines) {
    const key = line.customerId ?? `unlinked:${line.customerName ?? line.invoiceId}`;
    const field = this.bucketField(line.bucket);

    let entry = byCustomerMap.get(key);
    if (!entry) {
      entry = {
        customerId: line.customerId,
        customerName: line.customerName,
        current: 0,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        d90plus: 0,
        total: 0,
      };
      byCustomerMap.set(key, entry);
    }
    entry[field] = this.round2(entry[field] + line.outstanding);
    entry.total = this.round2(entry.total + line.outstanding);

    totals[field] = this.round2(totals[field] + line.outstanding);
    totals.total = this.round2(totals.total + line.outstanding);
  }

  const byCustomer = [...byCustomerMap.values()].sort((a, b) => b.total - a.total);

  const arAccountId = await this.accounts.resolve(organizationId, SystemAccountKey.ACCOUNTS_RECEIVABLE);
  const arAgg = await this.prisma.journalEntryLine.aggregate({
    where: {
      accountId: arAccountId,
      journalEntry: { organizationId, status: JournalEntryStatus.POSTED, entryDate: { lte: asOf } },
    },
    _sum: { debit: true, credit: true },
  });
  const arLedgerBalance = this.round2(Number(arAgg._sum.debit ?? 0) - Number(arAgg._sum.credit ?? 0));

  const reconciliation = {
    arLedgerBalance,
    sumOfOutstandingInvoices: totals.total,
    matches: Math.abs(arLedgerBalance - totals.total) < EPS,
  };
  if (!reconciliation.matches) {
    this.logger.error(
      `AR aging does not reconcile for org ${organizationId} as of ${asOf.toISOString()}: ` +
        `ledger AR balance=${arLedgerBalance} vs sum of outstanding invoices=${totals.total}. ` +
        `Some invoice's amountPaid/paymentStatus may have drifted from what was actually posted.`,
    );
  }

  const filtered = allLines
    .filter((l) => (opts.bucket ? l.bucket === opts.bucket : true))
    .filter((l) => (opts.customerId ? l.customerId === opts.customerId : true))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding);

  const lines = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    asOf,
    lines,
    pagination: this.buildPagination(page, pageSize, filtered.length),
    byCustomer,
    totals,
    reconciliation,
  };
}
  // ---------------------------------------------------------------------
  // AP Aging — ledger-derived. Same paging model as AR. The old per-PO
  // query loop is replaced by three set-based queries.
  // ---------------------------------------------------------------------
  async getAPAging(
    organizationId: string,
    asOf: Date,
    opts: PageParams & { bucket?: AgingBucket; supplierId?: string } = {},
  ): Promise<APAgingReport> {
    const { page, pageSize } = this.normalizePaging(opts, 50, 200);

    const apAccountId = await this.accounts.resolve(organizationId, SystemAccountKey.ACCOUNTS_PAYABLE);

    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: {
        organizationId,
        status: {
          in: [PurchaseOrderStatus.SENT, PurchaseOrderStatus.PARTIALLY_RECEIVED, PurchaseOrderStatus.FULLY_RECEIVED],
        },
        goodsReceipts: { some: {} }, // nothing's owed until something arrived
      },
      select: {
        id: true,
        poNumber: true,
        supplierId: true,
        orderDate: true,
        dueDate: true,
        expectedDate: true,
        createdAt: true,
        supplier: { select: { name: true } },
        goodsReceipts: { select: { id: true } },
      },
    });

    // receiptId -> purchaseOrderId, so one ledger query can be split per PO.
    const receiptToPo = new Map<string, string>();
    for (const po of purchaseOrders) {
      for (const r of po.goodsReceipts) receiptToPo.set(r.id, po.id);
    }
    const receiptIds = [...receiptToPo.keys()];

    // 1) AP credited by goods receipts, as of `asOf`.
    const owedByPo = new Map<string, number>();
    if (receiptIds.length > 0) {
      const creditLines = await this.prisma.journalEntryLine.findMany({
        where: {
          accountId: apAccountId,
          journalEntry: {
            organizationId,
            status: JournalEntryStatus.POSTED,
            sourceType: JournalSourceType.GOODS_RECEIPT,
            sourceId: { in: receiptIds },
            entryDate: { lte: asOf },
          },
        },
        select: { credit: true, journalEntry: { select: { sourceId: true } } },
      });
      for (const l of creditLines) {
        const sourceId = l.journalEntry.sourceId;
        const poId = sourceId ? receiptToPo.get(sourceId) : undefined;
        if (!poId) continue;
        owedByPo.set(poId, (owedByPo.get(poId) ?? 0) + Number(l.credit));
      }
    }

    // 2) Supplier payments as of `asOf`, grouped per PO.
    const paidRows = await this.prisma.supplierPayment.groupBy({
      by: ['purchaseOrderId'],
      where: { organizationId, paidAt: { lte: asOf } },
      _sum: { amount: true },
    });
    const paidByPo = new Map<string, number>(
      paidRows.map((r) => [r.purchaseOrderId, Number(r._sum.amount ?? 0)]),
    );

    const allLines: APAgingLine[] = [];
    for (const po of purchaseOrders) {
      const totalOwed = this.round2(owedByPo.get(po.id) ?? 0);
      if (totalOwed <= 0) continue;

      const amountPaid = paidByPo.get(po.id) ?? 0;
      const outstanding = this.round2(totalOwed - amountPaid);
      if (outstanding <= 0) continue; // fully paid as of this date

      // Fallback chain only matters for POs created before dueDate existed.
      const effectiveDueDate = po.dueDate ?? po.expectedDate ?? po.orderDate ?? po.createdAt;
      const daysOverdue = Math.floor((asOf.getTime() - effectiveDueDate.getTime()) / 86_400_000);

      allLines.push({
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        supplierId: po.supplierId,
        supplierName: po.supplier?.name ?? null,
        orderDate: po.orderDate,
        dueDate: effectiveDueDate,
        totalOwed,
        amountPaid,
        outstanding,
        daysOverdue,
        bucket: this.assignBucket(daysOverdue),
      });
    }

    const totals: APAgingByBucket = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
    for (const line of allLines) {
      const field = this.bucketField(line.bucket);
      totals[field] = this.round2(totals[field] + line.outstanding);
      totals.total = this.round2(totals.total + line.outstanding);
    }

    // 3) Ledger AP balance as one aggregate, for reconciliation.
    const apAgg = await this.prisma.journalEntryLine.aggregate({
      where: {
        accountId: apAccountId,
        journalEntry: { organizationId, status: JournalEntryStatus.POSTED, entryDate: { lte: asOf } },
      },
      _sum: { debit: true, credit: true },
    });
    const apLedgerBalance = this.round2(Number(apAgg._sum.credit ?? 0) - Number(apAgg._sum.debit ?? 0));

    const reconciliation = {
      apLedgerBalance,
      sumOfOutstandingPOs: totals.total,
      matches: Math.abs(apLedgerBalance - totals.total) < EPS,
    };
    if (!reconciliation.matches) {
      this.logger.error(
        `AP aging does not reconcile for org ${organizationId} as of ${asOf.toISOString()}: ` +
          `ledger AP balance=${apLedgerBalance} vs sum of outstanding POs=${totals.total}.`,
      );
    }

    const filtered = allLines
      .filter((l) => (opts.bucket ? l.bucket === opts.bucket : true))
      .filter((l) => (opts.supplierId ? l.supplierId === opts.supplierId : true))
      .sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding);

    const lines = filtered.slice((page - 1) * pageSize, page * pageSize);

    return {
      asOf,
      dueDateCaveat:
        'Aging uses PurchaseOrder.dueDate. POs created before that field existed fall back to expectedDate (a delivery expectation, not payment terms), then orderDate — those rows age approximately rather than against real supplier terms.',
      lines,
      pagination: this.buildPagination(page, pageSize, filtered.length),
      totals,
      reconciliation,
    };
  }

  // ---------------------------------------------------------------------
  // Profit & Loss — the only report with a location filter. Only lines
  // whose locationId was set at posting time (revenue, COGS, inventory
  // adjustments, location-tagged expenses) count toward the filtered
  // totals; anything with no locationId (payroll always, plus any expense
  // entered without a location) is broken out separately under
  // `unallocated` rather than silently excluded — see ProfitAndLossReport.
  // ---------------------------------------------------------------------
  async getProfitAndLoss(
    organizationId: string,
    from: Date,
    to: Date,
    locationId?: string,
  ): Promise<ProfitAndLossReport> {
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: {
          organizationId,
          status: JournalEntryStatus.POSTED,
          entryDate: { gte: from, lte: to },
        },
        account: { type: { in: [AccountType.REVENUE, AccountType.EXPENSE] } },
      },
      select: {
        debit: true,
        credit: true,
        locationId: true,
        account: { select: { id: true, code: true, name: true, type: true, systemKey: true } },
      },
    });

    const scoped = locationId ? lines.filter((l) => l.locationId === locationId) : lines;
    const main = this.summarizePnlLines(scoped);

    const unallocated = locationId
      ? (() => {
          const u = this.summarizePnlLines(lines.filter((l) => l.locationId == null));
          return {
            revenue: u.revenue,
            operatingExpenses: u.operatingExpenses,
            totalRevenue: u.totalRevenue,
            totalOperatingExpenses: u.totalOperatingExpenses,
            netAmount: this.round2(u.totalRevenue - u.cogs - u.totalOperatingExpenses),
          };
        })()
      : undefined;

    return { from, to, ...main, unallocated };
  }

  private summarizePnlLines(
    lines: { debit: Prisma.Decimal; credit: Prisma.Decimal; account: { id: string; code: string; name: string; type: AccountType; systemKey: SystemAccountKey | null } }[],
  ) {
    const byAccount = new Map<
      string,
      { code: string; name: string; type: AccountType; systemKey: SystemAccountKey | null; amount: number }
    >();

    for (const line of lines) {
      const acc = line.account;
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      const delta = acc.type === AccountType.REVENUE ? credit - debit : debit - credit;

      const existing = byAccount.get(acc.id);
      if (existing) {
        existing.amount += delta;
      } else {
        byAccount.set(acc.id, { code: acc.code, name: acc.name, type: acc.type, systemKey: acc.systemKey, amount: delta });
      }
    }

    const revenue: ProfitAndLossLine[] = [];
    const operatingExpenses: ProfitAndLossLine[] = [];
    let cogs = 0;

    for (const [accountId, acc] of byAccount) {
      if (acc.type === AccountType.REVENUE) {
        revenue.push({ accountId, code: acc.code, name: acc.name, amount: acc.amount });
      } else if (acc.systemKey === SystemAccountKey.COST_OF_GOODS_SOLD) {
        cogs += acc.amount;
      } else {
        operatingExpenses.push({ accountId, code: acc.code, name: acc.name, amount: acc.amount });
      }
    }

    revenue.sort((a, b) => b.amount - a.amount);
    operatingExpenses.sort((a, b) => b.amount - a.amount);

    const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
    const grossProfit = totalRevenue - cogs;
    const totalOperatingExpenses = operatingExpenses.reduce((sum, e) => sum + e.amount, 0);
    const netProfit = grossProfit - totalOperatingExpenses;

    return {
      revenue,
      totalRevenue: this.round2(totalRevenue),
      cogs: this.round2(cogs),
      grossProfit: this.round2(grossProfit),
      grossMargin: totalRevenue > 0 ? this.round2((grossProfit / totalRevenue) * 100) : 0,
      operatingExpenses,
      totalOperatingExpenses: this.round2(totalOperatingExpenses),
      netProfit: this.round2(netProfit),
      netMargin: totalRevenue > 0 ? this.round2((netProfit / totalRevenue) * 100) : 0,
    };
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  private assignBucket(daysOverdue: number): AgingBucket {
    if (daysOverdue <= 0) return 'current';
    if (daysOverdue <= 30) return '1-30';
    if (daysOverdue <= 60) return '31-60';
    if (daysOverdue <= 90) return '61-90';
    return '90+';
  }

  private bucketField(b: AgingBucket): 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus' {
    return b === 'current'
      ? 'current'
      : b === '1-30'
      ? 'd1_30'
      : b === '31-60'
      ? 'd31_60'
      : b === '61-90'
      ? 'd61_90'
      : 'd90plus';
  }

  private normalizePaging(p: PageParams, defaultSize: number, maxSize: number) {
    const page = p.page && p.page > 0 ? Math.floor(p.page) : 1;
    const pageSize = p.pageSize && p.pageSize > 0 ? Math.min(Math.floor(p.pageSize), maxSize) : defaultSize;
    return { page, pageSize };
  }

  private buildPagination(page: number, pageSize: number, total: number): Pagination {
    return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }
}