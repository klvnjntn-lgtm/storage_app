import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { QuotationFormat, SalesOrderStatus, SalesQuotationStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { SalesQuotationModule } from '../sales-quotation/sales-quotation.module';
import { SalesQuotationService } from '../sales-quotation/sales-quotation.service';
import { SalesOrderModule } from './sales-order.module';
import { SalesOrderService } from './sales-order.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';

// Quotations and sales orders on their own: statuses, numbering, totals
// and what each status allows. Conversions into invoices are covered in
// invoice-flows.spec.ts. Runs against the isolated test DB.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

describe('Quotation and sales order lifecycle', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let quotations: SalesQuotationService;
  let orders: SalesOrderService;

  let orgId: string;
  let userId: string;
  let rack: string;
  let customerId: string;
  let ppnId: string;
  let productId: string;

  const PRICE = 200_000;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, SalesQuotationModule, SalesOrderModule, InvoiceModule],
    }).compile();
    prisma = module.get(PrismaService);
    quotations = module.get(SalesQuotationService);
    orders = module.get(SalesOrderService);

    orgId = (await prisma.organization.create({ data: { name: `Sales ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } });
    userId = (
      await prisma.user.create({
        data: { email: `sales-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    rack = (await prisma.location.create({ data: { name: 'Rack', organizationId: orgId } })).id;
    const categoryId = (await prisma.category.create({ data: { name: 'Parts', organizationId: orgId } })).id;
    productId = (
      await prisma.product.create({
        data: { name: 'Battery', sku: `BAT-${randomUUID().slice(0, 8)}`, categoryId, organizationId: orgId, sellingPrice: PRICE },
      })
    ).id;
    await prisma.stock.create({ data: { productId, locationId: rack, organizationId: orgId, quantity: 100 } });
    customerId = (await prisma.customer.create({ data: { name: 'PT Pelanggan', organizationId: orgId } })).id;
    ppnId = (await prisma.organizationTaxRate.create({ data: { organizationId: orgId, name: 'PPN', percentage: 11 } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  const lines = (quantity = 2, extra: Record<string, unknown> = {}) => [
    { productId, locationId: rack, quantity, taxRateIds: [ppnId], ...extra },
  ];

  const draftQuote = (items = lines()) =>
    quotations.create(orgId, userId, {
      locationId: rack,
      customerId,
      customerName: 'PT Pelanggan',
      format: QuotationFormat.A4,
      items,
    } as any);

  describe('quotations', () => {
    it('totals lines with discount and tax', async () => {
      const q = await draftQuote(lines(2, { discountType: 'PERCENTAGE', discountValue: 10 }));
      // 2 × 200k = 400k, −10% = 360k, +11% = 39.6k
      expect(Number(q.subtotal)).toBe(400_000);
      expect(Number(q.discount)).toBe(40_000);
      expect(Number(q.taxAmount)).toBe(39_600);
      expect(Number(q.total)).toBe(399_600);
    });

    it('takes a number only when sent, and moves SENT → ACCEPTED', async () => {
      const q = await draftQuote();
      expect(q.quotationNumber).toBeNull();
      const sent = await quotations.send(orgId, q.id, userId);
      expect(sent.quotationNumber).toMatch(/^SQ-\d{4}-\d{5}$/);
      await expect(quotations.send(orgId, q.id, userId)).rejects.toThrow(BadRequestException);
      const accepted = await quotations.accept(orgId, q.id, userId);
      expect(accepted.status).toBe(SalesQuotationStatus.ACCEPTED);
      await expect(quotations.reject(orgId, q.id, userId)).rejects.toThrow('Cannot move');
    });

    it('refuses to send an empty quotation', async () => {
      const q = await draftQuote([]);
      await expect(quotations.send(orgId, q.id, userId)).rejects.toThrow('empty');
    });

    it('needs a reason to cancel, and cannot cancel a draft', async () => {
      const q = await draftQuote();
      await expect(quotations.cancel(orgId, q.id, userId, ' ')).rejects.toThrow('reason');
      await expect(quotations.cancel(orgId, q.id, userId, 'no longer needed')).rejects.toThrow('Cannot move');
      await quotations.send(orgId, q.id, userId);
      expect((await quotations.cancel(orgId, q.id, userId, 'customer went elsewhere')).status).toBe(
        SalesQuotationStatus.CANCELLED,
      );
    });

    it('discards a draft entirely, but not a sent one', async () => {
      const q = await draftQuote();
      await quotations.discardDraft(orgId, q.id, userId);
      expect(await prisma.salesQuotation.findUnique({ where: { id: q.id } })).toBeNull();

      const sent = await draftQuote();
      await quotations.send(orgId, sent.id, userId);
      await expect(quotations.discardDraft(orgId, sent.id, userId)).rejects.toThrow('Only a draft');
    });
  });

  describe('sales orders', () => {
    async function sentQuoteId() {
      const q = await draftQuote();
      await quotations.send(orgId, q.id, userId);
      return q.id;
    }

    it('converts a quotation once, keeping its total', async () => {
      const quoteId = await sentQuoteId();
      const order = await orders.createFromQuotation(orgId, userId, quoteId);
      expect(Number(order.total)).toBe(444_000);
      expect((await prisma.salesQuotation.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe(
        SalesQuotationStatus.CONVERTED,
      );
      await expect(orders.createFromQuotation(orgId, userId, quoteId)).rejects.toThrow(BadRequestException);
    });

    // The SQ-001 example: 100 quoted, 40 invoiced straight away, the other 60 ordered — and no more.
    it('converts in parts: invoice some, order the rest, never past what was quoted', async () => {
      const q = await draftQuote(lines(100));
      await quotations.send(orgId, q.id, userId);
      const itemId = (await quotations.getOne(orgId, q.id)).items[0].id;
      const invoices = module.get(InvoiceService);

      const invoice = await invoices.createDraftFromQuotation(orgId, userId, q.id, undefined, [
        { quotationItemId: itemId, quantity: 40 },
      ]);
      expect(Number(invoice.items[0].quantity)).toBe(40);
      let quote = await quotations.getOne(orgId, q.id);
      expect(quote.conversion[0]).toMatchObject({ quoted: 100, invoiced: 40, ordered: 0, remaining: 60 });
      // Still open for the rest.
      expect(quote.status).toBe(SalesQuotationStatus.SENT);

      // More than is left is refused; the default takes exactly what's left.
      await expect(
        orders.createFromQuotation(orgId, userId, q.id, [{ quotationItemId: itemId, quantity: 61 }]),
      ).rejects.toThrow('Only 60');
      const order = await orders.createFromQuotation(orgId, userId, q.id);
      expect(Number(order.items[0].quantity)).toBe(60);
      quote = await quotations.getOne(orgId, q.id);
      expect(quote.conversion[0]).toMatchObject({ invoiced: 40, ordered: 60, remaining: 0 });
      expect(quote.status).toBe(SalesQuotationStatus.CONVERTED);
      await expect(invoices.createDraftFromQuotation(orgId, userId, q.id)).rejects.toThrow(BadRequestException);

      // Cancelling the order frees its 60 again.
      await orders.cancel(orgId, order.id, userId, 'Customer changed plans');
      quote = await quotations.getOne(orgId, q.id);
      expect(quote.conversion[0].remaining).toBe(60);
      expect(quote.status).toBe(SalesQuotationStatus.ACCEPTED);
    });

    it('scales a fixed line discount to the part converted', async () => {
      const q = await draftQuote(lines(10, { taxRateIds: [], discountType: 'FIXED', discountValue: 100_000 }));
      await quotations.send(orgId, q.id, userId);
      const itemId = (await quotations.getOne(orgId, q.id)).items[0].id;
      const order = await orders.createFromQuotation(orgId, userId, q.id, [{ quotationItemId: itemId, quantity: 4 }]);
      expect(Number(order.items[0].discountAmount)).toBe(40_000);
    });

    it('numbers on confirm and only confirms once', async () => {
      const order = await orders.createFromQuotation(orgId, userId, await sentQuoteId());
      const confirmed = await orders.confirm(orgId, order.id, userId);
      expect(confirmed.status).toBe(SalesOrderStatus.CONFIRMED);
      expect(confirmed.orderNumber).toMatch(/^SO-\d{4}-\d{5}$/);
      await expect(orders.confirm(orgId, order.id, userId)).rejects.toThrow(BadRequestException);
    });

    it('cancelling hands the quotation back for another conversion', async () => {
      const quoteId = await sentQuoteId();
      const order = await orders.createFromQuotation(orgId, userId, quoteId);
      await orders.confirm(orgId, order.id, userId);
      await expect(orders.cancel(orgId, order.id, userId, '')).rejects.toThrow('reason');
      await orders.cancel(orgId, order.id, userId, 'customer changed the order');

      expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(SalesOrderStatus.CANCELLED);
      expect((await prisma.salesQuotation.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe(
        SalesQuotationStatus.ACCEPTED,
      );
      const again = await orders.createFromQuotation(orgId, userId, quoteId);
      expect(again.id).not.toBe(order.id);
      await expect(orders.cancel(orgId, order.id, userId, 'twice')).rejects.toThrow('Only a draft or confirmed');
    });

    it('can still cancel a confirmed order once its only invoice is voided', async () => {
      const invoices = module.get(InvoiceService);
      const order = await orders.createFromQuotation(orgId, userId, await sentQuoteId());
      await orders.confirm(orgId, order.id, userId);
      const invoice = await invoices.createDraftFromSalesOrder(orgId, userId, order.id);
      await invoices.issue(orgId, invoice.id, userId, 'ADMIN');
      await expect(orders.cancel(orgId, order.id, userId, 'still invoiced')).rejects.toThrow('deliveries or invoices');
      await invoices.voidInvoice(orgId, invoice.id, 'wrong price', userId);
      expect((await orders.cancel(orgId, order.id, userId, 'customer cancelled')).status).toBe(SalesOrderStatus.CANCELLED);
    });
  });
});
