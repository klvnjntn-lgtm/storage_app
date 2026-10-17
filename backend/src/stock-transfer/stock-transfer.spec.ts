import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CostChangeSource,
  JournalEntryStatus,
  JournalSourceType,
  StockTransferStatus,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { AccountingModule } from '../accounting/accounting.module';
import { receiveAtCost } from '../accounting/inventory-costing';
import { StockTransferModule } from './stock-transfer.module';
import { StockTransferService } from './stock-transfer.service';

// Runs against the isolated test DB (see test/setup-test-env.ts) in a fresh org.
describe('Stock transfers (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let transfers: StockTransferService;

  let orgId: string;
  let userId: string;
  let fromId: string;
  let toId: string;
  let productId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, AccountingModule, StockTransferModule],
    }).compile();
    prisma = module.get(PrismaService);
    transfers = module.get(StockTransferService);

    orgId = (
      await prisma.organization.create({
        data: { name: `Transfer ${randomUUID()}` },
      })
    ).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    userId = (
      await prisma.user.create({
        data: {
          email: `tr-${randomUUID()}@example.com`,
          password: 'x',
          organizationId: orgId,
        },
      })
    ).id;
    fromId = (
      await prisma.location.create({
        data: { id: `${orgId}_a`, name: 'Branch A', organizationId: orgId },
      })
    ).id;
    toId = (
      await prisma.location.create({
        data: { id: `${orgId}_b`, name: 'Branch B', organizationId: orgId },
      })
    ).id;
    const category = await prisma.category.create({
      data: { name: 'General', organizationId: orgId },
    });
    productId = (
      await prisma.product.create({
        data: {
          name: 'Oil',
          sku: `OIL-${randomUUID().slice(0, 6)}`,
          categoryId: category.id,
          organizationId: orgId,
          costPrice: 1_000,
        },
      })
    ).id;
    await prisma.stock.create({
      data: {
        productId,
        locationId: fromId,
        organizationId: orgId,
        quantity: 100,
      },
    });
  });

  afterAll(async () => {
    await module?.close();
  });

  const qty = async (locationId: string) =>
    Number(
      (
        await prisma.stock.findUnique({
          where: { productId_locationId: { productId, locationId } },
        })
      )?.quantity ?? 0,
    );

  it('moves stock out on ship, in on receipt, and writes off what never arrived', async () => {
    const draft = await transfers.create(orgId, userId, {
      fromLocationId: fromId,
      toLocationId: toId,
      items: [{ productId, quantity: 30 }],
    });
    expect(draft.transferNumber).toMatch(/^TR-/);
    expect(await qty(fromId)).toBe(100);

    const shipped = await transfers.ship(orgId, draft.id, userId);
    expect(shipped.status).toBe(StockTransferStatus.IN_TRANSIT);
    expect(await qty(fromId)).toBe(70);
    await expect(transfers.ship(orgId, draft.id, userId)).rejects.toThrow(
      /in transit/,
    );

    const received = await transfers.receive(orgId, draft.id, userId, {
      items: [{ itemId: draft.items[0].id, receivedQuantity: 28 }],
    });
    expect(received.status).toBe(StockTransferStatus.RECEIVED);
    expect(await qty(toId)).toBe(28);

    const writeOff = await prisma.journalEntry.findFirst({
      where: {
        organizationId: orgId,
        sourceType: JournalSourceType.STOCK_ADJUSTMENT,
        sourceId: `stock-transfer:${draft.items[0].id}`,
        status: JournalEntryStatus.POSTED,
      },
      include: { lines: true },
    });
    expect(writeOff?.lines.reduce((s, l) => s + Number(l.debit), 0)).toBe(
      2_000,
    );
  });

  it('returns goods to the source when an in-transit transfer is cancelled', async () => {
    const before = await qty(fromId);
    const draft = await transfers.create(orgId, userId, {
      fromLocationId: fromId,
      toLocationId: toId,
      items: [{ productId, quantity: 5 }],
    });
    await transfers.ship(orgId, draft.id, userId);
    expect(await qty(fromId)).toBe(before - 5);
    await transfers.cancel(orgId, draft.id, userId);
    expect(await qty(fromId)).toBe(before);
  });

  it('counts goods in transit as on hand when averaging a new receipt', async () => {
    const draft = await transfers.create(orgId, userId, {
      fromLocationId: fromId,
      toLocationId: toId,
      items: [{ productId, quantity: 20 }],
    });
    await transfers.ship(orgId, draft.id, userId);
    const onHand = (await qty(fromId)) + (await qty(toId)) + 20;

    const newCost = await prisma.$transaction((tx) =>
      receiveAtCost(tx, {
        organizationId: orgId,
        productId,
        quantity: onHand,
        unitCost: 3_000,
        source: CostChangeSource.GOODS_RECEIPT,
      }),
    );
    // Equal quantities at 1,000 and 3,000 average to 2,000 only if the 20
    // units on the truck were counted.
    expect(newCost).toBe(2_000);
    await transfers.receive(orgId, draft.id, userId, {});
  });

  it('a quick move lands stock at the destination in one step', async () => {
    const [from, to] = [await qty(fromId), await qty(toId)];
    const moved = await transfers.create(orgId, userId, {
      fromLocationId: fromId,
      toLocationId: toId,
      quickMove: true,
      items: [{ productId, quantity: 4 }],
    });
    expect(moved.quickMove).toBe(true);
    expect(moved.status).toBe(StockTransferStatus.RECEIVED);
    expect(moved.items[0].receivedQuantity?.toString()).toBe('4');
    expect(await qty(fromId)).toBe(from - 4);
    expect(await qty(toId)).toBe(to + 4);
  });

  it('a quick move carries serial-tracked units to the destination', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { organizationId: orgId } });
    const battery = await prisma.product.create({
      data: {
        name: 'Battery',
        sku: `BAT-${randomUUID().slice(0, 6)}`,
        categoryId: category.id,
        organizationId: orgId,
        trackSerials: true,
      },
    });
    await prisma.stock.create({
      data: { productId: battery.id, locationId: fromId, organizationId: orgId, quantity: 2 },
    });
    await prisma.productSerial.createMany({
      data: ['SN-1', 'SN-2'].map((serialNumber) => ({
        organizationId: orgId,
        productId: battery.id,
        serialNumber,
        locationId: fromId,
      })),
    });

    await expect(
      transfers.create(orgId, userId, {
        fromLocationId: fromId,
        toLocationId: toId,
        quickMove: true,
        items: [{ productId: battery.id, quantity: 1 }],
      }),
    ).rejects.toThrow(/serial number/);

    await transfers.create(orgId, userId, {
      fromLocationId: fromId,
      toLocationId: toId,
      quickMove: true,
      items: [{ productId: battery.id, quantity: 1, serialNumbers: ['SN-2'] }],
    });
    const serials = await prisma.productSerial.findMany({
      where: { productId: battery.id },
      orderBy: { serialNumber: 'asc' },
    });
    expect(serials.map((x) => [x.serialNumber, x.status, x.locationId])).toEqual([
      ['SN-1', 'IN_STOCK', fromId],
      ['SN-2', 'IN_STOCK', toId],
    ]);
  });

  it('refuses a transfer to the same location', async () => {
    await expect(
      transfers.create(orgId, userId, {
        fromLocationId: fromId,
        toLocationId: fromId,
        items: [{ productId, quantity: 1 }],
      }),
    ).rejects.toThrow(/two different locations/);
  });
});
