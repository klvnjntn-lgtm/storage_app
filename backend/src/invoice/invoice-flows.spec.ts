import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  InvoiceFormat,
  JournalEntryStatus,
  PaymentStatus,
  QuotationFormat,
  SessionType,
  SystemAccountKey,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceModule } from './invoice.module';
import { InvoiceService } from './invoice.service';
import { SalesQuotationModule } from '../sales-quotation/sales-quotation.module';
import { SalesQuotationService } from '../sales-quotation/sales-quotation.service';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { DeliveryOrderModule } from '../delivery-order/delivery-order.module';
import { DeliveryOrderService } from '../delivery-order/delivery-order.service';
import { SessionsService } from '../sessions/sessions.service';
import { StockService, ImportMode } from '../stock/stock.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { PayrollModule } from '../accounting/payroll.module';
import { PayrollService } from '../accounting/payroll.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Cross-document flows (quotation → order → invoice → delivery/returns/void)
// against the isolated test DB (test/setup-test-env.ts), in a fresh org
// without WAREHOUSE_OPS — the setup where invoices take stock at issue.
describe('Invoice flows across documents', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoiceService;
  let quotations: SalesQuotationService;
  let orders: SalesOrderService;
  let deliveries: DeliveryOrderService;
  let sessions: SessionsService;
  let stock: StockService;
  let payroll: PayrollService;

  let orgId: string;
  let adminId: string;
  let rackA: string;
  let rackB: string;
  let categoryId: string;
  let customerId: string;
  let ppnId: string;

  const PRICE = 100_000;
  const COST = 60_000;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, InvoiceModule, SalesQuotationModule, SalesOrderModule, DeliveryOrderModule, PayrollModule],
    }).compile();
    prisma = module.get(PrismaService);
    invoices = module.get(InvoiceService);
    quotations = module.get(SalesQuotationService);
    orders = module.get(SalesOrderService);
    deliveries = module.get(DeliveryOrderService);
    sessions = module.get(SessionsService);
    stock = module.get(StockService);
    payroll = module.get(PayrollService);

    orgId = (await prisma.organization.create({ data: { name: `Flows ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } });
    adminId = (
      await prisma.user.create({
        data: { email: `flows-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    rackA = (await prisma.location.create({ data: { name: 'Rack A', organizationId: orgId } })).id;
    rackB = (await prisma.location.create({ data: { name: 'Rack B', organizationId: orgId } })).id;
    categoryId = (await prisma.category.create({ data: { name: 'General', organizationId: orgId } })).id;
    customerId = (await prisma.customer.create({ data: { name: 'Bengkel Jaya', organizationId: orgId } })).id;
    ppnId = (await prisma.organizationTaxRate.create({ data: { organizationId: orgId, name: 'PPN', percentage: 11 } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  async function product(stockAt: Record<string, number> = { [rackA]: 10 }) {
    const p = await prisma.product.create({
      data: {
        name: `Part ${randomUUID().slice(0, 6)}`,
        sku: `P-${randomUUID().slice(0, 8)}`,
        categoryId,
        organizationId: orgId,
        sellingPrice: PRICE,
        costPrice: COST,
      },
    });
    for (const [locationId, quantity] of Object.entries(stockAt)) {
      await prisma.stock.create({ data: { productId: p.id, locationId, organizationId: orgId, quantity } });
    }
    return p.id;
  }

  async function qtyAt(productId: string, locationId: string) {
    const row = await prisma.stock.findUnique({ where: { productId_locationId: { productId, locationId } } });
    return Number(row?.quantity ?? 0);
  }

  async function arBalance() {
    const ar = await prisma.chartOfAccount.findFirstOrThrow({
      where: { organizationId: orgId, systemKey: SystemAccountKey.ACCOUNTS_RECEIVABLE },
    });
    const agg = await prisma.journalEntryLine.aggregate({
      where: { accountId: ar.id, journalEntry: { organizationId: orgId, status: JournalEntryStatus.POSTED } },
      _sum: { debit: true, credit: true },
    });
    return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
  }

  async function issuedInvoice(lines: { productId: string; locationId: string; quantity: number }[]) {
    const draft = await invoices.createDraft(orgId, adminId, {
      locationId: lines[0].locationId,
      format: InvoiceFormat.A4,
      customerId,
      items: lines,
    } as any);
    await invoices.issue(orgId, draft.id, adminId, 'ADMIN');
    return draft.id;
  }

  async function sentQuotation(productId: string) {
    const quote = await quotations.create(orgId, adminId, {
      locationId: rackA,
      customerId,
      customerName: 'Bengkel Jaya',
      format: QuotationFormat.A4,
      items: [{ productId, locationId: rackA, quantity: 2, taxRateIds: [ppnId] }],
    } as any);
    await quotations.send(orgId, quote.id, adminId);
    return quote.id;
  }

  describe('conversions', () => {
    it('carries line tax from quotation to order to invoice', async () => {
      const productId = await product();
      const quoteId = await sentQuotation(productId);

      const order = await orders.createFromQuotation(orgId, adminId, quoteId);
      expect(Number(order.taxAmount)).toBe(22_000);
      await orders.confirm(orgId, order.id, adminId);

      const invoice = await invoices.createDraftFromSalesOrder(orgId, adminId, order.id);
      expect(Number(invoice.taxAmount)).toBe(22_000);
      expect(Number(invoice.total)).toBe(222_000);
    });

    it('carries line tax from quotation straight to invoice', async () => {
      const quoteId = await sentQuotation(await product());
      const invoice = await invoices.createDraftFromQuotation(orgId, adminId, quoteId);
      expect(Number(invoice.taxAmount)).toBe(22_000);
    });

    it('refuses to invoice a quotation already converted to a sales order', async () => {
      const quoteId = await sentQuotation(await product());
      await orders.createFromQuotation(orgId, adminId, quoteId);
      await expect(invoices.createDraftFromQuotation(orgId, adminId, quoteId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('lets a sales order be invoiced again after its invoice is voided', async () => {
      const quoteId = await sentQuotation(await product());
      const order = await orders.createFromQuotation(orgId, adminId, quoteId);
      await orders.confirm(orgId, order.id, adminId);
      const first = await invoices.createDraftFromSalesOrder(orgId, adminId, order.id);
      await invoices.issue(orgId, first.id, adminId, 'ADMIN');
      await invoices.voidInvoice(orgId, first.id, 'wrong customer', adminId);

      const second = await invoices.createDraftFromSalesOrder(orgId, adminId, order.id);
      expect(second.id).not.toBe(first.id);
    });

    it('refuses a delivery order once the order\'s invoice took the stock at issue', async () => {
      const productId = await product({ [rackA]: 10 });
      const quoteId = await sentQuotation(productId);
      const order = await orders.createFromQuotation(orgId, adminId, quoteId);
      await orders.confirm(orgId, order.id, adminId);
      const invoice = await invoices.createDraftFromSalesOrder(orgId, adminId, order.id);
      await invoices.issue(orgId, invoice.id, adminId, 'ADMIN');
      expect(await qtyAt(productId, rackA)).toBe(8);

      const soItem = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: order.id } });
      await expect(
        deliveries.create(orgId, adminId, {
          salesOrderId: order.id,
          locationId: rackA,
          items: [{ salesOrderItemId: soItem.id, quantity: 2 }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await qtyAt(productId, rackA)).toBe(8);
    });
  });

  describe('drafts', () => {
    it('saves a format change made after the draft was created', async () => {
      const draft = await invoices.createDraft(orgId, adminId, {
        locationId: rackA,
        format: InvoiceFormat.RECEIPT,
        items: [{ productId: await product(), locationId: rackA, quantity: 1 }],
      } as any);
      await invoices.updateDraft(orgId, draft.id, { format: InvoiceFormat.A4 } as any, adminId);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })).format).toBe(InvoiceFormat.A4);
    });
  });

  describe('editing an issued invoice', () => {
    it('keeps two lines of the same product from different locations apart', async () => {
      const productId = await product({ [rackA]: 10, [rackB]: 10 });
      const id = await issuedInvoice([
        { productId, locationId: rackA, quantity: 3 },
        { productId, locationId: rackB, quantity: 2 },
      ]);
      expect(await qtyAt(productId, rackA)).toBe(7);
      expect(await qtyAt(productId, rackB)).toBe(8);

      // Same lines, only the due date changes: no stock may move.
      await invoices.editIssuedInvoice(orgId, id, {
        items: [
          { productId, locationId: rackA, quantity: 3 },
          { productId, locationId: rackB, quantity: 2 },
        ],
        dueDate: '2026-12-31',
        reason: 'due date',
      } as any, adminId);
      expect(await qtyAt(productId, rackA)).toBe(7);
      expect(await qtyAt(productId, rackB)).toBe(8);

      const items = await prisma.invoiceItem.findMany({ where: { invoiceId: id }, orderBy: { id: 'asc' } });
      expect(items.map((i) => [i.locationId, Number(i.quantity), Number(i.fulfilledQuantity)])).toEqual([
        [rackA, 3, 3],
        [rackB, 2, 2],
      ]);
    });

    it('moves stock when a line changes location', async () => {
      const productId = await product({ [rackA]: 10, [rackB]: 10 });
      const id = await issuedInvoice([{ productId, locationId: rackA, quantity: 4 }]);
      expect(await qtyAt(productId, rackA)).toBe(6);

      await invoices.editIssuedInvoice(orgId, id, {
        items: [{ productId, locationId: rackB, quantity: 4 }],
        reason: 'picked from rack B',
      } as any, adminId);
      expect(await qtyAt(productId, rackA)).toBe(10);
      expect(await qtyAt(productId, rackB)).toBe(6);
      const item = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: id } });
      expect(Number(item.unitPrice)).toBe(PRICE);
      expect(Number(item.fulfilledQuantity)).toBe(4);
    });
  });

  describe('voiding', () => {
    it('refuses to void once a return has been recorded, and settles a fully returned invoice', async () => {
      const productId = await product({ [rackA]: 10 });
      const id = await issuedInvoice([{ productId, locationId: rackA, quantity: 2 }]);
      const arBefore = await arBalance();

      const session = await sessions.create(orgId, SessionType.RETURNS, undefined, undefined, { returnInvoiceId: id });
      await sessions.addItem(orgId, session.id, productId, 2, undefined, rackA, 'DAMAGED', adminId);

      const returned = await prisma.invoice.findUniqueOrThrow({ where: { id } });
      expect(returned.paymentStatus).toBe(PaymentStatus.PAID); // nothing left owed
      await expect(invoices.voidInvoice(orgId, id, 'oops', adminId)).rejects.toBeInstanceOf(BadRequestException);
      expect(await arBalance()).toBeCloseTo(arBefore - 200_000, 2);
      expect(await invoices.getOverdueCount(orgId)).toBe(0);
    });

    it('stops an open returns session from returning goods after the void', async () => {
      const productId = await product({ [rackA]: 10 });
      const id = await issuedInvoice([{ productId, locationId: rackA, quantity: 2 }]);
      const session = await sessions.create(orgId, SessionType.RETURNS, undefined, undefined, { returnInvoiceId: id });

      await invoices.voidInvoice(orgId, id, 'cancelled sale', adminId);
      expect(await qtyAt(productId, rackA)).toBe(10);

      await expect(
        sessions.addItem(orgId, session.id, productId, 2, undefined, rackA, 'DAMAGED', adminId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await qtyAt(productId, rackA)).toBe(10);
    });

    it('puts stock back once when the same void is submitted twice at once', async () => {
      const productId = await product({ [rackA]: 10 });
      const id = await issuedInvoice([{ productId, locationId: rackA, quantity: 3 }]);
      const results = await Promise.allSettled([
        invoices.voidInvoice(orgId, id, 'double click', adminId),
        invoices.voidInvoice(orgId, id, 'double click', adminId),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await qtyAt(productId, rackA)).toBe(10);
    });
  });

  describe('stock import', () => {
    it('accepts numeric SKU and location cells', async () => {
      const sku = Math.floor(Math.random() * 1e9);
      const result = await stock.import(orgId, adminId, ImportMode.INCREMENT, [
        { sku: sku as any, name: 'Numbered Part', category: 'General', location: 7 as any, qty: 5 },
      ]);
      expect(result.rejected).toEqual([]);
      expect(result.accepted).toHaveLength(1);
    });
  });

  describe('payroll', () => {
    it('lets a voided period be run again', async () => {
      await prisma.employee.create({ data: { organizationId: orgId, name: 'Budi', baseSalary: 5_000_000 } });
      const run = { periodMonth: 9, periodYear: 2026, documentDate: '2026-09-30' } as any;
      const first = await payroll.create(orgId, run);
      await payroll.post(orgId, first.id);
      await payroll.void(orgId, first.id, 'wrong salary', adminId);

      const second = await payroll.create(orgId, run);
      expect(second.id).not.toBe(first.id);
      // Still only one live run per period.
      await expect(payroll.create(orgId, run)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
