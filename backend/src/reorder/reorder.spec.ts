import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceFormat, InvoiceStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ReorderModule } from './reorder.module';
import { ReorderService } from './reorder.service';

// ReorderModule pulls in purchase orders, whose PDF printing needs puppeteer.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Runs against the isolated test DB (see test/setup-test-env.ts) in fresh orgs.
describe('Reorder: branches, auto-fill and the spreadsheet (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let reorder: ReorderService;

  let orgId: string;
  let userId: string;
  let categoryId: string;
  let supplierId: string;
  let branchA: string;
  let branchB: string;
  let locA: string;
  let locB: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, AccountingModule, ReorderModule] }).compile();
    prisma = module.get(PrismaService);
    reorder = module.get(ReorderService);

    orgId = (await prisma.organization.create({ data: { name: `Reorder ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    userId = (
      await prisma.user.create({ data: { email: `ro-${randomUUID()}@example.com`, password: 'x', organizationId: orgId } })
    ).id;
    branchA = (await prisma.branch.create({ data: { organizationId: orgId, name: 'A' } })).id;
    branchB = (await prisma.branch.create({ data: { organizationId: orgId, name: 'B' } })).id;
    locA = (await prisma.location.create({ data: { id: `${orgId}_a`, name: 'Gudang A', organizationId: orgId, branchId: branchA } })).id;
    locB = (await prisma.location.create({ data: { id: `${orgId}_b`, name: 'Gudang B', organizationId: orgId, branchId: branchB } })).id;
    categoryId = (await prisma.category.create({ data: { name: 'General', organizationId: orgId } })).id;
    supplierId = (await prisma.supplier.create({ data: { organizationId: orgId, name: 'PT Pemasok' } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  const product = async (extra: { reorderPoint?: number } = {}) =>
    prisma.product.create({
      data: {
        name: `P ${randomUUID().slice(0, 6)}`,
        sku: `P-${randomUUID().slice(0, 8)}`,
        categoryId,
        organizationId: orgId,
        costPrice: 1_000,
        ...extra,
      },
    });
  const putStock = (productId: string, locationId: string, quantity: number) =>
    prisma.stock.create({ data: { productId, locationId, organizationId: orgId, quantity } });

  it('compares each branch against its own stock and its own point', async () => {
    const p = await product({ reorderPoint: 10 });
    await putStock(p.id, locA, 4);
    await putStock(p.id, locB, 50);

    // Business-wide: 54 on hand, not low.
    expect((await reorder.report(orgId)).some((l) => l.productId === p.id)).toBe(false);
    // Branch A uses the product's point (10) against its own 4: low.
    const a = (await reorder.report(orgId, true, branchA)).find((l) => l.productId === p.id);
    expect(a).toMatchObject({ onHand: 4, reorderPoint: 10, branchOverride: false });
    expect((await reorder.report(orgId, true, branchB)).some((l) => l.productId === p.id)).toBe(false);

    // Branch B gets its own, higher point.
    await reorder.updateSettings(orgId, p.id, { reorderPoint: 60, reorderQuantity: 20 }, branchB);
    const b = (await reorder.report(orgId, true, branchB)).find((l) => l.productId === p.id);
    expect(b).toMatchObject({ onHand: 50, reorderPoint: 60, suggestedQuantity: 20, branchOverride: true, defaultReorderPoint: 10 });
    // The product's own point is untouched.
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).reorderPoint)).toBe(10);

    // Clearing the branch's point falls back to the product's.
    await reorder.updateSettings(orgId, p.id, { reorderPoint: null }, branchB);
    expect(await prisma.productReorderSetting.count({ where: { productId: p.id } })).toBe(0);
  });

  it('books draft POs to the branch and refuses a location from another', async () => {
    const p = await product({ reorderPoint: 5 });
    await expect(
      reorder.createDraftPurchaseOrders(orgId, userId, { locationId: locB, items: [{ productId: p.id, quantity: 3, supplierId }] }, branchA),
    ).rejects.toThrow(/branch/);
    const [po] = await reorder.createDraftPurchaseOrders(
      orgId, userId, { items: [{ productId: p.id, quantity: 3, supplierId }] }, branchA,
    );
    expect(po.branchId).toBe(branchA);
    expect(po.locationId).toBe(locA);
  });

  it('suggests reorder points from recent sales and only writes when applied', async () => {
    const p = await product();
    // 90 sold in the last 30 days at branch A → 3 a day → 14 days of cover = 42.
    await prisma.invoice.create({
      data: {
        organizationId: orgId,
        format: InvoiceFormat.A4,
        status: InvoiceStatus.ISSUED,
        issuedAt: new Date(Date.now() - 5 * 86_400_000),
        branchId: branchA,
        items: { create: [{ productId: p.id, quantity: 90, unitPrice: 1, lineTotal: 90 }] },
      },
    });
    const preview = await reorder.autoFill(orgId, { salesDays: 30, coverDays: 14 }, branchA);
    expect(preview.lines.find((l) => l.productId === p.id)).toMatchObject({ sold: 90, current: null, proposed: 42 });
    expect(await prisma.productReorderSetting.count({ where: { productId: p.id } })).toBe(0);

    await reorder.autoFill(orgId, { salesDays: 30, coverDays: 14, apply: true }, branchA);
    const setting = await prisma.productReorderSetting.findUniqueOrThrow({
      where: { productId_branchId: { productId: p.id, branchId: branchA } },
    });
    expect(Number(setting.reorderPoint)).toBe(42);
    // Branch B sold none of it.
    const b = await reorder.autoFill(orgId, { salesDays: 30, coverDays: 14 }, branchB);
    expect(b.lines.some((l) => l.productId === p.id)).toBe(false);
  });

  it('imports the spreadsheet all-or-nothing, matched by SKU', async () => {
    const p = await product();
    const q = await product({ reorderPoint: 7 });

    const bad = await reorder.importRows(orgId, {
      rows: [
        { sku: p.sku, reorderPoint: 12, reorderQuantity: 30, supplier: 'pt pemasok' },
        { sku: 'NOPE', reorderPoint: 1 },
      ],
    });
    expect(bad).toMatchObject({ updated: 0, errorCount: 1 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).reorderPoint).toBeNull();

    const ok = await reorder.importRows(orgId, {
      rows: [
        { sku: p.sku, reorderPoint: 12, reorderQuantity: 30, supplier: 'pt pemasok' },
        { sku: q.sku, reorderPoint: null },
      ],
    });
    expect(ok).toMatchObject({ updated: 2, errorCount: 0 });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(Number(after.reorderPoint)).toBe(12);
    expect(Number(after.reorderQuantity)).toBe(30);
    expect(after.preferredSupplierId).toBe(supplierId);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: q.id } })).reorderPoint).toBeNull();

    // The same file again changes nothing.
    const again = await reorder.importRows(orgId, {
      rows: [{ sku: p.sku, reorderPoint: 12, reorderQuantity: 30, supplier: 'PT Pemasok' }],
    });
    expect(again).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it('treats a single-branch business as business-wide', async () => {
    const solo = (await prisma.organization.create({ data: { name: `Solo ${randomUUID()}` } })).id;
    const only = (await prisma.branch.create({ data: { organizationId: solo, name: 'Only' } })).id;
    expect(await reorder.branchFor(solo, only)).toBeNull();
    expect(await reorder.branchFor(orgId, branchA)).toBe(branchA);
  });
});
