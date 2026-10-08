import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CostChangeSource,
  InvoiceFormat,
  JournalEntryStatus,
  PurchaseOrderStatus,
  SessionType,
  SystemAccountKey,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { GoodsReceiptModule } from '../goods-receipt/goods-receipt.module';
import { GoodsReceiptService } from '../goods-receipt/goods-receipt.service';
import { SessionsService } from '../sessions/sessions.service';
import { StockService, ImportMode } from '../stock/stock.service';
import { ProductService } from '../product/product.service';
import { ChartOfAccountsSeedService } from './chart-of-accounts-seed.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Weighted-average costing (inventory-costing.ts) across receipts, sales,
// returns, imports and manual edits, against the isolated test DB.
describe('Weighted-average inventory costing', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoiceService;
  let receipts: GoodsReceiptService;
  let sessions: SessionsService;
  let stock: StockService;
  let products: ProductService;

  let orgId: string;
  let userId: string;
  let locationId: string;
  let categoryId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, InvoiceModule, GoodsReceiptModule],
    }).compile();
    prisma = module.get(PrismaService);
    invoices = module.get(InvoiceService);
    receipts = module.get(GoodsReceiptService);
    sessions = module.get(SessionsService);
    stock = module.get(StockService);
    products = module.get(ProductService);

    orgId = (await prisma.organization.create({ data: { name: `Costing ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } });
    userId = (
      await prisma.user.create({
        data: { email: `costing-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    locationId = (await prisma.location.create({ data: { name: 'Main', organizationId: orgId } })).id;
    categoryId = (await prisma.category.create({ data: { name: 'General', organizationId: orgId } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  async function product(onHand: number, cost: number | null) {
    const p = await prisma.product.create({
      data: {
        name: `Brake Pad ${randomUUID().slice(0, 6)}`,
        sku: `BP-${randomUUID().slice(0, 8)}`,
        categoryId,
        organizationId: orgId,
        sellingPrice: 500_000,
        costPrice: cost,
      },
    });
    if (onHand > 0) {
      await prisma.stock.create({ data: { productId: p.id, locationId, organizationId: orgId, quantity: onHand } });
    }
    return p.id;
  }

  async function cost(productId: string) {
    const p = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { costPrice: true } });
    return p.costPrice != null ? Number(p.costPrice) : null;
  }

  async function receive(productId: string, quantity: number, unitCost: number, discountAmount = 0) {
    const lineTotal = quantity * unitCost;
    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        status: PurchaseOrderStatus.SENT,
        subtotal: lineTotal,
        discountAmount,
        total: lineTotal - discountAmount,
        items: { create: [{ productId, quantity, unitCost, lineTotal }] },
      },
      include: { items: true },
    });
    return receipts.receive(orgId, userId, po.id, {
      locationId,
      items: [{ purchaseOrderItemId: po.items[0].id, quantity }],
    });
  }

  async function sell(productId: string, quantity: number) {
    const draft = await invoices.createDraft(orgId, userId, {
      locationId,
      format: InvoiceFormat.A4,
      items: [{ productId, locationId, quantity }],
    } as any);
    await invoices.issue(orgId, draft.id, userId, 'ADMIN');
    return draft.id;
  }

  async function cogsFor(sourceId: string) {
    const cogs = await prisma.chartOfAccount.findFirstOrThrow({
      where: { organizationId: orgId, systemKey: SystemAccountKey.COST_OF_GOODS_SOLD },
    });
    const agg = await prisma.journalEntryLine.aggregate({
      where: { accountId: cogs.id, journalEntry: { sourceId, status: JournalEntryStatus.POSTED } },
      _sum: { debit: true, credit: true },
    });
    return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
  }

  it('averages a goods receipt into the stock on hand and logs it', async () => {
    const productId = await product(5, 200_000);
    const receipt = await receive(productId, 10, 240_000);

    // (5 × 200.000 + 10 × 240.000) / 15
    expect(await cost(productId)).toBe(226_666.67);
    const [entry] = await products.getCostHistory(orgId, productId);
    expect(entry).toMatchObject({
      source: CostChangeSource.GOODS_RECEIPT,
      sourceId: receipt.id,
      previousCost: 200_000,
      newCost: 226_666.67,
      quantityBefore: 5,
      quantityIn: 10,
      unitCostIn: 240_000,
    });
  });

  it('averages the cost net of the PO discount, as booked to Inventory', async () => {
    const productId = await product(0, null);
    await receive(productId, 10, 100_000, 100_000); // 10% off the PO
    expect(await cost(productId)).toBe(90_000);
  });

  it('uses the receipt cost outright when nothing is on hand', async () => {
    const productId = await product(0, 150_000);
    await receive(productId, 4, 180_000);
    expect(await cost(productId)).toBe(180_000);
  });

  it('books COGS at the average when stock leaves, even for a draft made before the receipt', async () => {
    const productId = await product(5, 200_000);
    const draft = await invoices.createDraft(orgId, userId, {
      locationId,
      format: InvoiceFormat.A4,
      items: [{ productId, locationId, quantity: 3 }],
    } as any);
    await receive(productId, 10, 240_000);
    await invoices.issue(orgId, draft.id, userId, 'ADMIN');

    expect(await cogsFor(`${draft.id}:cogs:issue`)).toBeCloseTo(3 * 226_666.67, 2);
    const line = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: draft.id } });
    expect(Number(line.unitCost)).toBe(226_666.67);
  });

  it('never rewrites the cost of a past sale', async () => {
    const productId = await product(10, 200_000);
    const invoiceId = await sell(productId, 4);
    await receive(productId, 6, 300_000);

    expect(await cost(productId)).toBe(250_000); // (6 × 200.000 + 6 × 300.000) / 12
    const line = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId } });
    expect(Number(line.unitCost)).toBe(200_000);
    expect(await cogsFor(`${invoiceId}:cogs:issue`)).toBe(800_000);
  });

  it('blends returned goods back in at the cost they left at', async () => {
    const productId = await product(10, 100);
    const invoiceId = await sell(productId, 5); // 5 left at 100
    await receive(productId, 5, 200); // 10 on hand at 150

    const session = await sessions.create(orgId, SessionType.RETURNS, undefined, undefined, {
      returnInvoiceId: invoiceId,
    });
    await sessions.addItem(orgId, session.id, productId, 5, undefined, locationId, 'DAMAGED', userId);

    // (10 × 150 + 5 × 100) / 15
    expect(await cost(productId)).toBe(133.33);
  });

  it('puts voided sales back at the cost they left at', async () => {
    const productId = await product(10, 100);
    const invoiceId = await sell(productId, 5);
    await receive(productId, 5, 200); // 10 on hand at 150
    await invoices.voidInvoice(orgId, invoiceId, 'mistake', userId);
    expect(await cost(productId)).toBe(133.33);
  });

  describe('imports', () => {
    it('sets the opening cost, then leaves the average alone', async () => {
      const sku = `IMP-${randomUUID().slice(0, 8)}`;
      const first = await stock.import(orgId, userId, ImportMode.INCREMENT, [
        { sku, name: 'Imported Part', category: 'General', location: 'Main', qty: 10, costPrice: 50_000 },
      ]);
      expect(first.accepted[0].costIgnored).toBe(false);
      const productId = first.accepted[0].productId;
      expect(await cost(productId)).toBe(50_000);

      const second = await stock.import(orgId, userId, ImportMode.INCREMENT, [
        { sku, name: 'Imported Part', category: 'General', location: 'Main', qty: 5, costPrice: 80_000 },
      ]);
      expect(second.accepted[0].costIgnored).toBe(true);
      expect(await cost(productId)).toBe(50_000);

      const history = await products.getCostHistory(orgId, productId);
      expect(history.map((h) => h.source)).toEqual([CostChangeSource.OPENING_IMPORT]);
    });
  });

  it('logs a manual cost edit', async () => {
    const productId = await product(3, 100_000);
    await products.update(orgId, productId, { costPrice: 120_000 }, undefined, userId);
    const [entry] = await products.getCostHistory(orgId, productId);
    expect(entry).toMatchObject({ source: CostChangeSource.MANUAL, previousCost: 100_000, newCost: 120_000 });
  });
});
