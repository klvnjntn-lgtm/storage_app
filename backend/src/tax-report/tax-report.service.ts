import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceActivityEventType, InvoiceStatus, JournalEntryStatus, JournalSourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  businessDayBounds,
  endOfBusinessDay,
  parseDateOnly,
  resolveTimezone,
  toBusinessDate,
} from '../accounting/business-date';

// Laporan Pajak: one month's sales, returns, purchases and expenses, laid out
// for the business's tax administrator, who does the calculating and filing
// themselves. It reports what the documents say and computes no tax.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = <T>(rows: T[], value: (row: T) => number) => round2(rows.reduce((s, r) => s + value(r), 0));
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// Set on the journal entry by DeliveryOrderService.recordReturn and
// SessionsService.applyLinkedReturn: `<delivery order or session id>:sales-return:...`.
const SALES_RETURN_MARKER = ':sales-return:';

// Changes that alter what was reported for an invoice. Payments don't.
const REPORTABLE_CHANGES = [InvoiceActivityEventType.EDITED, InvoiceActivityEventType.VOIDED];

// Accurate has no walk-in sale: imports book them to a customer called "CASH".
// There is no NPWP to chase for those.
const WALK_IN_NAMES = /^(cash|tunai|umum|walk[\s-]?in)$/i;
const needsNpwp = (customerId: string | null, name: string | null, npwp: string | null) =>
  !!customerId && !npwp && !WALK_IN_NAMES.test((name ?? '').trim());

// Within a rupiah counts as adding up, as for supplier bills.
const ADDS_UP_TOLERANCE = 1;

type InvoiceLine = {
  name: string;
  sku: string | null;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
  net: number;
};

function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('month must be YYYY-MM');
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

@Injectable()
export class TaxReportService {
  constructor(private prisma: PrismaService) {}

  // branchId undefined = the whole business. Records with no branch can't be
  // placed in a branch's report, so they're counted under `unassigned`
  // rather than silently left out.
  async report(organizationId: string, month: string, branchId?: string, withLines = false) {
    const { from, to } = monthRange(month);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, legalName: true, npwp: true, address: true, timezone: true, pricesIncludePpn: true },
    });
    const tz = resolveTimezone(org);
    const branches = await this.prisma.branch.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    if (branchId && !branchName.has(branchId)) throw new BadRequestException('Branch not found');

    const dates = { gte: parseDateOnly(from, 'from'), lte: parseDateOnly(to, 'to') };
    const instants = businessDayBounds(from, to, tz);
    const periodEnd = endOfBusinessDay(dates.lte, tz);
    const inBranch = (id: string | null | undefined) => !branchId || id === branchId;
    const unassigned = <T>(rows: T[], branchOf: (row: T) => string | null | undefined, amount: (row: T) => number) => {
      const loose = branchId ? rows.filter((r) => !branchOf(r)) : [];
      return { count: loose.length, total: sum(loose, amount) };
    };

    // --- Sales ---------------------------------------------------------
    // Issued and voided, so the numbering has no unexplained gaps. Invoices
    // imported from Accurate have no invoiceDate, only an issue time.
    const allInvoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.VOID] },
        OR: [
          { invoiceDate: dates },
          { invoiceDate: null, issuedAt: instants },
          { invoiceDate: null, issuedAt: null, createdAt: instants },
        ],
      },
      orderBy: [{ invoiceNumber: 'asc' }],
      include: {
        customer: { select: { npwp: true, address: true, billingAddress: true, name: true } },
      },
    });
    const invoices = allInvoices.filter((i) => inBranch(i.branchId));
    const changes = await this.prisma.invoiceActivityEvent.groupBy({
      by: ['invoiceId'],
      where: { organizationId, invoiceId: { in: invoices.map((i) => i.id) }, eventType: { in: REPORTABLE_CHANGES } },
      _max: { createdAt: true },
    });
    const changedAt = new Map(changes.map((c) => [c.invoiceId, c._max.createdAt]));

    const linesByInvoice = new Map<string, InvoiceLine[]>();
    const items = await this.prisma.invoiceItem.findMany({
      where: { invoiceId: { in: invoices.filter((i) => i.status === InvoiceStatus.ISSUED).map((i) => i.id) } },
      orderBy: { id: 'asc' },
      include: { product: { select: { name: true, sku: true } } },
    });
    for (const item of items) {
      const lineTotal = Number(item.lineTotal);
      const discount = Number(item.discountAmount);
      const lines = linesByInvoice.get(item.invoiceId) ?? [];
      lines.push({
        name: item.productName ?? item.product?.name ?? item.description ?? '',
        sku: item.product?.sku ?? null,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        lineTotal,
        discount,
        // Some imported lines never had netAmount filled in.
        net: Number(item.netAmount) || round2(lineTotal - discount),
      });
      linesByInvoice.set(item.invoiceId, lines);
    }

    const sales = invoices
      .map((inv) => {
        const lastChangedAt = changedAt.get(inv.id) ?? null;
        const customerName = inv.customerName ?? inv.customer?.name ?? null;
        const customerNpwp = inv.customerNpwp || inv.customer?.npwp || null;
        const total = Number(inv.total);
        const tax = Number(inv.taxAmount);
        const discount = Number(inv.discount);
        const lines = linesByInvoice.get(inv.id) ?? [];
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          date: isoDate(inv.invoiceDate ?? toBusinessDate(inv.issuedAt ?? inv.createdAt, tz)),
          branch: inv.branchId ? (branchName.get(inv.branchId) ?? null) : null,
          customerName,
          customerNpwp,
          needsNpwp: needsNpwp(inv.customerId, customerName, customerNpwp),
          customerAddress:
            inv.customerBillingAddress ??
            inv.customerAddress ??
            inv.customer?.billingAddress ??
            inv.customer?.address ??
            null,
          customerId: inv.customerId,
          // Worked back from the total: most Accurate imports stored a
          // subtotal of 0, and this equals the stored one on native invoices.
          subtotal: round2(total - tax + discount),
          discount,
          // Only older or imported invoices still carry recorded tax.
          tax,
          total,
          // The items don't reach the invoice total (usually a discount
          // Accurate applied to the invoice, not the lines), so the line
          // detail needs checking before it's keyed into Coretax.
          linesDiffer:
            inv.status === InvoiceStatus.ISSUED &&
            Math.abs(sum(lines, (l) => l.net) + tax - total) > ADDS_UP_TOLERANCE,
          status: inv.status,
          lastChangedAt,
          changedAfterPeriod: !!lastChangedAt && lastChangedAt > periodEnd,
          ...(withLines && { items: lines }),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || (a.invoiceNumber ?? '').localeCompare(b.invoiceNumber ?? ''));
    const issued = sales.filter((s) => s.status === InvoiceStatus.ISSUED);

    // --- Sales returns -------------------------------------------------
    const salesReturns = (await this.loadSalesReturns(organizationId, dates))
      .map((r) => ({ ...r, branch: r.branchId ? (branchName.get(r.branchId) ?? null) : null }))
      .filter((r) => inBranch(r.branchId));

    // --- Purchases: supplier bills, branch from the PO -----------------
    // A PO with no branch of its own (every Accurate import) falls back to
    // its receiving location's branch.
    const poSelect = {
      poNumber: true,
      branchId: true,
      location: { select: { branchId: true } },
      supplier: { select: { id: true, name: true, npwp: true } },
    } as const;
    const poBranch = (po: { branchId: string | null; location: { branchId: string | null } | null }) =>
      po.branchId ?? po.location?.branchId ?? null;

    const allBills = await this.prisma.supplierBill.findMany({
      where: { organizationId, billDate: dates },
      orderBy: [{ billDate: 'asc' }, { billNumber: 'asc' }],
      include: {
        supplier: { select: { id: true, name: true, npwp: true } },
        purchaseOrder: { select: poSelect },
      },
    });
    const purchases = allBills
      .filter((b) => inBranch(poBranch(b.purchaseOrder)))
      .map((b) => {
        const supplier = b.supplier ?? b.purchaseOrder.supplier;
        const id = poBranch(b.purchaseOrder);
        return {
          id: b.id,
          purchaseOrderId: b.purchaseOrderId,
          date: isoDate(b.billDate),
          billNumber: b.billNumber,
          poNumber: b.purchaseOrder.poNumber,
          branch: id ? (branchName.get(id) ?? null) : null,
          supplierId: supplier?.id ?? null,
          supplierName: supplier?.name ?? null,
          supplierNpwp: supplier?.npwp || null,
          amount: Number(b.amount),
          voided: !!b.voidedAt,
        };
      });
    const activeBills = purchases.filter((p) => !p.voided);

    // --- Purchase returns ----------------------------------------------
    const allPurchaseReturns = await this.prisma.purchaseReturn.findMany({
      where: { organizationId, createdAt: instants },
      orderBy: { createdAt: 'asc' },
      include: { purchaseOrder: { select: poSelect } },
    });
    const purchaseReturns = allPurchaseReturns
      .filter((r) => inBranch(poBranch(r.purchaseOrder)))
      .map((r) => {
        const id = poBranch(r.purchaseOrder);
        return {
          id: r.id,
          purchaseOrderId: r.purchaseOrderId,
          date: isoDate(toBusinessDate(r.createdAt, tz)),
          returnNumber: r.returnNumber,
          poNumber: r.purchaseOrder.poNumber,
          branch: id ? (branchName.get(id) ?? null) : null,
          supplierId: r.purchaseOrder.supplier?.id ?? null,
          supplierName: r.purchaseOrder.supplier?.name ?? null,
          supplierNpwp: r.purchaseOrder.supplier?.npwp || null,
          amount: Number(r.total),
        };
      });

    // --- Expenses ------------------------------------------------------
    const allExpenses = await this.prisma.expense.findMany({
      where: { organizationId, expenseDate: dates },
      orderBy: { expenseDate: 'asc' },
      include: { category: { select: { name: true } } },
    });
    const expenses = allExpenses
      .filter((e) => inBranch(e.branchId))
      .map((e) => ({
        id: e.id,
        date: isoDate(e.expenseDate),
        branch: e.branchId ? (branchName.get(e.branchId) ?? null) : null,
        category: e.category.name,
        description: e.description,
        amount: Number(e.amount),
      }));

    // --- Goods received with no bill -----------------------------------
    // Nothing in the purchases section would show these, so the admin
    // wouldn't know the month's purchases are incomplete.
    const receipts = await this.prisma.goodsReceipt.findMany({
      where: {
        organizationId,
        createdAt: instants,
        purchaseOrder: { supplierBills: { none: { voidedAt: null } } },
      },
      select: { purchaseOrderId: true, purchaseOrder: { select: poSelect } },
    });
    const unbilled = new Map<string, { poNumber: string | null; supplierName: string | null }>();
    for (const r of receipts) {
      if (!inBranch(poBranch(r.purchaseOrder))) continue;
      unbilled.set(r.purchaseOrderId, {
        poNumber: r.purchaseOrder.poNumber,
        supplierName: r.purchaseOrder.supplier?.name ?? null,
      });
    }

    const salesTotal = sum(issued, (s) => s.total);
    const salesReturnsTotal = sum(salesReturns, (r) => r.amount);
    const purchasesTotal = sum(activeBills, (p) => p.amount);
    const purchaseReturnsTotal = sum(purchaseReturns, (r) => r.amount);

    const missingCustomers = new Set(
      [...issued, ...salesReturns].filter((s) => s.needsNpwp).map((s) => s.customerId),
    );
    const missingSuppliers = new Set(
      [...activeBills, ...purchaseReturns].filter((p) => p.supplierId && !p.supplierNpwp).map((p) => p.supplierId),
    );

    return {
      month,
      from,
      to,
      generatedAt: new Date(),
      business: {
        name: org.name,
        legalName: org.legalName,
        npwp: org.npwp,
        address: org.address,
        pricesIncludePpn: org.pricesIncludePpn,
      },
      branch: branchId ? { id: branchId, name: branchName.get(branchId)! } : null,
      sales,
      salesReturns,
      purchases,
      purchaseReturns,
      expenses,
      summary: {
        sales: {
          count: issued.length,
          subtotal: sum(issued, (s) => s.subtotal),
          discount: sum(issued, (s) => s.discount),
          tax: sum(issued, (s) => s.tax),
          total: salesTotal,
        },
        voidedInvoices: sales.length - issued.length,
        changedAfterPeriod: sales.filter((s) => s.changedAfterPeriod).length,
        linesDiffer: sales.filter((s) => s.linesDiffer).length,
        salesReturns: { count: salesReturns.length, total: salesReturnsTotal },
        netSales: round2(salesTotal - salesReturnsTotal),
        purchases: { count: activeBills.length, total: purchasesTotal },
        purchaseReturns: { count: purchaseReturns.length, total: purchaseReturnsTotal },
        netPurchases: round2(purchasesTotal - purchaseReturnsTotal),
        expenses: { count: expenses.length, total: sum(expenses, (e) => e.amount) },
      },
      notes: {
        customersMissingNpwp: missingCustomers.size,
        suppliersMissingNpwp: missingSuppliers.size,
        receivedWithoutBill: [...unbilled.values()],
        unassigned: {
          sales: unassigned(
            allInvoices.filter((i) => i.status === InvoiceStatus.ISSUED),
            (i) => i.branchId,
            (i) => Number(i.total),
          ),
          purchases: unassigned(
            allBills.filter((b) => !b.voidedAt),
            (b) => poBranch(b.purchaseOrder),
            (b) => Number(b.amount),
          ),
          purchaseReturns: unassigned(
            allPurchaseReturns,
            (r) => poBranch(r.purchaseOrder),
            (r) => Number(r.total),
          ),
          expenses: unassigned(
            allExpenses,
            (e) => e.branchId,
            (e) => Number(e.amount),
          ),
        },
      },
    };
  }

  // A sales return has no document of its own: it exists as a journal entry
  // whose sourceId points at the delivery order or returns session it came
  // from, so the invoice is worked back from those.
  private async loadSalesReturns(organizationId: string, dates: { gte: Date; lte: Date }) {
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        organizationId,
        sourceType: JournalSourceType.INVOICE,
        status: JournalEntryStatus.POSTED,
        reversalOfId: null,
        sourceId: { contains: SALES_RETURN_MARKER },
        entryDate: dates,
      },
      orderBy: { entryDate: 'asc' },
      include: { lines: { select: { credit: true, branchId: true } } },
    });
    if (entries.length === 0) return [];

    const originOf = (sourceId: string | null) => (sourceId ?? '').split(SALES_RETURN_MARKER)[0];
    const originIds = [...new Set(entries.map((e) => originOf(e.sourceId)))];

    const [sessions, deliveryOrders] = await Promise.all([
      this.prisma.session.findMany({
        where: { organizationId, id: { in: originIds } },
        select: { id: true, returnInvoiceId: true },
      }),
      this.prisma.deliveryOrder.findMany({
        where: { organizationId, id: { in: originIds } },
        select: { id: true, invoiceId: true, items: { select: { salesOrderItemId: true } } },
      }),
    ]);

    // A delivery order drafted from a sales order has no invoiceId; its
    // invoice is the one billing the same sales order lines. If a line was
    // split across invoices this names the first — same customer either way.
    const soItemIds = deliveryOrders
      .filter((d) => !d.invoiceId)
      .flatMap((d) => d.items.map((i) => i.salesOrderItemId))
      .filter((id): id is NonNullable<typeof id> => id != null);
    const billedLines = soItemIds.length
      ? await this.prisma.invoiceItem.findMany({
          where: {
            salesOrderItemId: { in: soItemIds },
            invoice: { organizationId, status: InvoiceStatus.ISSUED },
          },
          orderBy: { id: 'asc' },
          select: { salesOrderItemId: true, invoiceId: true },
        })
      : [];
    const invoiceBySoItem = new Map<unknown, string>();
    for (const line of billedLines) {
      if (!invoiceBySoItem.has(line.salesOrderItemId)) invoiceBySoItem.set(line.salesOrderItemId, line.invoiceId);
    }

    const invoiceByOrigin = new Map<string, string>();
    for (const s of sessions) if (s.returnInvoiceId) invoiceByOrigin.set(s.id, s.returnInvoiceId);
    for (const d of deliveryOrders) {
      const viaLine = d.items.map((i) => invoiceBySoItem.get(i.salesOrderItemId)).find(Boolean);
      const invoiceId = d.invoiceId ?? viaLine;
      if (invoiceId) invoiceByOrigin.set(d.id, invoiceId);
    }

    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId, id: { in: [...new Set(invoiceByOrigin.values())] } },
      select: {
        id: true,
        invoiceNumber: true,
        branchId: true,
        customerId: true,
        customerName: true,
        customerNpwp: true,
        customer: { select: { name: true, npwp: true } },
      },
    });
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));

    return entries.map((entry) => {
      const invoice = invoiceById.get(invoiceByOrigin.get(originOf(entry.sourceId)) ?? '');
      const customerName = invoice?.customerName ?? invoice?.customer?.name ?? null;
      const customerNpwp = invoice?.customerNpwp || invoice?.customer?.npwp || null;
      return {
        id: entry.id,
        date: isoDate(entry.entryDate),
        invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.invoiceNumber ?? null,
        memo: entry.memo,
        // The revenue line carries the sale's branch even if the invoice
        // couldn't be traced.
        branchId: invoice?.branchId ?? entry.lines.find((l) => l.branchId)?.branchId ?? null,
        customerId: invoice?.customerId ?? null,
        customerName,
        customerNpwp,
        needsNpwp: needsNpwp(invoice?.customerId ?? null, customerName, customerNpwp),
        amount: sum(entry.lines, (l) => Number(l.credit)),
      };
    });
  }
}
