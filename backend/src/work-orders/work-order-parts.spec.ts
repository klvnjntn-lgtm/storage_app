import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PurchaseOrderStatus, WorkOrderStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { WorkOrdersModule } from './work-orders.module';
import { WorkOrdersService } from './work-orders.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Waiting for parts: what a job is short of, ordering it from the agent, and receiving it on the job.
describe('Work order parts', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let workOrders: WorkOrdersService;

  let orgId: string;
  let userId: string;
  let rackId: string;
  let categoryId: string;
  let vehicleId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, WorkOrdersModule] }).compile();
    prisma = module.get(PrismaService);
    workOrders = module.get(WorkOrdersService);

    orgId = (await prisma.organization.create({ data: { name: `WO parts ${randomUUID()}`, workOrdersEnabled: true } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    for (const m of ['INVOICE_POS', 'WORKSHOP_RMS'] as const) {
      await prisma.organizationModule.create({ data: { organizationId: orgId, module: m, enabled: true } });
    }
    userId = (
      await prisma.user.create({
        data: { email: `wo-parts-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    rackId = (await prisma.location.create({ data: { name: 'Rack', organizationId: orgId } })).id;
    categoryId = (await prisma.category.create({ data: { name: 'Brakes', organizationId: orgId } })).id;
    const customerId = (await prisma.customer.create({ data: { name: 'Sari', organizationId: orgId } })).id;
    vehicleId = (
      await prisma.vehicle.create({
        data: { organizationId: orgId, customerId, plateNumber: 'D 42 AB', plateNormalized: 'D42AB', vehicleModel: 'Brio' },
      })
    ).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  // A part with `onHand` on the rack, and a started job needing `needed` of it.
  async function jobNeeding(onHand: number, needed: number) {
    const productId = (
      await prisma.product.create({
        data: {
          name: 'Brake pads',
          sku: `BP-${randomUUID().slice(0, 8)}`,
          categoryId,
          organizationId: orgId,
          sellingPrice: 200_000,
          costPrice: 120_000,
        },
      })
    ).id;
    if (onHand > 0) {
      await prisma.stock.create({ data: { productId, locationId: rackId, organizationId: orgId, quantity: onHand } });
    }
    const wo = await workOrders.create(orgId, userId, {
      vehicleId,
      items: [{ productId, locationId: rackId, quantity: needed }],
    });
    await workOrders.setStatus(orgId, wo.id, WorkOrderStatus.IN_PROGRESS);
    return { wo, productId };
  }

  it('shows what the shelf is short of, after other jobs’ holds', async () => {
    const { wo, productId } = await jobNeeding(1, 2);
    let { lines } = await workOrders.parts(orgId, wo.id);
    expect(lines).toEqual([
      expect.objectContaining({ productId, needed: 2, onHand: 1, heldElsewhere: 0, available: 1, short: 1, toOrder: 1 }),
    ]);

    // A second job for the same part: the first job's hold leaves it nothing.
    const other = await workOrders.create(orgId, userId, {
      vehicleId,
      items: [{ productId, locationId: rackId, quantity: 1 }],
    });
    ({ lines } = await workOrders.parts(orgId, other.id));
    expect(lines[0]).toMatchObject({ needed: 1, onHand: 1, heldElsewhere: 2, available: 0, short: 1 });
  });

  it('orders the shortage as a draft PO on the job and waits for it', async () => {
    const { wo, productId } = await jobNeeding(0, 2);
    const { lines, orders } = await workOrders.orderParts(orgId, userId, wo.id, {
      expectedDate: '2026-11-03',
      lines: [{ productId, locationId: rackId, quantity: 2 }],
    });
    expect(lines[0]).toMatchObject({ short: 2, onOrder: 2, toOrder: 0 });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: PurchaseOrderStatus.DRAFT, location: { id: rackId } });
    expect(orders[0].lines[0]).toMatchObject({ productId, quantity: 2, unitCost: 120_000 });
    expect((await workOrders.getOne(orgId, wo.id)).status).toBe(WorkOrderStatus.WAITING_PARTS);

    const board = await workOrders.board(orgId);
    expect(board.jobs.find((j) => j.id === wo.id)?.partsExpectedAt).toEqual(new Date('2026-11-03'));
  });

  it('refuses parts that are not on the job', async () => {
    const { wo } = await jobNeeding(0, 1);
    const { productId: elsewhere } = await jobNeeding(0, 1);
    await expect(
      workOrders.orderParts(orgId, userId, wo.id, { lines: [{ productId: elsewhere, locationId: rackId, quantity: 1 }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('receives arrived parts at what was paid and resumes the job', async () => {
    const { wo, productId } = await jobNeeding(0, 2);
    const { orders } = await workOrders.orderParts(orgId, userId, wo.id, {
      lines: [{ productId, locationId: rackId, quantity: 2 }],
    });
    const poId = orders[0].id;

    await expect(
      workOrders.partsArrived(orgId, userId, 'ADMIN', wo.id, poId, { lines: [{ productId, quantity: 2 }] }),
    ).rejects.toThrow('Enter what was paid for each part');

    const after = await workOrders.partsArrived(orgId, userId, 'ADMIN', wo.id, poId, {
      lines: [{ productId, quantity: 2, unitCost: 110_000 }],
    });
    expect(after.lines[0]).toMatchObject({ onHand: 2, short: 0, onOrder: 0, toOrder: 0 });
    expect(after.orders[0]).toMatchObject({ status: PurchaseOrderStatus.FULLY_RECEIVED });
    expect(after.orders[0].lines[0]).toMatchObject({ unitCost: 110_000, received: 2 });

    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.poNumber).toBeTruthy();
    expect((await workOrders.getOne(orgId, wo.id)).status).toBe(WorkOrderStatus.IN_PROGRESS);
  });

  it('keeps waiting when only part of the order came, and the rest shows to reorder', async () => {
    const { wo, productId } = await jobNeeding(0, 3);
    const { orders } = await workOrders.orderParts(orgId, userId, wo.id, {
      lines: [{ productId, locationId: rackId, quantity: 3 }],
    });
    const { lines } = await workOrders.partsArrived(orgId, userId, 'ADMIN', wo.id, orders[0].id, {
      lines: [{ productId, quantity: 1, unitCost: 100_000 }],
    });
    expect(lines[0]).toMatchObject({ onHand: 1, short: 2, onOrder: 0, toOrder: 2 });
    expect((await workOrders.getOne(orgId, wo.id)).status).toBe(WorkOrderStatus.WAITING_PARTS);
  });

  it('cancels an order the agent can’t fill', async () => {
    const { wo, productId } = await jobNeeding(0, 1);
    const { orders } = await workOrders.orderParts(orgId, userId, wo.id, {
      lines: [{ productId, locationId: rackId, quantity: 1 }],
    });
    const after = await workOrders.cancelPartsOrder(orgId, userId, wo.id, orders[0].id);
    expect(after.orders).toHaveLength(0);
    expect(after.lines[0]).toMatchObject({ short: 1, onOrder: 0, toOrder: 1 });
  });
});
