import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, JournalSourceType, PaymentMethod, SystemAccountKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountResolverService } from './account-resolver.service';
import { JournalService } from './journal.service';

type Db = Prisma.TransactionClient | PrismaService;

// Every method here takes an optional `tx`. Pass the same tx the calling
// document service is already inside — see the note atop journal.service.ts.
// Reads in these methods use `tx` too, not `this.prisma`, so they see the
// document's own uncommitted write (e.g. the invoice row InvoiceService.issue()
// just created inside its transaction) rather than a stale/absent row on a
// separate connection.
@Injectable()
export class PostingRulesService {
  constructor(
    private prisma: PrismaService,
    private accounts: AccountResolverService,
    private journal: JournalService,
  ) {}

  private db(tx?: Prisma.TransactionClient): Db {
    return tx ?? this.prisma;
  }

  // Invoice → AR (debit) + Revenue (credit) + Tax Payable (credit, if any)
  // Call this from InvoiceService.issue(), right after the invoice row is
  // updated to ISSUED, passing the same tx.
  //
  // FIX — the Revenue line now carries invoice.locationId. AR and Sales Tax
  // Payable are left untagged deliberately: they're balance-sheet accounts
  // that getProfitAndLoss() never queries (it only pulls REVENUE/EXPENSE
  // account types), so tagging them wouldn't change any report this fixes.
  // If a per-location Balance Sheet/Trial Balance is ever wanted (not just
  // P&L), AR/Inventory/Cash would need the same treatment — that's a
  // separate, larger decision about what "per-branch balance sheet" even
  // means here, not folded into this fix.
  async postInvoiceIssued(organizationId: string, invoiceId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const invoice = await db.invoice.findFirstOrThrow({ where: { id: invoiceId, organizationId } });

    const [ar, revenue, taxPayable] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.ACCOUNTS_RECEIVABLE, db),
      this.accounts.resolve(organizationId, SystemAccountKey.SALES_REVENUE, db),
      Number(invoice.taxAmount) > 0
        ? this.accounts.resolve(organizationId, SystemAccountKey.SALES_TAX_PAYABLE, db)
        : Promise.resolve(null),
    ]);

    // A 100%-discount invoice is legitimate (comps, goodwill credits) and
    // must still be issuable/editable — there's just nothing to post.
    const netRevenue = Number(invoice.subtotal) - Number(invoice.discount);
    const total = Number(invoice.total);

    // FIX — was `if (netRevenue <= 0) return null`, which skipped posting
    // entirely — including AR and tax — for a 100%-discounted invoice
    // that still carries tax (e.g. a promotional item where tax is still
    // legally due). invoice.total would be > 0 (tax only) but no journal
    // entry, and critically no AR debit, was ever created. A later
    // payment against that invoice would then credit AR down from zero
    // into a negative balance instead of correctly zeroing out a debited
    // AR. Only skip when there's truly nothing to post at all.
    if (total <= 0) return null;

    return this.journal.postEntry(
      organizationId,
      {
        date: invoice.invoiceDate ?? invoice.issuedAt ?? new Date(),
        memo: `Invoice ${invoice.invoiceNumber ?? invoice.id} issued`,
        sourceType: JournalSourceType.INVOICE,
        sourceId: invoice.id,
        lines: [
          { accountId: ar, debit: total, description: 'Total invoiced' },
          ...(netRevenue > 0
            ? [{
                accountId: revenue,
                credit: netRevenue,
                description: 'Net revenue',
                locationId: invoice.locationId ?? undefined, // FIX
              }]
            : []),
          ...(taxPayable && Number(invoice.taxAmount) > 0
            ? [{ accountId: taxPayable, credit: Number(invoice.taxAmount), description: 'Sales tax collected' }]
            : []),
        ],
      },
      tx,
    );
  }

  // Centralizes the sourceId convention for an invoice's own journal
  // entries (revenue/AR/tax + issue-time COGS). Does NOT include
  // DeliveryOrder-ship or session-pick COGS — those belong to their own
  // documents and are reversed by their own return/cancel flows, never by
  // voidInvoice directly.
  invoiceJournalSourceIds(invoiceId: string): string[] {
    return [invoiceId, `${invoiceId}:cogs:issue`];
  }

  // Centralizes the sourceId convention for a payroll run's journal entries
  // (postPayrollRun's `payrollId` + postPayrollPaid's `${payrollId}:paid`,
  // which only exists once the run reached PAID). voidAllForSource no-ops
  // on a sourceId with no posted entry, so it's safe to always pass both
  // regardless of which stage the run actually reached.
  payrollJournalSourceIds(payrollId: string): string[] {
    return [payrollId, `${payrollId}:paid`];
  }

  // COGS → Cost of Goods Sold (debit) + Inventory (credit), for the
  // portion of physical stock that ACTUALLY left the building. Call this
  // wherever stockService.fulfill()/decrease() is called for a sale:
  //   - InvoiceService.issue()'s per-item fulfill() loop (non-warehouse orgs)
  //   - DeliveryOrder.ship()'s decrement (both sales-order and invoice-sourced)
  //   - SessionsService.addItem()'s PICK case, for warehouse-ops orgs — see
  //     that file for the caveat about double-posting risk
  // NOT at invoice issuance as a blanket rule — under the oversell model,
  // an invoice can be issued (revenue recognized) before all its lines
  // physically ship, so COGS has to track the shipment event, not the
  // invoice event, or you'll expense inventory that hasn't left yet.
  //
  // sourceId should be unique per fulfillment EVENT, not per invoice —
  // e.g. `${invoiceId}:cogs:issue` for the issue()-time fulfillment and
  // `${deliveryOrderId}:cogs` for a later DeliveryOrder.ship() — since a
  // single invoice can have multiple shipment events over its life.
  //
  // FIX — lines now accept an optional per-line locationId (a delivery
  // order's items can span more than one location, and each item already
  // snapshots its own). A single JournalEntryLine can only carry ONE
  // locationId, so billable lines are grouped by location first and one
  // COGS/Inventory pair is emitted per group, all inside the same entry —
  // the entry still balances as a whole even though no single pair does
  // on its own when there's more than one location involved. A line with
  // no locationId (null/undefined) is its own group, same as before.
  async postCogs(
    organizationId: string,
    params: {
      sourceId: string;
      date: Date;
      memo: string;
      lines: { productId: string; quantity: number; unitCost: number | null; locationId?: string | null }[];
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.db(tx);
    const billable = params.lines.filter((l) => l.unitCost != null && l.quantity > 0);
    if (billable.length === 0) return null; // nothing costed (e.g. unitCost never set) — skip rather than post a zero entry

    const totalCost = billable.reduce((sum, l) => sum + l.quantity * l.unitCost!, 0);
    if (totalCost <= 0) return null;

    const [cogs, inventory] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.COST_OF_GOODS_SOLD, db),
      this.accounts.resolve(organizationId, SystemAccountKey.INVENTORY, db),
    ]);

    const byLocation = new Map<string | null, number>();
    for (const l of billable) {
      const key = l.locationId ?? null;
      byLocation.set(key, (byLocation.get(key) ?? 0) + l.quantity * l.unitCost!);
    }

    // FIX — a per-location group whose amount rounds to 0.00 (e.g. a very
    // low-cost line, or heavy weighted-average rounding) used to still
    // emit a {debit:0}/{credit:0} pair. journal.validateLines() rejects
    // any line with both debit and credit at zero, which aborted the
    // WHOLE entry — including every other location's real amount — and
    // with it the entire invoice-issue/delivery-ship transaction that
    // called postCogs. Skip a zero-rounded group instead of emitting it.
    const lines = [...byLocation.entries()].flatMap(([locationId, amount]) => {
      const rounded = this.round2(amount);
      if (rounded === 0) return [];
      return [
        { accountId: cogs, debit: rounded, description: 'Cost of goods sold', locationId: locationId ?? undefined },
        { accountId: inventory, credit: rounded, description: 'Inventory shipped', locationId: locationId ?? undefined },
      ];
    });
    if (lines.length === 0) return null;

    return this.journal.postEntry(
      organizationId,
      {
        date: params.date,
        memo: params.memo,
        sourceType: JournalSourceType.INVOICE,
        sourceId: params.sourceId,
        lines,
      },
      tx,
    );
  }

  // Corrects a single already-posted COGS line by its cost delta — used
  // when InvoiceService.recostInvoiceItem() replaces a provisional cost
  // (booked while a line oversold, before the real purchase cost was
  // known) with the real one. Posts only the difference, under its own
  // sourceId, so the original postCogs() entry from issue() is never
  // touched or duplicated. delta > 0 (cost went up): more COGS, same as
  // postCogs. delta < 0: reverses the excess (Dr Inventory, Cr COGS).
  async postCogsCorrection(
    organizationId: string,
    params: { sourceId: string; date: Date; memo: string; deltaAmount: number; locationId?: string | null },
    tx?: Prisma.TransactionClient,
  ) {
    const rounded = this.round2(params.deltaAmount);
    if (rounded === 0) return null;

    const db = this.db(tx);
    const [cogs, inventory] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.COST_OF_GOODS_SOLD, db),
      this.accounts.resolve(organizationId, SystemAccountKey.INVENTORY, db),
    ]);

    const amount = Math.abs(rounded);
    const lines = rounded > 0
      ? [
          { accountId: cogs, debit: amount, description: 'Cost of goods sold (correction)', locationId: params.locationId ?? undefined },
          { accountId: inventory, credit: amount, description: 'Inventory (correction)', locationId: params.locationId ?? undefined },
        ]
      : [
          { accountId: inventory, debit: amount, description: 'Inventory (correction)', locationId: params.locationId ?? undefined },
          { accountId: cogs, credit: amount, description: 'Cost of goods sold (correction)', locationId: params.locationId ?? undefined },
        ];

    return this.journal.postEntry(
      organizationId,
      {
        date: params.date,
        memo: params.memo,
        sourceType: JournalSourceType.INVOICE,
        sourceId: params.sourceId,
        lines,
      },
      tx,
    );
  }

  // Payment (against an invoice) → Cash/Bank (debit) + AR (credit)
  async postPayment(organizationId: string, paymentId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const payment = await db.payment.findFirstOrThrow({
      where: { id: paymentId, invoice: { organizationId } },
      include: { invoice: true },
    });
    const amount = Number(payment.amount);

    const [cash, ar] = await Promise.all([
      this.resolveCashDestination(organizationId, payment.method, payment.bankAccountId, db),
      this.accounts.resolve(organizationId, SystemAccountKey.ACCOUNTS_RECEIVABLE, db),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: payment.createdAt,
        memo: `Payment received for invoice ${payment.invoice.invoiceNumber ?? payment.invoice.id}`,
        sourceType: JournalSourceType.PAYMENT,
        sourceId: payment.id,
        lines: [
          { accountId: cash, debit: amount },
          { accountId: ar, credit: amount },
        ],
      },
      tx,
    );
  }

  // Goods Receipt → Inventory (debit, net of discount) + Input VAT
  // Receivable (debit, if the PO has tax) + AP (credit, the real amount
  // owed — net cost plus tax). Liability is recognized here, not at PO
  // creation — a PO is a commitment, not yet a debt, since nothing's
  // arrived. Call from GoodsReceiptService.receive(), right after the
  // PurchaseOrder status update, passing the same tx.
  //
  // PO-level discountAmount/taxAmount are allocated PROPORTIONALLY to
  // this receipt, based on what fraction of the PO's pre-tax subtotal
  // this receipt's raw (qty × unitCost) value represents. This has to be
  // proportional rather than "apply it all on the first/last receipt",
  // because a PO can be received across several partial GoodsReceipts —
  // summed across ALL of them, the proportional shares always add up to
  // exactly the PO's real discountAmount/taxAmount, however it gets split.
  async postGoodsReceipt(organizationId: string, goodsReceiptId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const receipt = await db.goodsReceipt.findFirstOrThrow({
      where: { id: goodsReceiptId, organizationId },
      include: {
        items: { include: { purchaseOrderItem: true } },
        purchaseOrder: { select: { subtotal: true, discountAmount: true, taxAmount: true, taxRateId: true } },
      },
    });

    const receiptSubtotal = receipt.items.reduce(
      (sum, item) => sum + item.quantity * Number(item.purchaseOrderItem.unitCost),
      0,
    );
    if (receiptSubtotal <= 0) throw new BadRequestException('Goods receipt has no value to post');

    const po = receipt.purchaseOrder;
    const poSubtotal = Number(po.subtotal);
    // Guard against a zero/garbage PO.subtotal — falls back to posting
    // this receipt with no tax/discount allocated rather than dividing by
    // zero. A real PO with items should never hit this, but a defensive
    // fallback beats a crash on a malformed one.
    const proportion = poSubtotal > 0 ? receiptSubtotal / poSubtotal : 0;

    const allocatedDiscount = this.round2(Number(po.discountAmount) * proportion);
    const allocatedTax = this.round2(Number(po.taxAmount) * proportion);
    const netInventoryValue = this.round2(receiptSubtotal - allocatedDiscount);
    const totalOwed = this.round2(netInventoryValue + allocatedTax);

    if (netInventoryValue <= 0) {
      throw new BadRequestException('Allocated discount exceeds this receipt\'s value — check the PO\'s discountAmount');
    }

    const [inventory, ap, inputVat] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.INVENTORY, db),
      this.accounts.resolve(organizationId, SystemAccountKey.ACCOUNTS_PAYABLE, db),
      allocatedTax > 0
        ? this.accounts.resolve(organizationId, SystemAccountKey.PURCHASE_TAX_RECEIVABLE, db)
        : Promise.resolve(null),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: receipt.createdAt,
        memo: `Goods receipt ${receipt.receiptNumber ?? receipt.id}`,
        sourceType: JournalSourceType.GOODS_RECEIPT,
        sourceId: receipt.id,
        lines: [
          { accountId: inventory, debit: netInventoryValue, description: 'Inventory received, net of allocated discount' },
          ...(inputVat && allocatedTax > 0
            ? [{ accountId: inputVat, debit: allocatedTax, description: 'Input VAT on this receipt' }]
            : []),
          { accountId: ap, credit: totalOwed, description: 'Amount owed to supplier' },
        ],
      },
      tx,
    );
  }

  // Supplier Payment → AP (debit) + Cash/Bank (credit)
  async postSupplierPayment(organizationId: string, supplierPaymentId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const payment = await db.supplierPayment.findFirstOrThrow({ where: { id: supplierPaymentId, organizationId } });

    const [ap, cash] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.ACCOUNTS_PAYABLE, db),
      this.resolveCashDestination(organizationId, payment.method, payment.bankAccountId, db),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: payment.paidAt,
        memo: `Payment to supplier for PO ${payment.purchaseOrderId}`,
        sourceType: JournalSourceType.SUPPLIER_PAYMENT,
        sourceId: payment.id,
        lines: [
          { accountId: ap, debit: Number(payment.amount) },
          { accountId: cash, credit: Number(payment.amount) },
        ],
      },
      tx,
    );
  }

  // Expense → on creation: Expense (debit) + Expense Payable (credit).
  // on markPaid: Expense Payable (debit) + Cash/Bank (credit).
  //
  // FIX — the Expense line now carries expense.locationId, same rationale
  // as postInvoiceIssued's Revenue line: this is a REVENUE/EXPENSE
  // account, so getProfitAndLoss() reads it, and per-location P&L is only
  // as complete as the expense side is tagged, not just the revenue side.
  async postExpenseRecorded(organizationId: string, expenseId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const expense = await db.expense.findFirstOrThrow({
      where: { id: expenseId, organizationId },
      include: { category: true },
    });

    const [expenseAccount, payable] = await Promise.all([
      expense.category.accountId
        ? Promise.resolve(expense.category.accountId)
        : this.accounts.resolve(organizationId, SystemAccountKey.UNCATEGORIZED_EXPENSE, db),
      this.accounts.resolve(organizationId, SystemAccountKey.EXPENSE_PAYABLE, db),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: expense.expenseDate,
        memo: `Expense recorded: ${expense.category.name}${expense.description ? ' — ' + expense.description : ''}`,
        sourceType: JournalSourceType.EXPENSE,
        sourceId: expense.id,
        lines: [
          {
            accountId: expenseAccount,
            debit: Number(expense.amount),
            locationId: expense.locationId ?? undefined, // FIX
          },
          { accountId: payable, credit: Number(expense.amount) },
        ],
      },
      tx,
    );
  }

  // FIX — replaces postExpensePaid below. That method posted the expense's
  // FULL amount under one fixed sourceId (`${expenseId}:paid`), which only
  // works for a single all-or-nothing payment: a second payment against the
  // same expense would collide on that sourceId. This posts one entry per
  // ExpensePayment row, for that payment's own amount, keyed by the
  // payment's own id — the same pattern postPayment() already uses for
  // Invoice payments.
  async postExpensePayment(organizationId: string, paymentId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const payment = await db.expensePayment.findFirstOrThrow({
      where: { id: paymentId, expense: { organizationId } },
      include: { expense: true },
    });

    const [payable, cash] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.EXPENSE_PAYABLE, db),
      this.resolveCashDestination(organizationId, payment.method, payment.bankAccountId, db),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: payment.createdAt,
        memo: `Expense payment: ${payment.expense.id}`,
        sourceType: JournalSourceType.EXPENSE,
        sourceId: payment.id,
        lines: [
          { accountId: payable, debit: Number(payment.amount) },
          { accountId: cash, credit: Number(payment.amount) },
        ],
      },
      tx,
    );
  }

  // Payroll → Salary Expense (debit, = sum of gross pay) split into
  // Payroll Payable (credit, = net pay) and one credit per deduction type,
  // routed to each component's own payable account when configured.
  // Balances by construction: gross = net + deductions.
  async postPayrollRun(organizationId: string, payrollId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const payroll = await db.payroll.findFirstOrThrow({
      where: { id: payrollId, organizationId },
      include: { items: { include: { components: { include: { component: true } } } } },
    });

    const totalGross = payroll.items.reduce((sum, i) => sum + Number(i.grossPay), 0);
    const totalNet = payroll.items.reduce((sum, i) => sum + Number(i.netPay), 0);
    if (totalGross <= 0) throw new BadRequestException('Payroll run has no gross pay to post');

    const fallbackPayable = await this.accounts.resolve(organizationId, SystemAccountKey.PAYROLL_DEDUCTIONS_PAYABLE, db);
    const deductionTotals = new Map<string, number>();
    for (const item of payroll.items) {
      for (const comp of item.components) {
        if (comp.type !== 'DEDUCTION') continue;
        const accountId = comp.component.accountId ?? fallbackPayable;
        deductionTotals.set(accountId, (deductionTotals.get(accountId) ?? 0) + Number(comp.amount));
      }
    }

    const [salaryExpense, payrollPayable] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.SALARY_EXPENSE, db),
      this.accounts.resolve(organizationId, SystemAccountKey.PAYROLL_PAYABLE, db),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: payroll.documentDate,
        memo: `Payroll ${payroll.periodMonth}/${payroll.periodYear} (${payroll.payType})`,
        sourceType: JournalSourceType.PAYROLL,
        sourceId: payroll.id,
        lines: [
          { accountId: salaryExpense, debit: totalGross, description: 'Gross salary expense' },
          { accountId: payrollPayable, credit: totalNet, description: 'Net pay owed to employees' },
          ...[...deductionTotals.entries()].map(([accountId, amount]) => ({
            accountId,
            credit: amount,
            description: 'Payroll deduction payable',
          })),
        ],
      },
      tx,
    );
  }

  // Inverse of postCogs — Inventory (debit) + COGS (credit), for goods a
  // customer returned. Call from DeliveryOrderService.recordReturn(),
  // for the same lines whose stock gets increase()'d back.
  //
  // FIX — same per-line locationId + group-by-location treatment as
  // postCogs, for the same reason.
  async postCogsReturn(
    organizationId: string,
    params: {
      sourceId: string;
      date: Date;
      memo: string;
      lines: { productId: string; quantity: number; unitCost: number | null; locationId?: string | null }[];
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.db(tx);
    const billable = params.lines.filter((l) => l.unitCost != null && l.quantity > 0);
    if (billable.length === 0) return null;

    const totalCost = billable.reduce((sum, l) => sum + l.quantity * l.unitCost!, 0);
    if (totalCost <= 0) return null;

    const [cogs, inventory] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.COST_OF_GOODS_SOLD, db),
      this.accounts.resolve(organizationId, SystemAccountKey.INVENTORY, db),
    ]);

    const byLocation = new Map<string | null, number>();
    for (const l of billable) {
      const key = l.locationId ?? null;
      byLocation.set(key, (byLocation.get(key) ?? 0) + l.quantity * l.unitCost!);
    }

    // FIX — same zero-rounded-group issue as postCogs() above: skip a
    // group whose amount rounds to 0.00 instead of emitting a
    // {debit:0}/{credit:0} pair that would abort the whole entry.
    const lines = [...byLocation.entries()].flatMap(([locationId, amount]) => {
      const rounded = this.round2(amount);
      if (rounded === 0) return [];
      return [
        { accountId: inventory, debit: rounded, description: 'Inventory returned', locationId: locationId ?? undefined },
        { accountId: cogs, credit: rounded, description: 'Reversal of cost of goods sold', locationId: locationId ?? undefined },
      ];
    });
    if (lines.length === 0) return null;

    return this.journal.postEntry(
      organizationId,
      {
        date: params.date,
        memo: params.memo,
        sourceType: JournalSourceType.INVOICE,
        sourceId: params.sourceId,
        lines,
      },
      tx,
    );
  }

  // Inverse of postInvoiceIssued, scoped to the returned quantity only.
  // Revenue and tax are reversed proportionally off each InvoiceItem's own
  // netAmount/taxAmount (line total ÷ line quantity × returned quantity) —
  // not off DeliveryOrderItem, which only ever snapshots unitCost, not
  // price or tax. AR is credited by the same total.
  //
  // The caller (DeliveryOrderService.recordReturn()) is responsible for
  // guaranteeing that the quantities passed here cannot exceed what was
  // actually invoiced — this method trusts its input rather than
  // re-deriving a ceiling, since recordReturn() already has to compute
  // and clamp against InvoiceItem/SalesOrderItem quantities to update
  // fulfilledQuantity/deliveredQuantity correctly in the same transaction.
  //
  // NOTE — this does not touch Invoice.amountPaid or paymentStatus. If the
  // invoice was already paid, this creates a real credit balance (customer
  // is now owed money) with no refund mechanism yet to clear it — that's
  // the existing "no payment void/refund path" gap, not something this
  // method can resolve on its own. Call sites should surface that rather
  // than hide it.
  async postSalesReturn(
    organizationId: string,
    params: {
      sourceId: string;
      date: Date;
      memo: string;
      invoiceId: string;
      lines: { invoiceItemId: number; quantity: number }[];
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.db(tx);
    if (params.lines.length === 0) return null;

    const itemIds = params.lines.map((l) => l.invoiceItemId);
    const items = await db.invoiceItem.findMany({
      where: { id: { in: itemIds }, invoiceId: params.invoiceId },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));

    let revenueReversal = 0;
    let taxReversal = 0;
    for (const line of params.lines) {
      const item = itemById.get(line.invoiceItemId);
      if (!item || Number(item.quantity) === 0) continue;
      const perUnitNet = Number(item.netAmount) / Number(item.quantity);
      const perUnitTax = Number(item.taxAmount) / Number(item.quantity);
      revenueReversal += perUnitNet * line.quantity;
      taxReversal += perUnitTax * line.quantity;
    }
    revenueReversal = this.round2(revenueReversal);
    taxReversal = this.round2(taxReversal);
    const totalReversal = this.round2(revenueReversal + taxReversal);
    if (totalReversal <= 0) return null;

    // FIX — AR Aging (getARAging) is document-based: it computes outstanding
    // as invoice.total - amountPaid, which never otherwise learns that a
    // return happened. Without this, aging keeps reporting the pre-return
    // balance forever and its own reconciliation check against the ledger's
    // AR balance trips on every return. total/amountPaid stay frozen at
    // their original invoiced values on purpose (see recordReturn) — this
    // is the one place that tracks "how much of that total no longer
    // applies," same in-tx guarantee as the journal entry below.
    await db.invoice.update({
      where: { id: params.invoiceId },
      data: { creditedAmount: { increment: totalReversal } },
    });

    const [ar, revenue, taxPayable] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.ACCOUNTS_RECEIVABLE, db),
      this.accounts.resolve(organizationId, SystemAccountKey.SALES_REVENUE, db),
      taxReversal > 0
        ? this.accounts.resolve(organizationId, SystemAccountKey.SALES_TAX_PAYABLE, db)
        : Promise.resolve(null),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: params.date,
        memo: params.memo,
        sourceType: JournalSourceType.INVOICE,
        sourceId: params.sourceId,
        lines: [
          // FIX — was unconditional. If a return's revenue portion rounds
          // to 0.00 while tax is still nonzero, an unconditional
          // {debit: 0} line here would be rejected by
          // journal.validateLines(), aborting the whole return
          // transaction — the same class of bug fixed in postCogs()/
          // postCogsReturn() above, just on the revenue side.
          ...(revenueReversal > 0
            ? [{ accountId: revenue, debit: revenueReversal, description: 'Revenue reversed for return' }]
            : []),
          ...(taxPayable && taxReversal > 0
            ? [{ accountId: taxPayable, debit: taxReversal, description: 'Sales tax reversed for return' }]
            : []),
          { accountId: ar, credit: totalReversal, description: 'AR reduced for return' },
        ],
      },
      tx,
    );
  }

  // Payroll disbursement → Payroll Payable (debit, clears the liability) +
  // Cash/Bank (credit). Call from PayrollService.markPaid(), in the same
  // transaction as the POSTED -> PAID status flip — mirrors
  // postExpensePayment()'s relationship to postExpenseRecorded().
  async postPayrollPaid(organizationId: string, payrollId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const payroll = await db.payroll.findFirstOrThrow({
      where: { id: payrollId, organizationId },
      include: { items: true },
    });
    if (!payroll.paymentMethod) throw new BadRequestException('Payroll has no paymentMethod set');

    const totalNet = payroll.items.reduce((sum, i) => sum + Number(i.netPay), 0);
    if (totalNet <= 0) throw new BadRequestException('Payroll run has no net pay to disburse');

    const [payrollPayable, cash] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.PAYROLL_PAYABLE, db),
      this.resolveCashDestination(organizationId, payroll.paymentMethod, payroll.bankAccountId, db),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: payroll.paidAt ?? new Date(),
        memo: `Payroll ${payroll.periodMonth}/${payroll.periodYear} disbursed`,
        sourceType: JournalSourceType.PAYROLL,
        sourceId: `${payroll.id}:paid`,
        lines: [
          { accountId: payrollPayable, debit: totalNet, description: 'Clear payroll payable' },
          { accountId: cash, credit: totalNet, description: 'Net pay disbursed' },
        ],
      },
      tx,
    );
  }

  // Stock quantity change (adjust()/import()) → Inventory (debit/credit
  // depending on direction) against a counter account chosen by the caller.
  // 'ADJUSTMENT' routes to Inventory Adjustments (a P&L expense account) —
  // use this for anything that reflects real gain/loss on existing stock
  // (manual adjustments, and an import that nets stock DOWN, i.e. shrinkage).
  // 'OPENING_BALANCE' routes to Opening Balance Equity (a balance-sheet-only
  // account P&L never queries) — use this only for an import that nets
  // stock UP, since bulk-loading/increasing stock via import is treated as
  // establishing/adding to a balance, not a P&L event.
  //
  // Valued at unitCost * |qtyDelta|; a null unitCost (product has no
  // costPrice) or a zero qtyDelta skips posting entirely — stock still
  // moves, but nothing hits the ledger — same policy as postCogs().
  async postStockAdjustment(
    organizationId: string,
    params: {
      sourceId: string;
      date: Date;
      memo: string;
      qtyDelta: number;
      unitCost: number | null;
      locationId?: string | null;
      counter: 'ADJUSTMENT' | 'OPENING_BALANCE';
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.db(tx);
    if (params.unitCost == null || params.qtyDelta === 0) return null;

    const amount = this.round2(Math.abs(params.qtyDelta) * params.unitCost);
    if (amount <= 0) return null;

    const [inventory, counterAccount] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.INVENTORY, db),
      this.accounts.resolve(
        organizationId,
        params.counter === 'OPENING_BALANCE'
          ? SystemAccountKey.OPENING_BALANCE_EQUITY
          : SystemAccountKey.INVENTORY_ADJUSTMENT,
        db,
      ),
    ]);

    const locationId = params.locationId ?? undefined;
    const increase = params.qtyDelta > 0;

    return this.journal.postEntry(
      organizationId,
      {
        date: params.date,
        memo: params.memo,
        sourceType: JournalSourceType.STOCK_ADJUSTMENT,
        sourceId: params.sourceId,
        lines: increase
          ? [
              { accountId: inventory, debit: amount, description: 'Inventory increase', locationId },
              { accountId: counterAccount, credit: amount, description: 'Adjustment offset', locationId },
            ]
          : [
              { accountId: counterAccount, debit: amount, description: 'Adjustment offset', locationId },
              { accountId: inventory, credit: amount, description: 'Inventory decrease', locationId },
            ],
      },
      tx,
    );
  }

  // Fixed asset acquisition → Fixed Assets (debit, full cost) + Fixed
  // Asset Payable (credit, full cost) — recorded in full regardless of
  // payment status, same record-then-pay split as postExpenseRecorded()/
  // postExpensePayment(). Never touches cash, so it's invisible to
  // CashFlowService by construction; only postFixedAssetPayment() (below)
  // moves cash and lands in Investing.
  async postFixedAssetAcquired(organizationId: string, assetId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const asset = await db.fixedAsset.findFirstOrThrow({ where: { id: assetId, organizationId } });
    const cost = Number(asset.cost);
    if (cost <= 0) return null;

    const [fixedAssets, payable] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.FIXED_ASSETS, db),
      this.accounts.resolve(organizationId, SystemAccountKey.FIXED_ASSET_PAYABLE, db),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: asset.acquisitionDate,
        memo: `Fixed asset acquired: ${asset.name}`,
        sourceType: JournalSourceType.FIXED_ASSET_PURCHASE,
        sourceId: `${asset.id}:acquired`,
        lines: [
          { accountId: fixedAssets, debit: cost, description: 'Fixed asset cost', locationId: asset.locationId ?? undefined },
          { accountId: payable, credit: cost, description: 'Fixed asset payable' },
        ],
      },
      tx,
    );
  }

  // Fixed Asset Payable (debit, clears part of the liability) + Cash/Bank
  // (credit) — one entry per FixedAssetPayment row, same pattern as
  // postExpensePayment(). This is the entry CashFlowService actually sees:
  // whether an asset was paid in full at acquisition or over several
  // installments, every dollar that left cash for it posts here.
  async postFixedAssetPayment(organizationId: string, paymentId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const payment = await db.fixedAssetPayment.findFirstOrThrow({
      where: { id: paymentId, fixedAsset: { organizationId } },
      include: { fixedAsset: true },
    });

    const [payable, cash] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.FIXED_ASSET_PAYABLE, db),
      this.resolveCashDestination(organizationId, payment.method, payment.bankAccountId, db),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: payment.createdAt,
        memo: `Payment toward fixed asset: ${payment.fixedAsset.name}`,
        sourceType: JournalSourceType.FIXED_ASSET_PURCHASE,
        sourceId: payment.id,
        lines: [
          { accountId: payable, debit: Number(payment.amount) },
          { accountId: cash, credit: Number(payment.amount) },
        ],
      },
      tx,
    );
  }

  // Depreciation → Depreciation Expense (debit) + Accumulated Depreciation
  // (credit, contra-asset). Call from FixedAssetsService.runDepreciation(),
  // which computes `amount` for whatever whole months elapsed since the
  // asset's lastDepreciatedThrough and advances that column in the same
  // tx — that's what makes re-running depreciation for an already
  // caught-up period a no-op instead of a double post, not this method.
  async postFixedAssetDepreciation(
    organizationId: string,
    params: { sourceId: string; date: Date; assetId: string; assetName: string; locationId?: string | null; amount: number },
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.db(tx);
    const amount = this.round2(params.amount);
    if (amount <= 0) return null;

    const [depreciationExpense, accumulatedDepreciation] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.DEPRECIATION_EXPENSE, db),
      this.accounts.resolve(organizationId, SystemAccountKey.ACCUMULATED_DEPRECIATION, db),
    ]);

    return this.journal.postEntry(
      organizationId,
      {
        date: params.date,
        memo: `Depreciation: ${params.assetName}`,
        sourceType: JournalSourceType.FIXED_ASSET_DEPRECIATION,
        sourceId: params.sourceId,
        lines: [
          { accountId: depreciationExpense, debit: amount, description: 'Depreciation expense', locationId: params.locationId ?? undefined },
          { accountId: accumulatedDepreciation, credit: amount, description: 'Accumulated depreciation' },
        ],
      },
      tx,
    );
  }

  // Disposal → clears the asset off the books (credit Fixed Assets for
  // full cost, debit Accumulated Depreciation for whatever was taken to
  // date) against cash received (debit, if any) and a gain or loss for
  // the difference between proceeds and net book value. Balances by
  // construction: debits (accumDep + proceeds + loss) - credits (cost +
  // gain) = -(cost - accumDep) + proceeds + (loss - gain), and
  // loss - gain = NBV - proceeds by definition, so it nets to zero.
  //
  // Call from FixedAssetsService.dispose() after it sets status DISPOSED,
  // disposedAt, and disposalProceeds — this reads those back rather than
  // taking them as params, so the ledger entry always matches what's on
  // the asset row.
  async postFixedAssetDisposal(
    organizationId: string,
    assetId: string,
    payment: { method?: PaymentMethod; bankAccountId?: string | null } | null,
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.db(tx);
    const asset = await db.fixedAsset.findFirstOrThrow({ where: { id: assetId, organizationId } });

    const cost = Number(asset.cost);
    const accumulatedDep = Number(asset.accumulatedDepreciation);
    const proceeds = Number(asset.disposalProceeds ?? 0);
    const netBookValue = this.round2(cost - accumulatedDep);
    const gain = this.round2(Math.max(proceeds - netBookValue, 0));
    const loss = this.round2(Math.max(netBookValue - proceeds, 0));

    const [fixedAssets, accumulatedDepreciationAcct, gainAcct, lossAcct] = await Promise.all([
      this.accounts.resolve(organizationId, SystemAccountKey.FIXED_ASSETS, db),
      this.accounts.resolve(organizationId, SystemAccountKey.ACCUMULATED_DEPRECIATION, db),
      gain > 0 ? this.accounts.resolve(organizationId, SystemAccountKey.GAIN_ON_ASSET_DISPOSAL, db) : Promise.resolve(null),
      loss > 0 ? this.accounts.resolve(organizationId, SystemAccountKey.LOSS_ON_ASSET_DISPOSAL, db) : Promise.resolve(null),
    ]);
    const cash = proceeds > 0 && payment?.method
      ? await this.resolveCashDestination(organizationId, payment.method, payment.bankAccountId, db)
      : null;
    if (proceeds > 0 && !cash) {
      throw new BadRequestException('A payment method is required to record disposal proceeds');
    }

    const lines: { accountId: string; debit?: number; credit?: number; description?: string; locationId?: string }[] = [];
    if (accumulatedDep > 0) {
      lines.push({ accountId: accumulatedDepreciationAcct, debit: accumulatedDep, description: 'Clear accumulated depreciation' });
    }
    if (proceeds > 0 && cash) {
      lines.push({ accountId: cash, debit: proceeds, description: 'Disposal proceeds received' });
    }
    lines.push({ accountId: fixedAssets, credit: cost, description: 'Remove asset cost', locationId: asset.locationId ?? undefined });
    if (gain > 0 && gainAcct) lines.push({ accountId: gainAcct, credit: gain, description: 'Gain on disposal' });
    if (loss > 0 && lossAcct) lines.push({ accountId: lossAcct, debit: loss, description: 'Loss on disposal' });

    return this.journal.postEntry(
      organizationId,
      {
        date: asset.disposedAt ?? new Date(),
        memo: `Disposal of fixed asset: ${asset.name}`,
        sourceType: JournalSourceType.FIXED_ASSET_DISPOSAL,
        sourceId: `${asset.id}:disposal`,
        lines,
      },
      tx,
    );
  }

  // Replaces the old cashOrBankKey() lookup. CASH still resolves to the
  // generic CASH systemKey account — cash isn't tied to a specific bank.
  // Anything else (TRANSFER/QRIS/OTHER) MUST name a specific
  // OrganizationBankAccount and that account MUST already have a linked
  // ChartOfAccount (created by BankAccountGLLinkService when the bank
  // account itself was created) — no silent fallback to a generic "Bank"
  // bucket, since that's exactly the "which bank was this?" information
  // this whole change exists to stop losing.
  private async resolveCashDestination(
    organizationId: string,
    method: PaymentMethod,
    bankAccountId: string | null | undefined,
    db: Db,
  ): Promise<string> {
    if (method === PaymentMethod.CASH) {
      return this.accounts.resolve(organizationId, SystemAccountKey.CASH, db);
    }

    if (!bankAccountId) {
      throw new BadRequestException(`A bankAccountId is required for payment method ${method}`);
    }

    const linked = await db.chartOfAccount.findFirst({ where: { organizationId, bankAccountId } });
    if (!linked) {
      throw new BadRequestException(
        'This bank account has no linked GL account — it may have been created before auto-linking was set up',
      );
    }
    return linked.id;
  }

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }
}