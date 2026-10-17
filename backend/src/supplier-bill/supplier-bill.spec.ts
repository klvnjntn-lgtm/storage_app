import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { GoodsReceiptModule } from '../goods-receipt/goods-receipt.module';
import { GoodsReceiptService } from '../goods-receipt/goods-receipt.service';
import { SupplierBillModule } from './supplier-bill.module';
import { SupplierBillService } from './supplier-bill.service';

// Three-way match: ordered vs received (AP booked at receipt) vs billed.
// Runs against the isolated test DB (test/setup-test-env.ts).
describe('Supplier bills', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let bills: SupplierBillService;
  let receipts: GoodsReceiptService;

  let orgId: string;
  let userId: string;
  let locationId: string;
  let productId: string;
  let supplierId: string;

  const UNIT_COST = 25_000;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, SupplierBillModule, GoodsReceiptModule],
    }).compile();
    prisma = module.get(PrismaService);
    bills = module.get(SupplierBillService);
    receipts = module.get(GoodsReceiptService);

    orgId = (await prisma.organization.create({ data: { name: `Bills ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    userId = (
      await prisma.user.create({
        data: { email: `bills-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    locationId = (await prisma.location.create({ data: { name: 'Main', organizationId: orgId } })).id;
    const categoryId = (await prisma.category.create({ data: { name: 'Parts', organizationId: orgId } })).id;
    productId = (
      await prisma.product.create({
        data: { name: 'Brake pad', sku: `BP-${randomUUID().slice(0, 8)}`, categoryId, organizationId: orgId },
      })
    ).id;
    supplierId = (await prisma.supplier.create({ data: { name: 'PT Supplier', organizationId: orgId } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  async function sentPo(quantity: number, status: PurchaseOrderStatus = PurchaseOrderStatus.SENT) {
    const lineTotal = quantity * UNIT_COST;
    return prisma.purchaseOrder.create({
      data: {
        organizationId: orgId,
        supplierId,
        locationId,
        status,
        subtotal: lineTotal,
        total: lineTotal,
        items: { create: [{ productId, quantity, unitCost: UNIT_COST, lineTotal }] },
      },
      include: { items: true },
    });
  }

  const bill = (poId: string, amount: number, billNumber = `B-${randomUUID().slice(0, 6)}`) =>
    bills.create(orgId, userId, poId, { billNumber, billDate: '2026-10-01', amount });

  it('refuses a bill on a draft PO', async () => {
    const po = await sentPo(1, PurchaseOrderStatus.DRAFT);
    await expect(bill(po.id, UNIT_COST)).rejects.toThrow(BadRequestException);
  });

  it('matches the bill against what was received, not what was ordered', async () => {
    const po = await sentPo(4);
    expect((await bills.match(orgId, po.id)).status).toBe('NOT_BILLED');

    // Billed for all four before anything arrived.
    await bill(po.id, 4 * UNIT_COST);
    expect((await bills.match(orgId, po.id)).status).toBe('OVER_BILLED');

    await receipts.receive(orgId, userId, po.id, {
      locationId,
      items: [{ purchaseOrderItemId: po.items[0].id, quantity: 4 }],
    });
    const matched = await bills.match(orgId, po.id);
    expect(matched).toMatchObject({ status: 'MATCHED', received: 4 * UNIT_COST, billed: 4 * UNIT_COST, difference: 0 });
    expect(matched.lines[0]).toMatchObject({ ordered: 4, received: 4, returned: 0 });
  });

  it('allows a rupiah of rounding, but no more', async () => {
    const po = await sentPo(2);
    await receipts.receive(orgId, userId, po.id, {
      locationId,
      items: [{ purchaseOrderItemId: po.items[0].id, quantity: 2 }],
    });
    const first = await bill(po.id, 2 * UNIT_COST - 1);
    expect((await bills.match(orgId, po.id)).status).toBe('MATCHED');

    await bills.void(orgId, first.id);
    await bill(po.id, 2 * UNIT_COST - 500);
    expect((await bills.match(orgId, po.id))).toMatchObject({ status: 'UNDER_BILLED', difference: -500 });
  });

  it('refuses the same supplier bill number twice until the first is voided', async () => {
    const po = await sentPo(1);
    const number = `DUP-${randomUUID().slice(0, 6)}`;
    const first = await bill(po.id, UNIT_COST, number);
    await expect(bill(po.id, UNIT_COST, number)).rejects.toThrow(ConflictException);

    await bills.void(orgId, first.id);
    await expect(bills.void(orgId, first.id)).rejects.toThrow('not found');
    await bill(po.id, UNIT_COST, number);
  });

  it('refuses a due date before the bill date', async () => {
    const po = await sentPo(1);
    await expect(
      bills.create(orgId, userId, po.id, { billNumber: 'X', billDate: '2026-10-10', dueDate: '2026-10-01', amount: 1 }),
    ).rejects.toThrow('dueDate');
  });

  it('lists bills with their match and filters by it', async () => {
    const po = await sentPo(1);
    await bill(po.id, UNIT_COST);
    const over = await bills.list(orgId, { status: 'OVER_BILLED' });
    expect(over.some((b) => b.purchaseOrderId === po.id)).toBe(true);
    expect((await bills.list(orgId, { status: 'MATCHED' })).some((b) => b.purchaseOrderId === po.id)).toBe(false);
  });
});
