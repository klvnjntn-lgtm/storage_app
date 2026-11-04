import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ExpenseStatus, JournalEntryStatus, JournalSourceType, PaymentMethod, SalesQuotationStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingModule } from './accounting.module';
import { ChartOfAccountsSeedService } from './chart-of-accounts-seed.service';
import { ExpensesModule } from './expenses.module';
import { ExpensesService } from './expenses.service';
import { FixedAssetsModule } from './fixed-assets.module';
import { FixedAssetsService } from './fixed-assets.service';
import { SalesQuotationModule } from '../sales-quotation/sales-quotation.module';
import { SalesQuotationService } from '../sales-quotation/sales-quotation.service';
import { SupplierPaymentsModule } from './supplier-payments.module';
import { SupplierPaymentsService } from './supplier-payments.service';
import { SupplierBillModule } from '../supplier-bill/supplier-bill.module';
import { SupplierBillService } from '../supplier-bill/supplier-bill.service';

// Quotation PDFs need puppeteer (ESM-only), which these tests never use.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Runs against the isolated test DB (see test/setup-test-env.ts) in a fresh org.
describe('Expenses, fixed assets and quotations (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let expenses: ExpensesService;
  let assets: FixedAssetsService;
  let quotations: SalesQuotationService;
  let supplierPayments: SupplierPaymentsService;
  let bills: SupplierBillService;

  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AccountingModule,
        ExpensesModule,
        FixedAssetsModule,
        SalesQuotationModule,
        SupplierPaymentsModule,
        SupplierBillModule,
      ],
    }).compile();
    prisma = module.get(PrismaService);
    expenses = module.get(ExpensesService);
    assets = module.get(FixedAssetsService);
    quotations = module.get(SalesQuotationService);
    supplierPayments = module.get(SupplierPaymentsService);
    bills = module.get(SupplierBillService);

    orgId = (await prisma.organization.create({ data: { name: `Misc ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    userId = (
      await prisma.user.create({
        data: { email: `misc-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const isoDay = (d: Date | null) => d?.toISOString().slice(0, 10);

  it('depreciates an asset bought on the 31st once a month, keeping month ends', async () => {
    const asset = await prisma.fixedAsset.create({
      data: { organizationId: orgId, name: 'Van', acquisitionDate: day('2026-01-31'), cost: 12_000, usefulLifeMonths: 12 },
    });

    await assets.runDepreciation(orgId, day('2026-02-28'));
    let a = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(Number(a.accumulatedDepreciation)).toBe(1_000);
    expect(isoDay(a.lastDepreciatedThrough)).toBe('2026-02-28');

    await assets.runDepreciation(orgId, day('2026-03-31'));
    a = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(Number(a.accumulatedDepreciation)).toBe(2_000);
    expect(isoDay(a.lastDepreciatedThrough)).toBe('2026-03-31');
  });

  it('carries on correctly from a schedule that drifted under the old month arithmetic', async () => {
    // One month taken, recorded through Mar 3 (Jan 31 + 1 month, overflowed).
    const asset = await prisma.fixedAsset.create({
      data: {
        organizationId: orgId,
        name: 'Drill',
        acquisitionDate: day('2026-01-31'),
        cost: 1_200,
        usefulLifeMonths: 12,
        accumulatedDepreciation: 100,
        lastDepreciatedThrough: day('2026-03-03'),
      },
    });
    await assets.runDepreciation(orgId, day('2026-03-31'));
    const a = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(Number(a.accumulatedDepreciation)).toBe(200);
    expect(isoDay(a.lastDepreciatedThrough)).toBe('2026-03-31');
  });

  it('voids an expense payment entered by mistake', async () => {
    const category = await prisma.expenseCategory.create({ data: { organizationId: orgId, name: 'Rent' } });
    const expense = await expenses.create(orgId, {
      categoryId: category.id,
      amount: 500_000,
      expenseDate: '2026-11-01',
    } as any);
    const paid = await expenses.recordPayment(orgId, expense.id, { amount: 500_000, method: PaymentMethod.CASH } as any, userId);
    expect(paid.status).toBe(ExpenseStatus.PAID);

    const after = await expenses.voidPayment(orgId, expense.id, paid.payments[0].id, userId, 'Typed twice');
    expect(after.status).toBe(ExpenseStatus.UNPAID);
    expect(after.amountPaid).toBe(0);
    expect(after.payments).toHaveLength(0);
    const entry = await prisma.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.EXPENSE, sourceId: paid.payments[0].id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entry?.status).toBe(JournalEntryStatus.VOID);

    // Back to unpaid, it can now be voided as a whole.
    await expenses.voidUnpaid(orgId, expense.id, userId, 'Not ours');
    expect(await prisma.expense.findUnique({ where: { id: expense.id } })).toBeNull();
  });

  it('lets only one of two status changes made at the same moment win', async () => {
    const q = await prisma.salesQuotation.create({ data: { organizationId: orgId, status: SalesQuotationStatus.SENT } });
    const results = await Promise.allSettled([
      // Both only allowed from SENT, so exactly one may win.
      quotations.accept(orgId, q.id, userId),
      quotations.reject(orgId, q.id, userId, 'Too expensive'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const final = await prisma.salesQuotation.findUniqueOrThrow({ where: { id: q.id } });
    const winner = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ status: string }>).value;
    expect(final.status).toBe(winner.status);
  });

  const newPo = async () => {
    const supplier = await prisma.supplier.create({ data: { organizationId: orgId, name: `Sup ${randomUUID().slice(0, 6)}` } });
    const po = await prisma.purchaseOrder.create({
      data: { organizationId: orgId, supplierId: supplier.id, status: 'SENT', subtotal: 1_000, total: 1_000 } as any,
    });
    return { po, supplier };
  };

  it('voids a supplier payment without deleting it, once', async () => {
    const { po, supplier } = await newPo();
    // Imported bill: what's owed on a PO with no goods receipts.
    await prisma.supplierBill.create({
      data: { organizationId: orgId, purchaseOrderId: po.id, supplierId: supplier.id, billNumber: 'B1', billDate: day('2026-11-01'), amount: 1_000, externalId: `t-${randomUUID()}` },
    });
    const payment = await supplierPayments.create(orgId, userId, { purchaseOrderId: po.id, amount: 400, method: PaymentMethod.CASH } as any);
    expect(await supplierPayments.getOutstanding(orgId, po.id)).toBe(600);

    const voided = await supplierPayments.void(orgId, payment.id, userId, 'Wrong PO');
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.voidReason).toBe('Wrong PO');
    expect(await supplierPayments.getOutstanding(orgId, po.id)).toBe(1_000);
    expect(await supplierPayments.list(orgId, po.id)).toHaveLength(0);
    const entry = await prisma.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: JournalSourceType.SUPPLIER_PAYMENT, sourceId: payment.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entry?.status).toBe(JournalEntryStatus.VOID);

    await expect(supplierPayments.void(orgId, payment.id, userId)).rejects.toThrow('Supplier payment not found');
  });

  it('finds a bill matching a status filter beyond the newest 500 bills', async () => {
    const { po: overBilled, supplier } = await newPo();
    await prisma.supplierBill.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        organizationId: orgId,
        purchaseOrderId: overBilled.id,
        supplierId: supplier.id,
        billNumber: `N-${i}`,
        billDate: day('2026-10-01'),
        amount: 10,
      })),
    });
    const { po: matched } = await newPo();
    const old = await prisma.supplierBill.create({
      data: { organizationId: orgId, purchaseOrderId: matched.id, billNumber: 'OLD', billDate: day('2020-01-01'), amount: 1_000, externalId: `t-${randomUUID()}` },
    });

    const rows = await bills.list(orgId, { status: 'MATCHED' });
    expect(rows.some((r) => r.id === old.id)).toBe(true);
  });
});
