import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingModule } from '../accounting/accounting.module';
import { JournalService } from '../accounting/journal.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { BudgetModule } from './budget.module';
import { BudgetService } from './budget.service';

describe('Budgets', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let service: BudgetService;
  let journal: JournalService;
  let orgId: string;
  let branchA: string;
  let revenue: string;
  let expense: string;
  let cash: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, AccountingModule, BudgetModule] }).compile();
    prisma = module.get(PrismaService);
    service = module.get(BudgetService);
    journal = module.get(JournalService);
    orgId = (await prisma.organization.create({ data: { name: `Budget ${randomUUID()}` } })).id;
    branchA = (await prisma.branch.create({ data: { organizationId: orgId, name: 'Pusat' } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    const key = async (systemKey: 'SALES_REVENUE' | 'UNCATEGORIZED_EXPENSE' | 'CASH') =>
      (await prisma.chartOfAccount.findFirstOrThrow({ where: { organizationId: orgId, systemKey } })).id;
    revenue = await key('SALES_REVENUE');
    expense = await key('UNCATEGORIZED_EXPENSE');
    cash = await key('CASH');
  });

  afterAll(async () => {
    await module?.close();
  });

  const year = (y: number) => Array.from({ length: 12 }, (_, i) => (i === 2 ? y : 0));
  const row = (r: Awaited<ReturnType<BudgetService['get']>>, id: string) => r.accounts.find((a) => a.id === id)!;

  it('offers only revenue and expense accounts', async () => {
    const r = await service.get(orgId, 2026);
    expect(r.accounts.every((a) => a.type === 'REVENUE' || a.type === 'EXPENSE')).toBe(true);
    expect(r.accounts.length).toBeGreaterThan(0);
  });

  it('keeps the whole business and each branch as separate budgets, and replaces on save', async () => {
    await service.save(orgId, 2026, undefined, [{ accountId: revenue, budget: year(1_000) }]);
    await service.save(orgId, 2026, branchA, [{ accountId: revenue, budget: year(400) }]);
    expect(row(await service.get(orgId, 2026), revenue).budget[2]).toBe(1_000);
    expect(row(await service.get(orgId, 2026, branchA), revenue).budget[2]).toBe(400);

    const cleared = await service.save(orgId, 2026, branchA, [{ accountId: revenue, budget: year(0) }]);
    expect(row(cleared, revenue).budget.every((v) => v === 0)).toBe(true);
    expect(await prisma.accountBudget.count({ where: { organizationId: orgId, scope: branchA } })).toBe(0);
  });

  it('reads actuals from posted entries, with the right sign, per month and branch', async () => {
    const posted = await journal.postEntry(orgId, {
      date: new Date('2026-03-10T00:00:00Z'),
      sourceType: 'MANUAL',
      lines: [
        { accountId: cash, debit: 700 },
        { accountId: revenue, credit: 700, branchId: branchA },
      ],
    });
    await journal.postEntry(orgId, {
      date: new Date('2026-03-11T00:00:00Z'),
      sourceType: 'MANUAL',
      lines: [
        { accountId: expense, debit: 200 },
        { accountId: cash, credit: 200 },
      ],
    });
    const whole = await service.get(orgId, 2026);
    expect(row(whole, revenue).actual[2]).toBe(700);
    expect(row(whole, expense).actual[2]).toBe(200);

    const branch = await service.get(orgId, 2026, branchA);
    expect(row(branch, revenue).actual[2]).toBe(700);
    expect(row(branch, expense).actual[2]).toBe(0);

    await journal.voidEntry(orgId, posted!.id, undefined, 'test');
    const after = await service.get(orgId, 2026);
    expect(row(after, revenue).actual[2]).toBe(0);
  });

  it('refuses bad input', async () => {
    await expect(service.save(orgId, 2026, undefined, [{ accountId: cash, budget: year(1) }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save(orgId, 2026, undefined, [{ accountId: revenue, budget: [1] }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save(orgId, 2026, undefined, [{ accountId: revenue, budget: year(-5) }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.get(orgId, 1)).rejects.toBeInstanceOf(BadRequestException);
    const other = await prisma.organization.create({ data: { name: `Other ${randomUUID()}` } });
    const foreign = await prisma.branch.create({ data: { organizationId: other.id, name: 'Lain' } });
    await expect(service.get(orgId, 2026, foreign.id)).rejects.toBeInstanceOf(BadRequestException);
  });
});
