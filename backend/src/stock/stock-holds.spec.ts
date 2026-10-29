import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { SalesQuotationModule } from '../sales-quotation/sales-quotation.module';
import { SalesQuotationService } from '../sales-quotation/sales-quotation.service';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { heldStock, holdKey, offeredStock } from './stock-holds';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Stock promised to customers: accepted quotations and confirmed sales orders hold it, sent
// quotations only offer it. Against the isolated test DB, in a fresh org (work orders off).
describe('Stock holds', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let quotations: SalesQuotationService;
  let orders: SalesOrderService;
  let invoices: InvoiceService;

  let orgId: string;
  let userId: string;
  let rack: string;
  let customerId: string;
  let categoryId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, SalesQuotationModule, SalesOrderModule, InvoiceModule],
    }).compile();
    prisma = module.get(PrismaService);
    quotations = module.get(SalesQuotationService);
    orders = module.get(SalesOrderService);
    invoices = module.get(InvoiceService);

    orgId = (await prisma.organization.create({ data: { name: `Holds ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } });
    userId = (
      await prisma.user.create({
        data: { email: `holds-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    rack = (await prisma.location.create({ data: { name: 'Rack', organizationId: orgId } })).id;
    categoryId = (await prisma.category.create({ data: { name: 'Parts', organizationId: orgId } })).id;
    customerId = (await prisma.customer.create({ data: { name: 'PT Pelanggan', organizationId: orgId } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  // Each test gets its own product, with this much on the shelf.
  async function newProduct(onHand: number) {
    const id = (
      await prisma.product.create({
        data: { name: 'Alternator', sku: `ALT-${randomUUID().slice(0, 8)}`, categoryId, organizationId: orgId, sellingPrice: 900_000 },
      })
    ).id;
    await prisma.stock.create({ data: { productId: id, locationId: rack, organizationId: orgId, quantity: onHand } });
    return id;
  }

  async function sentQuotation(productId: string, quantity: number, validUntil?: string) {
    const q = await quotations.create(orgId, userId, {
      format: 'A4',
      customerId,
      locationId: rack,
      validUntil,
      items: [{ productId, locationId: rack, quantity }],
    } as never);
    return quotations.send(orgId, q.id, userId);
  }

  const heldOf = async (productId: string, excludeInvoiceId?: string) =>
    (await heldStock(prisma, orgId, [productId], { excludeInvoiceId })).get(holdKey(productId, rack)) ?? 0;

  // A walk-in sale of `quantity`; returns how much it actually took (BLOCK caps at what's free).
  async function sell(productId: string, quantity: number) {
    const draft = await invoices.createDraft(orgId, userId, {
      format: 'A4',
      customerName: 'Walk-in',
      items: [{ productId, locationId: rack, quantity }],
    } as never);
    await invoices.issue(orgId, draft.id, userId, 'ADMIN');
    const item = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: draft.id } });
    return Number(item.fulfilledQuantity);
  }

  it('a sent quotation only offers the stock; accepting it holds it from other sales', async () => {
    const product = await newProduct(1);
    const q = await sentQuotation(product, 1);

    expect(await heldOf(product)).toBe(0);
    const offered = (await offeredStock(prisma, orgId, [product])).get(holdKey(product, rack));
    expect(offered).toEqual({ quantity: 1, quotationNumbers: [q.quotationNumber] });

    await quotations.accept(orgId, q.id, userId);
    expect(await heldOf(product)).toBe(1);
    expect((await offeredStock(prisma, orgId, [product])).get(holdKey(product, rack))).toBeUndefined();
    // The one unit is promised: a walk-in gets nothing.
    expect(await sell(product, 1)).toBe(0);
  });

  it("the accepted quotation's own invoice takes what it holds", async () => {
    const product = await newProduct(1);
    const q = await sentQuotation(product, 1);
    await quotations.accept(orgId, q.id, userId);

    const draft = await invoices.createDraftFromQuotation(orgId, userId, q.id);
    // Still held while the invoice is a draft, but not from that invoice itself.
    expect(await heldOf(product)).toBe(1);
    expect(await heldOf(product, draft.id)).toBe(0);

    await invoices.issue(orgId, draft.id, userId, 'ADMIN');
    const item = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: draft.id } });
    expect(Number(item.fulfilledQuantity)).toBe(1);
    expect(await heldOf(product)).toBe(0);
  });

  it('holds nothing past the valid-until day, or once rejected', async () => {
    const product = await newProduct(2);
    const lapsed = await sentQuotation(product, 1, '2020-01-01');
    await quotations.accept(orgId, lapsed.id, userId).catch(() => undefined);
    expect(await heldOf(product)).toBe(0);

    const declined = await sentQuotation(product, 1);
    await quotations.reject(orgId, declined.id, userId);
    expect(await heldOf(product)).toBe(0);
  });

  it('a confirmed sales order holds its lines until they are invoiced, its quotation handing over the hold', async () => {
    const product = await newProduct(3);
    const q = await sentQuotation(product, 2);
    await quotations.accept(orgId, q.id, userId);

    // A draft order doesn't hold yet — the accepted quotation still does.
    const order = await orders.createFromQuotation(orgId, userId, q.id);
    expect(await heldOf(product)).toBe(2);

    // Confirmed, the order holds instead of the quotation: still 2, not 4.
    await orders.confirm(orgId, order.id, userId);
    expect(await heldOf(product)).toBe(2);
    expect(await sell(product, 3)).toBe(1);

    const draft = await invoices.createDraftFromSalesOrder(orgId, userId, order.id);
    await invoices.issue(orgId, draft.id, userId, 'ADMIN');
    expect(await heldOf(product)).toBe(0);
  });
});
