import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { EventType, StockPolicy } from '@prisma/client';
import { StockService } from './stock.service';
import { ProductModule } from '../product/product.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { StockConfirmationRequiredException } from './exceptions/stock-confirmation-required.exception';

// StockModule pulls in StockController, whose imports use a 'src/...'
// absolute path that only resolves under Nest's own build (baseUrl), not
// jest's default resolver. Wiring StockService's actual dependency
// modules directly here avoids that, without touching shared jest config
// for something unrelated to this test.

// Integration tests — real Postgres (same DB stock.service.ts's FOR UPDATE
// row lock and $transaction actually run against), not a mocked
// PrismaService. A mock can't meaningfully exercise the row lock the
// concurrency test below depends on.
describe('StockService.fulfill() — per-tenant stock policy', () => {
  let module: TestingModule;
  let stockService: StockService;
  let prisma: PrismaService;

  let orgId: string;
  let userId: string;
  let locationId: string;
  let categoryId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, ProductModule, AccountingModule],
      providers: [StockService],
    }).compile();
    stockService = module.get(StockService);
    prisma = module.get(PrismaService);

    const org = await prisma.organization.create({ data: { name: `Test Org ${randomUUID()}` } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { email: `stockpolicy-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
    });
    userId = user.id;
    const location = await prisma.location.create({ data: { name: 'Main', organizationId: orgId } });
    locationId = location.id;
    const category = await prisma.category.create({ data: { name: 'General', organizationId: orgId } });
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { organizationId: orgId } });
    await prisma.invoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.stock.deleteMany({ where: { organizationId: orgId } });
    await prisma.product.deleteMany({ where: { organizationId: orgId } });
    await prisma.category.deleteMany({ where: { organizationId: orgId } });
    await prisma.location.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await module.close();
  });

  // No costPrice — StockService.adjust()'s posting step skips products
  // with no cost, and fulfill()/decrease() never post anyway, so this
  // sidesteps needing a full Chart of Accounts for the test org.
  async function makeProductWithStock(qty: number) {
    const product = await prisma.product.create({
      data: { name: 'Widget', sku: `SKU-${randomUUID()}`, organizationId: orgId, categoryId },
    });
    await prisma.stock.create({
      data: { productId: product.id, locationId, organizationId: orgId, quantity: qty },
    });
    return product.id;
  }

  // Event.invoiceId is a real FK — fulfill()'s SALE context needs an
  // actual Invoice row to point at, not an arbitrary string.
  async function makeInvoice() {
    const invoice = await prisma.invoice.create({ data: { organizationId: orgId, format: 'RECEIPT' } });
    return invoice.id;
  }

  async function currentQty(productId: string) {
    const stock = await prisma.stock.findUnique({
      where: { productId_locationId: { productId, locationId } },
    });
    return Number(stock?.quantity ?? 0);
  }

  it('BLOCK caps fulfillment at available stock (unchanged default behavior)', async () => {
    const productId = await makeProductWithStock(5);
    const invoiceId = await makeInvoice();
    const result = await stockService.fulfill(
      orgId, productId, locationId, 8, userId,
      { type: EventType.SALE, invoiceId },
      undefined,
      { mode: StockPolicy.BLOCK },
    );
    expect(result.fulfilledQuantity).toBe(5);
    expect(result.shortfall).toBe(3);
    expect(result.oversold).toBe(false);
    expect(await currentQty(productId)).toBe(0);
  });

  it('WARN throws StockConfirmationRequiredException without confirmOversell', async () => {
    const productId = await makeProductWithStock(2);
    const invoiceId = await makeInvoice();
    await expect(
      stockService.fulfill(
        orgId, productId, locationId, 5, userId,
        { type: EventType.SALE, invoiceId },
        undefined,
        { mode: StockPolicy.WARN },
      ),
    ).rejects.toBeInstanceOf(StockConfirmationRequiredException);
    // Rejected inside the transaction — nothing should have moved.
    expect(await currentQty(productId)).toBe(2);
  });

  it('WARN fulfills in full and goes negative with confirmOversell', async () => {
    const productId = await makeProductWithStock(2);
    const invoiceId = await makeInvoice();
    const result = await stockService.fulfill(
      orgId, productId, locationId, 5, userId,
      { type: EventType.SALE, invoiceId },
      undefined,
      { mode: StockPolicy.WARN, confirmOversell: true },
    );
    expect(result.fulfilledQuantity).toBe(5);
    expect(result.oversold).toBe(true);
    expect(await currentQty(productId)).toBe(-3);
  });

  it('ALLOW always fulfills in full and goes negative, no confirmation needed', async () => {
    const productId = await makeProductWithStock(1);
    const invoiceId = await makeInvoice();
    const result = await stockService.fulfill(
      orgId, productId, locationId, 4, userId,
      { type: EventType.SALE, invoiceId },
      undefined,
      { mode: StockPolicy.ALLOW },
    );
    expect(result.fulfilledQuantity).toBe(4);
    expect(result.oversold).toBe(true);
    expect(await currentQty(productId)).toBe(-3);
  });

  it('stamps balanceAfter/oversold on the Event row', async () => {
    const productId = await makeProductWithStock(1);
    const invoiceId = await makeInvoice();
    await stockService.fulfill(
      orgId, productId, locationId, 3, userId,
      { type: EventType.SALE, invoiceId },
      undefined,
      { mode: StockPolicy.ALLOW },
    );
    const event = await prisma.event.findFirst({
      where: { organizationId: orgId, productId, invoiceId },
    });
    expect(event).not.toBeNull();
    expect(Number(event!.balanceAfter)).toBe(-2);
    expect(event!.oversold).toBe(true);
  });

  it('two concurrent sales for the last unit — only one succeeds under BLOCK, never goes negative', async () => {
    const productId = await makeProductWithStock(1);
    const [invoiceIdA, invoiceIdB] = await Promise.all([makeInvoice(), makeInvoice()]);
    const results = await Promise.all([
      stockService.fulfill(
        orgId, productId, locationId, 1, userId,
        { type: EventType.SALE, invoiceId: invoiceIdA },
        undefined,
        { mode: StockPolicy.BLOCK },
      ),
      stockService.fulfill(
        orgId, productId, locationId, 1, userId,
        { type: EventType.SALE, invoiceId: invoiceIdB },
        undefined,
        { mode: StockPolicy.BLOCK },
      ),
    ]);
    const totalFulfilled = results.reduce((sum, r) => sum + r.fulfilledQuantity, 0);
    expect(totalFulfilled).toBe(1); // row lock serializes the two calls — only one gets the unit
    expect(await currentQty(productId)).toBe(0);
  });

  it('stock-take adjustment math: adjust() moves quantity by exactly qtyDelta', async () => {
    const productId = await makeProductWithStock(10);
    // Physical count came in at 7 — a stock-take/opening-balance correction
    // is a qtyDelta of (counted - system) = -3.
    await stockService.adjust(orgId, userId, {
      productId,
      locationId,
      qtyDelta: -3,
      reason: 'Stock-take correction',
    });
    expect(await currentQty(productId)).toBe(7);

    await stockService.adjust(orgId, userId, {
      productId,
      locationId,
      qtyDelta: 5,
      reason: 'Stock-take correction (found stock)',
    });
    expect(await currentQty(productId)).toBe(12);
  });
});
