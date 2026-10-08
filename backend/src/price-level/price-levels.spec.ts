import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { InvoiceFormat, QuotationFormat } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { SalesQuotationModule } from '../sales-quotation/sales-quotation.module';
import { SalesQuotationService } from '../sales-quotation/sales-quotation.service';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';
import { PriceLevelModule } from './price-level.module';
import { PriceLevelService } from './price-level.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Price levels against the isolated test DB (test/setup-test-env.ts). Each
// run makes a fresh org; the test DB is throwaway.
describe('Price levels', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let pricing: LineItemPricingService;
  let invoices: InvoiceService;
  let quotations: SalesQuotationService;
  let orders: SalesOrderService;
  let levels: PriceLevelService;

  let orgId: string;
  let adminId: string;
  let staffId: string;
  let locationId: string;
  let filterId: string; // has a Wholesale price
  let beltId: string; // has no Wholesale price
  let retailId: string;
  let wholesaleId: string;
  let wholesaleCustomerId: string;

  const RETAIL = 120_000;
  const WHOLESALE = 100_000;
  const BELT_RETAIL = 50_000;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, InvoiceModule, SalesQuotationModule, SalesOrderModule, PriceLevelModule],
    }).compile();
    prisma = module.get(PrismaService);
    pricing = module.get(LineItemPricingService);
    invoices = module.get(InvoiceService);
    quotations = module.get(SalesQuotationService);
    orders = module.get(SalesOrderService);
    levels = module.get(PriceLevelService);

    const org = await prisma.organization.create({ data: { name: `Price Levels ${randomUUID()}` } });
    orgId = org.id;
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } }).catch(() => {});
    adminId = (
      await prisma.user.create({ data: { email: `pl-admin-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId } })
    ).id;
    staffId = (
      await prisma.user.create({ data: { email: `pl-staff-${randomUUID()}@example.com`, password: 'x', role: 'USER', organizationId: orgId } })
    ).id;
    locationId = (await prisma.location.create({ data: { name: 'Main', organizationId: orgId } })).id;
    const category = await prisma.category.create({ data: { name: 'General', organizationId: orgId } });
    filterId = (
      await prisma.product.create({
        data: { name: 'Oil Filter', sku: `OF-${randomUUID().slice(0, 8)}`, categoryId: category.id, organizationId: orgId, sellingPrice: RETAIL },
      })
    ).id;
    beltId = (
      await prisma.product.create({
        data: { name: 'Fan Belt', sku: `FB-${randomUUID().slice(0, 8)}`, categoryId: category.id, organizationId: orgId, sellingPrice: BELT_RETAIL },
      })
    ).id;
    for (const id of [filterId, beltId]) {
      await prisma.stock.create({ data: { productId: id, locationId, organizationId: orgId, quantity: 100 } });
    }

    // New org → default level is created lazily on first list.
    const initial = await levels.list(orgId);
    expect(initial).toHaveLength(1);
    expect(initial[0].isDefault).toBe(true);
    retailId = initial[0].id;
    wholesaleId = (await levels.create(orgId, { name: 'Wholesale' })).id;
    await prisma.productPrice.create({ data: { productId: filterId, priceLevelId: wholesaleId, price: WHOLESALE } });
    wholesaleCustomerId = (
      await prisma.customer.create({ data: { name: 'Bengkel Jaya', organizationId: orgId, priceLevelId: wholesaleId } })
    ).id;
  });

  afterAll(async () => {
    await module.close();
  });

  const line = (productId: string, extra: Record<string, unknown> = {}) => ({ productId, locationId, quantity: 2, ...extra });

  describe('server-side resolution', () => {
    it('uses the default level when nothing is chosen', async () => {
      const { items } = await pricing.priceLines(orgId, [line(filterId)]);
      expect(items[0]).toMatchObject({ unitPrice: RETAIL, priceLevelId: retailId, priceLevelFallback: false });
    });

    it('resolves the chosen level from the stored product price', async () => {
      const { items } = await pricing.priceLines(orgId, [line(filterId, { priceLevelId: wholesaleId })]);
      expect(items[0]).toMatchObject({ unitPrice: WHOLESALE, priceLevelId: wholesaleId, priceLevelFallback: false });
    });

    it('falls back visibly to the default price and records the default as the source', async () => {
      const { items } = await pricing.priceLines(orgId, [line(beltId, { priceLevelId: wholesaleId })]);
      expect(items[0]).toMatchObject({ unitPrice: BELT_RETAIL, priceLevelId: retailId, priceLevelFallback: true });
    });

    it("starts lines at the customer's level", async () => {
      const { items } = await pricing.priceLines(orgId, [line(filterId)], undefined, { customerId: wholesaleCustomerId });
      expect(items[0]).toMatchObject({ unitPrice: WHOLESALE, priceLevelId: wholesaleId });
    });

    it('ignores a client-sent price when POS pricing is off', async () => {
      const { items } = await pricing.priceLines(orgId, [line(filterId, { priceLevelId: wholesaleId, unitPrice: 1 })]);
      expect(items[0].unitPrice).toBe(WHOLESALE);
    });

    it('with POS pricing on, a typed price is stored as custom (no level)', async () => {
      await prisma.organization.update({ where: { id: orgId }, data: { posPricingEnabled: true } });
      try {
        const { items } = await pricing.priceLines(orgId, [
          line(filterId, { priceLevelId: wholesaleId, unitPrice: 95_000 }),
          line(filterId, { priceLevelId: wholesaleId, unitPrice: WHOLESALE }),
        ]);
        expect(items[0]).toMatchObject({ unitPrice: 95_000, priceLevelId: null });
        expect(items[1]).toMatchObject({ unitPrice: WHOLESALE, priceLevelId: wholesaleId });
      } finally {
        await prisma.organization.update({ where: { id: orgId }, data: { posPricingEnabled: false } });
      }
    });

    it('with POS pricing on, a product with no stored price can still be sold at a typed price', async () => {
      const category = await prisma.category.findFirstOrThrow({ where: { organizationId: orgId } });
      const unpriced = await prisma.product.create({
        data: { name: 'Unpriced', sku: `UP-${randomUUID().slice(0, 8)}`, categoryId: category.id, organizationId: orgId },
      });
      await prisma.organization.update({ where: { id: orgId }, data: { posPricingEnabled: true } });
      try {
        const { items } = await pricing.priceLines(orgId, [line(unpriced.id, { unitPrice: 7_500 })]);
        expect(items[0]).toMatchObject({ unitPrice: 7_500, priceLevelId: null });
      } finally {
        await prisma.organization.update({ where: { id: orgId }, data: { posPricingEnabled: false } });
      }
    });

    it("rejects another org's price level", async () => {
      const other = await prisma.organization.create({ data: { name: `Other ${randomUUID()}` } });
      const foreign = await prisma.priceLevel.create({ data: { organizationId: other.id, name: 'Foreign' } });
      await expect(pricing.priceLines(orgId, [line(filterId, { priceLevelId: foreign.id })])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('override permission', () => {
    beforeAll(async () => {
      await prisma.organization.update({ where: { id: orgId }, data: { priceLevelOverrideRequiresAdmin: true } });
    });
    afterAll(async () => {
      await prisma.organization.update({ where: { id: orgId }, data: { priceLevelOverrideRequiresAdmin: false } });
    });

    it("blocks staff from picking a level other than the customer's", async () => {
      await expect(
        pricing.priceLines(orgId, [line(filterId, { priceLevelId: retailId })], undefined, {
          customerId: wholesaleCustomerId,
          userId: staffId,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never re-checks forced historical lines (archived or non-customer level)', async () => {
      const old = await levels.create(orgId, { name: `Old ${randomUUID().slice(0, 4)}` });
      await levels.update(orgId, old.id, { archived: true });
      const forcedUnitPriceByIndex = new Map([[0, 99_000]]);
      const forcedPriceLevelIdByIndex = new Map<number, string | null>([[0, old.id]]);
      const { items } = await pricing.priceLines(orgId, [line(filterId, { priceLevelId: old.id })], undefined, {
        customerId: wholesaleCustomerId,
        userId: staffId,
        forcedUnitPriceByIndex,
        forcedPriceLevelIdByIndex,
      });
      expect(items[0]).toMatchObject({ unitPrice: 99_000, priceLevelId: old.id });
    });

    it("lets staff use the customer's level, and admins override", async () => {
      await expect(
        pricing.priceLines(orgId, [line(filterId, { priceLevelId: wholesaleId })], undefined, {
          customerId: wholesaleCustomerId,
          userId: staffId,
        }),
      ).resolves.toBeDefined();
      await expect(
        pricing.priceLines(orgId, [line(filterId, { priceLevelId: retailId })], undefined, {
          customerId: wholesaleCustomerId,
          userId: adminId,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('history and conversions', () => {
    it('keeps saved prices when the level price changes later, through every conversion', async () => {
      const quote = await quotations.create(orgId, adminId, {
        locationId,
        customerId: wholesaleCustomerId,
        customerName: 'Bengkel Jaya',
        format: QuotationFormat.A4,
        items: [line(filterId, { priceLevelId: wholesaleId })],
      } as any);
      const draftInvoice = await invoices.createDraft(orgId, adminId, {
        locationId,
        format: InvoiceFormat.A4,
        customerId: wholesaleCustomerId,
        customerName: 'Bengkel Jaya',
        items: [line(filterId)],
      } as any);

      // Wholesale goes up after the documents were made.
      await prisma.productPrice.update({
        where: { productId_priceLevelId: { productId: filterId, priceLevelId: wholesaleId } },
        data: { price: 110_000 },
      });

      const savedInvoiceItem = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: draftInvoice.id } });
      expect(Number(savedInvoiceItem.unitPrice)).toBe(WHOLESALE);
      expect(savedInvoiceItem.priceLevelId).toBe(wholesaleId);

      await quotations.send(orgId, quote.id, adminId);
      await quotations.accept(orgId, quote.id, adminId);
      const order = await orders.createFromQuotation(orgId, adminId, quote.id);
      const orderItem = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: order.id } });
      expect(Number(orderItem.unitPrice)).toBe(WHOLESALE);
      expect(orderItem.priceLevelId).toBe(wholesaleId);

      // The quotation now belongs to the order — invoicing it directly too
      // would bill the customer twice. The order is what gets invoiced.
      await expect(invoices.createDraftFromQuotation(orgId, adminId, quote.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await orders.confirm(orgId, order.id, adminId);
      const fromOrder = await invoices.createDraftFromSalesOrder(orgId, adminId, order.id);
      const fromOrderItem = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: fromOrder.id } });
      expect(Number(fromOrderItem.unitPrice)).toBe(WHOLESALE);
      expect(fromOrderItem.priceLevelId).toBe(wholesaleId);

      // A new line today gets the new price.
      const { items } = await pricing.priceLines(orgId, [line(filterId, { priceLevelId: wholesaleId })]);
      expect(items[0].unitPrice).toBe(110_000);
    });
  });

  describe('managing levels', () => {
    it('archiving a level moves its customers back to the default', async () => {
      const member = await levels.create(orgId, { name: 'Member' });
      const c = await prisma.customer.create({ data: { name: 'Member Co', organizationId: orgId, priceLevelId: member.id } });
      await levels.update(orgId, member.id, { archived: true });
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).priceLevelId).toBeNull();
      expect((await levels.list(orgId)).some((l) => l.id === member.id)).toBe(false);
    });

    it('refuses to archive the default level', async () => {
      await expect(levels.update(orgId, retailId, { archived: true })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
