import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryStatus, PaymentMethod, PurchaseOrderStatus, SystemAccountKey } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { SupplierPaymentsModule } from '../accounting/supplier-payments.module';
import { SupplierPaymentsService } from '../accounting/supplier-payments.service';
import { GoodsReceiptModule } from './goods-receipt.module';
import { GoodsReceiptService } from './goods-receipt.service';

// Receiving against a PO: stock goes up, the PO status follows, and the AP
// posted here is what supplier payments are paid against. Runs against the
// isolated test DB (see test/setup-test-env.ts) in a fresh org.
describe('Goods receipt against a purchase order', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let receipts: GoodsReceiptService;
  let supplierPayments: SupplierPaymentsService;

  let orgId: string;
  let userId: string;
  let locationId: string;
  let productId: string;

  const UNIT_COST = 20_000;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, GoodsReceiptModule, SupplierPaymentsModule],
    }).compile();
    prisma = module.get(PrismaService);
    receipts = module.get(GoodsReceiptService);
    supplierPayments = module.get(SupplierPaymentsService);

    const org = await prisma.organization.create({ data: { name: `GR Test ${randomUUID()}` } });
    orgId = org.id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    const user = await prisma.user.create({
      data: { email: `gr-${randomUUID()}@example.com`, password: 'x', role: 'USER', organizationId: orgId },
    });
    userId = user.id;
    locationId = (await prisma.location.create({ data: { name: 'Main', organizationId: orgId } })).id;
    const category = await prisma.category.create({ data: { name: 'General', organizationId: orgId } });
    productId = (
      await prisma.product.create({
        data: { name: 'Bulk Oil', sku: `BO-${randomUUID().slice(0, 8)}`, categoryId: category.id, organizationId: orgId },
      })
    ).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  async function sentPo(quantity: number) {
    const lineTotal = quantity * UNIT_COST;
    return prisma.purchaseOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        status: PurchaseOrderStatus.SENT,
        subtotal: lineTotal,
        total: lineTotal,
        items: { create: [{ productId, quantity, unitCost: UNIT_COST, lineTotal }] },
      },
      include: { items: true },
    });
  }

  async function stock() {
    const row = await prisma.stock.findUnique({
      where: { productId_locationId: { productId, locationId } },
    });
    return Number(row?.quantity ?? 0);
  }

  async function apBalance() {
    const ap = await prisma.chartOfAccount.findUniqueOrThrow({
      where: { organizationId_systemKey: { organizationId: orgId, systemKey: SystemAccountKey.ACCOUNTS_PAYABLE } },
    });
    const sums = await prisma.journalEntryLine.aggregate({
      where: { accountId: ap.id, journalEntry: { status: JournalEntryStatus.POSTED } },
      _sum: { debit: true, credit: true },
    });
    return Number(sums._sum.credit ?? 0) - Number(sums._sum.debit ?? 0); // credit-positive
  }

  it('receives in parts (fractional too), adds stock, posts AP and completes the PO', async () => {
    const po = await sentPo(5);
    const itemId = po.items[0].id;
    const stockBefore = await stock();
    const apBefore = await apBalance();

    const first = await receipts.receive(orgId, userId, po.id, {
      locationId,
      items: [{ purchaseOrderItemId: itemId, quantity: 2.5 }],
    });
    expect(first.purchaseOrderStatus).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
    expect(await stock()).toBeCloseTo(stockBefore + 2.5);
    expect(await apBalance()).toBeCloseTo(apBefore + 2.5 * UNIT_COST);

    const summary = await receipts.getReceivingSummary(orgId, po.id);
    expect(summary.items[0]).toMatchObject({ ordered: 5, previouslyReceived: 2.5, remaining: 2.5 });

    await expect(
      receipts.receive(orgId, userId, po.id, { locationId, items: [{ purchaseOrderItemId: itemId, quantity: 3 }] }),
    ).rejects.toThrow(/only 2.5 remaining/);

    const second = await receipts.receive(orgId, userId, po.id, {
      locationId,
      items: [{ purchaseOrderItemId: itemId, quantity: 2.5 }],
    });
    expect(second.purchaseOrderStatus).toBe(PurchaseOrderStatus.FULLY_RECEIVED);
    expect(await stock()).toBeCloseTo(stockBefore + 5);
    expect(await receipts.listReceipts(orgId, po.id)).toHaveLength(2);
  });

  it('lets supplier payments draw down what was received, and nothing more', async () => {
    const po = await sentPo(4);
    await expect(
      supplierPayments.create(orgId, userId, { purchaseOrderId: po.id, amount: 1, method: PaymentMethod.CASH } as any),
    ).rejects.toThrow(/no outstanding balance/);

    await receipts.receive(orgId, userId, po.id, {
      locationId,
      items: [{ purchaseOrderItemId: po.items[0].id, quantity: 1 }],
    });
    expect(await supplierPayments.getOutstanding(orgId, po.id)).toBe(UNIT_COST);

    await supplierPayments.create(orgId, userId, {
      purchaseOrderId: po.id,
      amount: UNIT_COST,
      method: PaymentMethod.CASH,
    } as any);
    expect(await supplierPayments.getOutstanding(orgId, po.id)).toBe(0);
  });

  it('refuses a draft PO', async () => {
    const po = await prisma.purchaseOrder.create({
      data: { organizationId: orgId, status: PurchaseOrderStatus.DRAFT },
    });
    await expect(receipts.getReceivingSummary(orgId, po.id)).rejects.toThrow(/DRAFT/);
  });
});
