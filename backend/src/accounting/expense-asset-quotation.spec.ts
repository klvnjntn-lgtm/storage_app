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

// Quotation PDFs need puppeteer (ESM-only), which these tests never use.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Runs against the isolated test DB (see test/setup-test-env.ts) in a fresh org.
describe('Expenses, fixed assets and quotations (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let expenses: ExpensesService;
  let assets: FixedAssetsService;
  let quotations: SalesQuotationService;

  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, AccountingModule, ExpensesModule, FixedAssetsModule, SalesQuotationModule],
    }).compile();
    prisma = module.get(PrismaService);
    expenses = module.get(ExpensesService);
    assets = module.get(FixedAssetsService);
    quotations = module.get(SalesQuotationService);

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
});
