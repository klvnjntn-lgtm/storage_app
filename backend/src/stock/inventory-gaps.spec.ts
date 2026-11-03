import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ModuleKey, StockTransferStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { AccountingModule } from '../accounting/accounting.module';
import { StockTransferModule } from '../stock-transfer/stock-transfer.module';
import { StockTransferService } from '../stock-transfer/stock-transfer.service';
import { ReorderModule } from '../reorder/reorder.module';
import { ReorderService } from '../reorder/reorder.service';
import { StockModule } from './stock.module';
import { ImportMode, StockService } from './stock.service';
import { relocateSerials, takeSerials } from '../serials/serial-moves';

// ReorderModule pulls in purchase orders, whose PDF printing needs puppeteer.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Runs against the isolated test DB (see test/setup-test-env.ts) in a fresh org.
describe('Inventory gaps (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let stock: StockService;
  let transfers: StockTransferService;
  let reorder: ReorderService;

  let orgId: string;
  let userId: string;
  let categoryId: string;
  let fromId: string;
  let toId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, AccountingModule, StockModule, StockTransferModule, ReorderModule],
    }).compile();
    prisma = module.get(PrismaService);
    stock = module.get(StockService);
    transfers = module.get(StockTransferService);
    reorder = module.get(ReorderService);

    orgId = (await prisma.organization.create({ data: { name: `Gaps ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({
      data: { organizationId: orgId, module: ModuleKey.WAREHOUSE_OPS, enabled: true },
    });
    userId = (
      await prisma.user.create({
        data: { email: `gaps-${randomUUID()}@example.com`, password: 'x', organizationId: orgId },
      })
    ).id;
    // Ids as the Locations page builds them (spaces → _, punctuation kept).
    fromId = (
      await prisma.location.create({ data: { id: `${orgId}_rak_a-1`, name: 'Rak A-1', organizationId: orgId } })
    ).id;
    toId = (
      await prisma.location.create({ data: { id: `${orgId}_rak_b`, name: 'Rak B', organizationId: orgId } })
    ).id;
    categoryId = (await prisma.category.create({ data: { name: 'General', organizationId: orgId } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  const product = async (extra: { trackSerials?: boolean; reorderPoint?: number } = {}) =>
    (
      await prisma.product.create({
        data: {
          name: `P ${randomUUID().slice(0, 6)}`,
          sku: `P-${randomUUID().slice(0, 8)}`,
          categoryId,
          organizationId: orgId,
          costPrice: 1_000,
          ...extra,
        },
      })
    ).id;
  const putStock = (productId: string, locationId: string, quantity: number) =>
    prisma.stock.create({ data: { productId, locationId, organizationId: orgId, quantity } });
  const qty = async (productId: string, locationId: string) =>
    Number(
      (await prisma.stock.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity ?? 0,
    );

  it('lets stock on its way come in after the product is archived', async () => {
    const productId = await product();
    await putStock(productId, fromId, 20);
    const sent = await transfers.create(orgId, userId, {
      fromLocationId: fromId,
      toLocationId: toId,
      items: [{ productId, quantity: 5 }],
    });
    await transfers.ship(orgId, sent.id, userId);
    const back = await transfers.create(orgId, userId, {
      fromLocationId: fromId,
      toLocationId: toId,
      items: [{ productId, quantity: 3 }],
    });
    await transfers.ship(orgId, back.id, userId);

    await prisma.product.update({ where: { id: productId }, data: { active: false } });

    const received = await transfers.receive(orgId, sent.id, userId, {});
    expect(received.status).toBe(StockTransferStatus.RECEIVED);
    const cancelled = await transfers.cancel(orgId, back.id, userId);
    expect(cancelled.status).toBe(StockTransferStatus.CANCELLED);
    expect(await qty(productId, toId)).toBe(5);
    expect(await qty(productId, fromId)).toBe(15);

    // Selling or moving it out is still refused.
    const draft = await prisma.stockTransfer.create({
      data: {
        organizationId: orgId,
        fromLocationId: fromId,
        toLocationId: toId,
        createdById: userId,
        items: { create: [{ productId, quantity: 1 }] },
      },
    });
    await expect(transfers.ship(orgId, draft.id, userId)).rejects.toThrow(/archived/);
  });

  it('counts goods in transit as on hand in the reorder report', async () => {
    const productId = await product({ reorderPoint: 10 });
    await putStock(productId, fromId, 12);
    const t = await transfers.create(orgId, userId, {
      fromLocationId: fromId,
      toLocationId: toId,
      items: [{ productId, quantity: 8 }],
    });
    await transfers.ship(orgId, t.id, userId);

    const line = (await reorder.report(orgId, false)).find((l) => l.productId === productId)!;
    expect(line.onHand).toBe(12);
    expect((await reorder.report(orgId, true)).some((l) => l.productId === productId)).toBe(false);
  });

  it('applies a stock count against the shelf at save time', async () => {
    const productId = await product();
    await putStock(productId, fromId, 10);
    // The page saw 10 and worked out −3 for a count of 7; then 2 sold.
    await prisma.stock.update({
      where: { productId_locationId: { productId, locationId: fromId } },
      data: { quantity: 8 },
    });

    const res = await stock.adjust(orgId, userId, {
      productId,
      locationId: fromId,
      qtyDelta: -3,
      countedQty: 7,
      reason: 'Count',
    });
    expect(res.qtyDelta).toBe(-1);
    expect(await qty(productId, fromId)).toBe(7);

    const same = await stock.adjust(orgId, userId, {
      productId,
      locationId: fromId,
      qtyDelta: 1,
      countedQty: 7,
      reason: 'Count',
    });
    expect(same.qtyDelta).toBe(0);
    expect(await qty(productId, fromId)).toBe(7);
  });

  it('says when an adjustment leaves serial numbers out of step', async () => {
    const productId = await product({ trackSerials: true });
    await putStock(productId, fromId, 2);
    await prisma.productSerial.createMany({
      data: ['S1', 'S2'].map((serialNumber) => ({
        organizationId: orgId,
        productId,
        serialNumber,
        locationId: fromId,
      })),
    });

    const res = await stock.adjust(orgId, userId, { productId, locationId: fromId, qtyDelta: -1, reason: 'Broken' });
    expect(res.serialsInStock).toBe(2);

    const plain = await product();
    const ok = await stock.adjust(orgId, userId, { productId: plain, locationId: fromId, qtyDelta: 1, reason: 'Found' });
    expect(ok.serialsInStock).toBeNull();
  });

  it('imports into an existing location by name and refuses an archived one', async () => {
    const sku = `IMP-${randomUUID().slice(0, 6)}`;
    await prisma.location.create({
      data: { id: `${orgId}_old_shelf`, name: 'Old Shelf', organizationId: orgId, archivedAt: new Date() },
    });

    const res = await stock.import(orgId, userId, ImportMode.INCREMENT, [
      { sku, name: 'Imported', category: 'General', location: 'rak a-1', qty: 4 },
      { sku, name: 'Imported', category: 'General', location: 'Old Shelf', qty: 1 },
    ]);

    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0].location).toBe('Rak A-1');
    expect(res.rejected[0].reason).toMatch(/archived/);
    expect(await prisma.location.count({ where: { organizationId: orgId, name: { equals: 'Rak A-1', mode: 'insensitive' } } })).toBe(1);
  });

  it('names the serials that could not be moved', async () => {
    const productId = await product({ trackSerials: true });
    await prisma.productSerial.createMany({
      data: [
        { organizationId: orgId, productId, serialNumber: 'A1', locationId: fromId },
        { organizationId: orgId, productId, serialNumber: 'B1', locationId: toId },
        { organizationId: orgId, productId, serialNumber: 'X1', locationId: fromId, status: 'SOLD' },
      ],
    });

    await expect(
      prisma.$transaction((tx) =>
        relocateSerials(tx, { organizationId: orgId, productId, fromLocationId: fromId, toLocationId: toId, serials: ['A1', 'B1'] }),
      ),
    ).rejects.toThrow('Not in stock at this location: B1');

    await expect(
      prisma.$transaction((tx) =>
        takeSerials(tx, {
          organizationId: orgId,
          productId,
          locationId: fromId,
          serials: ['A1', 'X1'],
          to: 'SOLD',
          refs: {},
        }),
      ),
    ).rejects.toThrow('Not in stock at this location: X1');
  });
});
