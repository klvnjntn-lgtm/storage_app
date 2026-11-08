import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AccountType,
  AmortizationKind,
  AmortizationStatus,
  JournalEntryStatus,
  JournalSourceType,
  NormalBalance,
  PaymentMethod,
  SystemAccountKey,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingModule } from './accounting.module';
import { ChartOfAccountsSeedService } from './chart-of-accounts-seed.service';
import { AmortizationsModule } from './amortizations.module';
import { AmortizationsService } from './amortizations.service';

jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// Runs against the isolated test DB (see test/setup-test-env.ts) in a fresh org.
describe('Amortisasi (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let service: AmortizationsService;
  let orgId: string;
  let userId: string;
  let rentAccountId: string;

  // A posted ledger balance, signed the way the account counts it.
  async function balance(accountId: string) {
    const account = await prisma.chartOfAccount.findUniqueOrThrow({ where: { id: accountId } });
    const sum = await prisma.journalEntryLine.aggregate({
      where: { accountId, journalEntry: { organizationId: orgId, status: JournalEntryStatus.POSTED } },
      _sum: { debit: true, credit: true },
    });
    const dr = Number(sum._sum.debit ?? 0);
    const cr = Number(sum._sum.credit ?? 0);
    return Math.round((account.normalBalance === NormalBalance.DEBIT ? dr - cr : cr - dr) * 100) / 100;
  }
  async function system(key: SystemAccountKey) {
    return (await prisma.chartOfAccount.findFirstOrThrow({ where: { organizationId: orgId, systemKey: key } })).id;
  }

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, AccountingModule, AmortizationsModule] }).compile();
    prisma = module.get(PrismaService);
    service = module.get(AmortizationsService);
    orgId = (await prisma.organization.create({ data: { name: `Amortisasi ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    userId = (
      await prisma.user.create({
        data: { email: `amort-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    rentAccountId = (
      await prisma.chartOfAccount.create({
        data: { organizationId: orgId, code: '5200', name: 'Beban Sewa', type: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT },
      })
    ).id;
  });

  afterAll(async () => {
    await module.close();
  });

  it('a prepaid rent: recorded, paid, then expensed one month at a time into the chosen account', async () => {
    const rent = await service.create(
      orgId,
      {
        kind: AmortizationKind.PREPAID,
        name: 'Sewa gudang 2026',
        startDate: '2026-01-01',
        cost: 12_000_000,
        usefulLifeMonths: 12,
        expenseAccountId: rentAccountId,
        payment: { amount: 12_000_000, method: PaymentMethod.CASH, paidAt: '2026-01-01' },
      },
      userId,
    );
    expect(rent.amountPaid).toBe(12_000_000);
    expect(rent.schedule).toHaveLength(12);
    expect(await balance(await system(SystemAccountKey.PREPAID_EXPENSES))).toBe(12_000_000);
    expect(await balance(await system(SystemAccountKey.EXPENSE_PAYABLE))).toBe(0);
    expect(await balance(await system(SystemAccountKey.CASH))).toBe(-12_000_000);

    const run = await service.runAmortization(orgId, d('2026-04-15'));
    expect(run.entries.find((e) => e.id === rent.id)).toMatchObject({ months: 3, amount: 3_000_000 });

    // One entry per month, each dated on its own month.
    const entries = await prisma.journalEntry.findMany({
      where: { organizationId: orgId, sourceType: JournalSourceType.AMORTIZATION, sourceId: { startsWith: `${rent.id}:month:` } },
      orderBy: { entryDate: 'asc' },
    });
    expect(entries.map((e) => e.entryDate.toISOString().slice(0, 10))).toEqual(['2026-02-01', '2026-03-01', '2026-04-01']);
    expect(await balance(rentAccountId)).toBe(3_000_000);
    expect(await balance(await system(SystemAccountKey.PREPAID_EXPENSES))).toBe(9_000_000);

    // Running again for the same date posts nothing more.
    const again = await service.runAmortization(orgId, d('2026-04-15'));
    expect(again.entries.find((e) => e.id === rent.id)).toBeUndefined();
    expect(await balance(rentAccountId)).toBe(3_000_000);

    const after = await service.get(orgId, rent.id);
    expect(after).toMatchObject({ monthsDone: 3, accumulatedAmortization: 3_000_000, bookValue: 9_000_000 });
    expect(after.nextChargeDate?.toISOString().slice(0, 10)).toBe('2026-05-01');
  });

  it('an intangible: the last month takes the rounding, and it completes at exactly its cost', async () => {
    const licence = await service.create(
      orgId,
      { kind: AmortizationKind.INTANGIBLE, name: 'Lisensi software', startDate: '2026-01-31', cost: 1_000_000, usefulLifeMonths: 3 },
      userId,
    );
    expect(licence.schedule.map((r) => r.amount)).toEqual([333_333.33, 333_333.33, 333_333.34]);
    expect(licence.balanceDue).toBe(1_000_000);

    await service.runAmortization(orgId, d('2026-12-31'));
    const done = await service.get(orgId, licence.id);
    expect(done.status).toBe(AmortizationStatus.COMPLETED);
    expect(done.accumulatedAmortization).toBe(1_000_000);
    expect(done.nextChargeDate).toBeNull();
    expect(await balance(await system(SystemAccountKey.AMORTIZATION_EXPENSE))).toBe(1_000_000);
    // Credit-normal (a contra-asset), so it reads as a positive balance.
    expect(await balance(await system(SystemAccountKey.ACCUMULATED_AMORTIZATION))).toBe(1_000_000);
  });

  it('writing off an intangible expenses the rest and takes it off the balance sheet', async () => {
    const intangible = await system(SystemAccountKey.INTANGIBLE_ASSETS);
    const accumulated = await system(SystemAccountKey.ACCUMULATED_AMORTIZATION);
    const expense = await system(SystemAccountKey.AMORTIZATION_EXPENSE);
    const [intangibleBefore, accumulatedBefore, expenseBefore] = await Promise.all([
      balance(intangible),
      balance(accumulated),
      balance(expense),
    ]);

    const brand = await service.create(
      orgId,
      { kind: AmortizationKind.INTANGIBLE, name: 'Merek dagang', startDate: '2026-01-01', cost: 1_200_000, usefulLifeMonths: 12 },
      userId,
    );
    await service.runAmortization(orgId, d('2026-03-01'));
    expect((await service.get(orgId, brand.id)).accumulatedAmortization).toBe(200_000);

    const written = await service.writeOff(orgId, brand.id, d('2026-03-10'));
    expect(written.status).toBe(AmortizationStatus.WRITTEN_OFF);
    expect(await balance(intangible)).toBe(intangibleBefore);
    expect(await balance(accumulated)).toBe(accumulatedBefore);
    expect(await balance(expense)).toBe(expenseBefore + 1_200_000);

    // A written-off item is left out of later runs.
    const later = await service.runAmortization(orgId, d('2026-12-31'));
    expect(later.entries.find((e) => e.id === brand.id)).toBeUndefined();
  });

  it('pays in installments, never more than the cost', async () => {
    const insurance = await service.create(
      orgId,
      {
        kind: AmortizationKind.PREPAID,
        name: 'Asuransi kendaraan',
        startDate: '2026-06-01',
        cost: 600_000,
        usefulLifeMonths: 6,
        expenseAccountId: rentAccountId,
      },
      userId,
    );
    await service.recordPayment(orgId, insurance.id, { amount: 400_000, method: PaymentMethod.CASH, paidAt: '2026-06-01' }, userId);
    await expect(
      service.recordPayment(orgId, insurance.id, { amount: 300_000, method: PaymentMethod.CASH, paidAt: '2026-06-02' }, userId),
    ).rejects.toThrow(/exceeds the balance due/);
    const paid = await service.recordPayment(orgId, insurance.id, { amount: 200_000, method: PaymentMethod.CASH, paidAt: '2026-06-02' }, userId);
    expect(paid.balanceDue).toBe(0);
    expect(paid.payments).toHaveLength(2);
  });

  it('refuses a prepaid expense without an expense account, or one that is not an expense', async () => {
    await expect(
      service.create(orgId, { kind: AmortizationKind.PREPAID, name: 'X', startDate: '2026-01-01', cost: 100, usefulLifeMonths: 2 }, userId),
    ).rejects.toThrow(/expense account/);
    const cash = await system(SystemAccountKey.CASH);
    await expect(
      service.create(
        orgId,
        { kind: AmortizationKind.PREPAID, name: 'X', startDate: '2026-01-01', cost: 100, usefulLifeMonths: 2, expenseAccountId: cash },
        userId,
      ),
    ).rejects.toThrow(/not an expense account/);
  });

  it('deletes only before anything happened to it, voiding its entry', async () => {
    const fresh = await service.create(
      orgId,
      { kind: AmortizationKind.INTANGIBLE, name: 'Batal', startDate: '2027-01-01', cost: 500_000, usefulLifeMonths: 5 },
      userId,
    );
    const intangible = await system(SystemAccountKey.INTANGIBLE_ASSETS);
    const before = await balance(intangible);
    await service.remove(orgId, fresh.id, userId, 'test');
    expect(await balance(intangible)).toBe(before - 500_000);
    await expect(service.get(orgId, fresh.id)).rejects.toThrow(/not found/);

    const paidOne = await service.create(
      orgId,
      {
        kind: AmortizationKind.INTANGIBLE,
        name: 'Sudah dibayar',
        startDate: '2027-01-01',
        cost: 500_000,
        usefulLifeMonths: 5,
        payment: { amount: 100_000, method: PaymentMethod.CASH },
      },
      userId,
    );
    await expect(service.remove(orgId, paidOne.id, userId)).rejects.toThrow(/written off/);
  });
});
