import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApprovalStatus,
  PaymentMethod,
  PurchaseOrderStatus,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountingReportsService } from '../accounting/accounting-reports.service';
import { SupplierPaymentsModule } from '../accounting/supplier-payments.module';
import { SupplierPaymentsService } from '../accounting/supplier-payments.service';
import { GoodsReceiptModule } from '../goods-receipt/goods-receipt.module';
import { GoodsReceiptService } from '../goods-receipt/goods-receipt.service';
import { PurchaseOrderModule } from '../purchase-order/purchase-order.module';
import { PurchaseOrderService } from '../purchase-order/purchase-order.service';
import { SupplierBillModule } from '../supplier-bill/supplier-bill.module';
import { SupplierBillService } from '../supplier-bill/supplier-bill.service';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ApprovalsService } from '../approvals/approvals.service';
import { ReorderModule } from '../reorder/reorder.module';
import { ReorderService } from '../reorder/reorder.service';
import { BatchesModule } from '../batches/batches.module';
import { BatchesService } from '../batches/batches.service';
import { allocateOnHand } from '../batches/batch-allocation';
import { PurchaseReturnModule } from './purchase-return.module';
import { PurchaseReturnService } from './purchase-return.service';

process.env.PRINT_TOKEN_SECRET ??= 'test-print-secret';
// Puppeteer is ESM-only and never used here (no PDFs rendered).
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

describe('allocateOnHand (FEFO)', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const batch = (
    id: string,
    quantity: number,
    expiry: string | null,
    received = '2026-01-01',
  ) => ({
    id,
    quantity,
    expiryDate: expiry ? d(expiry) : null,
    receivedAt: d(received),
  });

  it('keeps the latest-expiring batches and reports stock without a batch', () => {
    const { remaining, unassigned } = allocateOnHand(
      [
        batch('a', 10, '2026-03-01'),
        batch('b', 10, '2026-06-01'),
        batch('c', 5, null),
      ],
      12,
    );
    expect(remaining.get('c')).toBe(5); // no expiry: last to go
    expect(remaining.get('b')).toBe(7);
    expect(remaining.get('a')).toBe(0);
    expect(unassigned).toBe(0);

    expect(allocateOnHand([batch('a', 3, '2026-03-01')], 10).unassigned).toBe(
      7,
    );
    expect(
      allocateOnHand([batch('a', 3, '2026-03-01')], -2).remaining.get('a'),
    ).toBe(0);
  });
});

// Runs against the isolated test DB (see test/setup-test-env.ts) in a fresh org.
describe('Purchasing flows (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let receipts: GoodsReceiptService;
  let returns: PurchaseReturnService;
  let payments: SupplierPaymentsService;
  let bills: SupplierBillService;
  let reports: AccountingReportsService;
  let purchaseOrders: PurchaseOrderService;
  let approvals: ApprovalsService;
  let reorder: ReorderService;
  let batches: BatchesService;

  let orgId: string;
  let adminId: string;
  let staffId: string;
  let locationId: string;
  let supplierId: string;
  let categoryId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AccountingModule,
        GoodsReceiptModule,
        SupplierPaymentsModule,
        PurchaseReturnModule,
        SupplierBillModule,
        PurchaseOrderModule,
        ApprovalsModule,
        ReorderModule,
        BatchesModule,
      ],
    }).compile();
    prisma = module.get(PrismaService);
    receipts = module.get(GoodsReceiptService);
    returns = module.get(PurchaseReturnService);
    payments = module.get(SupplierPaymentsService);
    bills = module.get(SupplierBillService);
    reports = module.get(AccountingReportsService);
    purchaseOrders = module.get(PurchaseOrderService);
    approvals = module.get(ApprovalsService);
    reorder = module.get(ReorderService);
    batches = module.get(BatchesService);

    const org = await prisma.organization.create({
      data: { name: `Purchasing ${randomUUID()}`, seatLimit: 5 },
    });
    orgId = org.id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    adminId = (
      await prisma.user.create({
        data: {
          email: `pa-${randomUUID()}@example.com`,
          password: 'x',
          role: 'ADMIN',
          organizationId: orgId,
        },
      })
    ).id;
    staffId = (
      await prisma.user.create({
        data: {
          email: `ps-${randomUUID()}@example.com`,
          password: 'x',
          role: 'USER',
          organizationId: orgId,
        },
      })
    ).id;
    locationId = (
      await prisma.location.create({
        data: { id: `${orgId}_main`, name: 'Main', organizationId: orgId },
      })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: { organizationId: orgId, name: 'Supplier A' },
      })
    ).id;
    categoryId = (
      await prisma.category.create({
        data: { name: 'General', organizationId: orgId },
      })
    ).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  async function product(extra: Record<string, unknown> = {}) {
    return prisma.product.create({
      data: {
        name: `P ${randomUUID().slice(0, 6)}`,
        sku: randomUUID().slice(0, 12),
        categoryId,
        organizationId: orgId,
        ...extra,
      },
    });
  }

  // A sent PO for one product, with a 10% discount and 11% tax on top.
  async function sentPo(productId: string, quantity: number, unitCost: number) {
    const subtotal = quantity * unitCost;
    const discountAmount = subtotal * 0.1;
    const taxAmount = (subtotal - discountAmount) * 0.11;
    return prisma.purchaseOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        supplierId,
        status: PurchaseOrderStatus.SENT,
        subtotal,
        discountAmount,
        taxAmount,
        total: subtotal - discountAmount + taxAmount,
        items: {
          create: [{ productId, quantity, unitCost, lineTotal: subtotal }],
        },
      },
      include: { items: true },
    });
  }

  async function onHand(productId: string) {
    const row = await prisma.stock.findUnique({
      where: { productId_locationId: { productId, locationId } },
    });
    return Number(row?.quantity ?? 0);
  }

  describe('purchase returns', () => {
    it('reverses the receipt exactly: stock, AP and the PO balance', async () => {
      const p = await product();
      const po = await sentPo(p.id, 10, 10_000);
      await receipts.receive(orgId, adminId, po.id, {
        locationId,
        items: [{ purchaseOrderItemId: po.items[0].id, quantity: 10 }],
      });
      const owedBefore = await payments.getOutstanding(orgId, po.id);
      expect(owedBefore).toBeCloseTo(99_900); // 100k - 10% + 11%

      const ret = await returns.create(orgId, adminId, po.id, {
        locationId,
        reason: 'Damaged',
        items: [{ purchaseOrderItemId: po.items[0].id, quantity: 4 }],
      });
      expect(Number(ret.subtotal)).toBeCloseTo(36_000);
      expect(Number(ret.taxAmount)).toBeCloseTo(3_960);
      expect(await onHand(p.id)).toBe(6);
      expect(await payments.getOutstanding(orgId, po.id)).toBeCloseTo(
        owedBefore - 39_960,
      );

      const left = await returns.returnable(orgId, po.id);
      expect(left.items[0]).toMatchObject({
        received: 10,
        returned: 4,
        returnable: 6,
      });
      await expect(
        returns.create(orgId, adminId, po.id, {
          locationId,
          items: [{ purchaseOrderItemId: po.items[0].id, quantity: 7 }],
        }),
      ).rejects.toThrow(/only 6 received and not yet returned/);
    });

    it('keeps the average cost of what stays when returning at a different cost', async () => {
      const p = await product();
      const cheap = await sentPo(p.id, 10, 10_000);
      await receipts.receive(orgId, adminId, cheap.id, {
        locationId,
        items: [{ purchaseOrderItemId: cheap.items[0].id, quantity: 10 }],
      });
      const dear = await sentPo(p.id, 10, 20_000);
      await receipts.receive(orgId, adminId, dear.id, {
        locationId,
        items: [{ purchaseOrderItemId: dear.items[0].id, quantity: 10 }],
      });
      // Net of the 10% discount: (10×9k + 10×18k)/20 = 13.5k
      expect(
        Number(
          (await prisma.product.findUniqueOrThrow({ where: { id: p.id } }))
            .costPrice,
        ),
      ).toBeCloseTo(13_500);

      await returns.create(orgId, adminId, dear.id, {
        locationId,
        items: [{ purchaseOrderItemId: dear.items[0].id, quantity: 10 }],
      });
      expect(
        Number(
          (await prisma.product.findUniqueOrThrow({ where: { id: p.id } }))
            .costPrice,
        ),
      ).toBeCloseTo(9_000);
    });

    it('turns a return after full payment into supplier credit that AP aging reconciles', async () => {
      const p = await product();
      const po = await sentPo(p.id, 2, 50_000);
      await receipts.receive(orgId, adminId, po.id, {
        locationId,
        items: [{ purchaseOrderItemId: po.items[0].id, quantity: 2 }],
      });
      const owed = await payments.getOutstanding(orgId, po.id);
      await payments.create(orgId, adminId, {
        purchaseOrderId: po.id,
        amount: owed,
        method: PaymentMethod.CASH,
      } as any);

      await returns.create(orgId, adminId, po.id, {
        locationId,
        items: [{ purchaseOrderItemId: po.items[0].id, quantity: 1 }],
      });
      expect(await payments.getOutstanding(orgId, po.id)).toBeLessThan(0);

      const aging = await reports.getAPAging(
        orgId,
        new Date(Date.now() + 86_400_000),
      );
      expect(aging.reconciliation.supplierCredits).toBeGreaterThan(0);
      expect(aging.reconciliation.matches).toBe(true);
    });
  });

  describe('supplier bills', () => {
    it('matches the bill against what was received, net of returns', async () => {
      const p = await product();
      const po = await sentPo(p.id, 5, 10_000);
      expect((await bills.match(orgId, po.id)).status).toBe('NOT_BILLED');

      await receipts.receive(orgId, adminId, po.id, {
        locationId,
        items: [{ purchaseOrderItemId: po.items[0].id, quantity: 5 }],
      });
      const received = (await bills.match(orgId, po.id)).received;

      const bill = await bills.create(orgId, adminId, po.id, {
        billNumber: 'INV-77',
        billDate: '2026-10-01',
        dueDate: '2026-10-31',
        amount: received + 0.5,
      });
      expect((await bills.match(orgId, po.id)).status).toBe('MATCHED');
      await expect(
        bills.create(orgId, adminId, po.id, {
          billNumber: 'INV-77',
          billDate: '2026-10-01',
          amount: 1,
        }),
      ).rejects.toThrow(/already recorded/);

      await returns.create(orgId, adminId, po.id, {
        locationId,
        items: [{ purchaseOrderItemId: po.items[0].id, quantity: 1 }],
      });
      const after = await bills.match(orgId, po.id);
      expect(after.status).toBe('OVER_BILLED');
      expect(after.lines[0]).toMatchObject({
        ordered: 5,
        received: 5,
        returned: 1,
      });

      await bills.void(orgId, bill.id);
      expect((await bills.match(orgId, po.id)).status).toBe('NOT_BILLED');
    });
  });

  describe('approvals', () => {
    it('holds a large PO from staff until an admin approves that total', async () => {
      await approvals.updateSettings(orgId, { poApprovalThreshold: 1_000_000 });
      const p = await product();
      const draft = await purchaseOrders.create(orgId, staffId, {
        supplierId,
        locationId,
        items: [{ productId: p.id, quantity: 10, unitCost: 150_000 }],
      });

      await expect(
        purchaseOrders.send(orgId, draft.id, staffId, 'USER'),
      ).rejects.toMatchObject({
        response: { error: 'ApprovalRequired' },
      });

      const request = await approvals.request(
        orgId,
        staffId,
        'PURCHASE_ORDER',
        draft.id,
        'Stocking up',
      );
      expect(
        await approvals.request(orgId, staffId, 'PURCHASE_ORDER', draft.id),
      ).toMatchObject({ id: request.id });
      await approvals.decide(orgId, adminId, request.id, true, 'OK');
      await expect(
        approvals.decide(orgId, adminId, request.id, false),
      ).rejects.toThrow(/already been decided/);

      // A bigger total than approved needs approving again.
      await prisma.purchaseOrder.update({
        where: { id: draft.id },
        data: { total: 2_000_000 },
      });
      await expect(
        purchaseOrders.send(orgId, draft.id, staffId, 'USER'),
      ).rejects.toMatchObject({
        response: { error: 'ApprovalRequired' },
      });
      await prisma.purchaseOrder.update({
        where: { id: draft.id },
        data: { total: 1_500_000 },
      });
      const sent = await purchaseOrders.send(orgId, draft.id, staffId, 'USER');
      expect(sent.status).toBe(PurchaseOrderStatus.SENT);

      const decided = await approvals.list(orgId, {
        status: ApprovalStatus.APPROVED,
      });
      expect(decided.find((r) => r.id === request.id)?.document?.total).toBe(
        1_500_000,
      );
      await approvals.updateSettings(orgId, { poApprovalThreshold: null });
    });

    it('never holds an admin', async () => {
      await approvals.updateSettings(orgId, { poApprovalThreshold: 1 });
      const p = await product();
      const draft = await purchaseOrders.create(orgId, adminId, {
        supplierId,
        items: [{ productId: p.id, quantity: 1, unitCost: 10 }],
      });
      await expect(
        purchaseOrders.send(orgId, draft.id, adminId, 'ADMIN'),
      ).resolves.toMatchObject({ status: 'SENT' });
      await approvals.updateSettings(orgId, { poApprovalThreshold: null });
    });
  });

  describe('reorder', () => {
    it('counts open orders before calling a product low, and drafts POs per supplier', async () => {
      const p = await product({
        reorderPoint: 10,
        reorderQuantity: 25,
        preferredSupplierId: supplierId,
        costPrice: 1_000,
      });
      await prisma.stock.create({
        data: {
          productId: p.id,
          locationId,
          organizationId: orgId,
          quantity: 4,
        },
      });

      let low = (await reorder.report(orgId)).find((l) => l.productId === p.id);
      expect(low).toMatchObject({
        onHand: 4,
        onOrder: 0,
        suggestedQuantity: 25,
      });

      const [draft] = await reorder.createDraftPurchaseOrders(orgId, adminId, {
        locationId,
        items: [{ productId: p.id, quantity: 25, supplierId }],
      });
      expect(draft.status).toBe(PurchaseOrderStatus.DRAFT);
      expect(Number(draft.items[0].unitCost)).toBe(1_000);

      await prisma.purchaseOrder.update({
        where: { id: draft.id },
        data: { status: PurchaseOrderStatus.SENT },
      });
      low = (await reorder.report(orgId)).find((l) => l.productId === p.id);
      expect(low).toBeUndefined();
      const all = (await reorder.report(orgId, false)).find(
        (l) => l.productId === p.id,
      );
      expect(all?.onOrder).toBe(25);
    });
  });

  describe('batches', () => {
    it('requires a batch on receipt for tracked products and derives what is left', async () => {
      const p = await product({ trackBatches: true });
      const po = await sentPo(p.id, 20, 1_000);
      await expect(
        receipts.receive(orgId, adminId, po.id, {
          locationId,
          items: [{ purchaseOrderItemId: po.items[0].id, quantity: 5 }],
        }),
      ).rejects.toThrow(/batch number is required/);

      await receipts.receive(orgId, adminId, po.id, {
        locationId,
        items: [
          {
            purchaseOrderItemId: po.items[0].id,
            quantity: 8,
            batchNumber: 'L-1',
            expiryDate: '2026-11-01',
          },
        ],
      });
      await receipts.receive(orgId, adminId, po.id, {
        locationId,
        items: [
          {
            purchaseOrderItemId: po.items[0].id,
            quantity: 12,
            batchNumber: 'L-2',
            expiryDate: '2027-05-01',
          },
        ],
      });
      // Sell 10 (FEFO takes all of L-1 and 2 of L-2).
      await prisma.stock.update({
        where: { productId_locationId: { productId: p.id, locationId } },
        data: { quantity: { decrement: 10 } },
      });

      const { batches: rows } = await batches.list(orgId, { productId: p.id });
      const by = new Map(rows.map((r) => [r.batchNumber, r]));
      expect(by.get('L-1')).toMatchObject({ received: 8, remaining: 0 });
      expect(by.get('L-2')).toMatchObject({ received: 12, remaining: 10 });
    });
  });
});
