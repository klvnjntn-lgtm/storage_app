import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingModule } from '../accounting/accounting.module';
import { JournalService } from '../accounting/journal.service';
import { BankAccountGLLinkService } from '../accounting/bank-account-gl-link.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { BankReconciliationModule } from './bank-reconciliation.module';
import { BankReconciliationService } from './bank-reconciliation.service';

describe('Bank reconciliation', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let service: BankReconciliationService;
  let journal: JournalService;
  let orgId: string;
  let bankId: string;
  let bankLedger: string;
  let revenue: string;
  let expense: string;
  let receivable: string;

  const FROM = '2026-03-01';
  const TO = '2026-03-31';

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, AccountingModule, BankReconciliationModule] }).compile();
    prisma = module.get(PrismaService);
    service = module.get(BankReconciliationService);
    journal = module.get(JournalService);
    orgId = (await prisma.organization.create({ data: { name: `Rekon ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    const bank = await prisma.organizationBankAccount.create({
      data: { organizationId: orgId, bankName: 'BCA', accountNumber: '1234567', accountName: 'PT Uji' },
    });
    bankId = bank.id;
    bankLedger = (await module.get(BankAccountGLLinkService).ensureLinkedAccount(orgId, bank)).id;
    const key = async (systemKey: 'SALES_REVENUE' | 'UNCATEGORIZED_EXPENSE' | 'ACCOUNTS_RECEIVABLE') =>
      (await prisma.chartOfAccount.findFirstOrThrow({ where: { organizationId: orgId, systemKey } })).id;
    revenue = await key('SALES_REVENUE');
    expense = await key('UNCATEGORIZED_EXPENSE');
    receivable = await key('ACCOUNTS_RECEIVABLE');
  });

  afterAll(async () => {
    await module?.close();
  });

  const bookIn = (date: string, amount: number) =>
    journal.postEntry(orgId, {
      date: new Date(`${date}T00:00:00Z`),
      sourceType: 'MANUAL',
      memo: `in ${amount}`,
      lines: [{ accountId: bankLedger, debit: amount }, { accountId: receivable, credit: amount }],
    });
  const stmt = (date: string, amount: number, description = 'TRSF', seq = 0, balance?: number) => ({ date, amount, description, seq, balance });
  const view = () => service.report(orgId, bankId, FROM, TO);

  it('imports lines, keeps real repeats, and skips what it already has', async () => {
    const first = await service.importLines(orgId, bankId, 'a.csv', [
      stmt('2026-03-02', -5_000, 'BIAYA ADM', 0),
      stmt('2026-03-02', -5_000, 'BIAYA ADM', 1),
    ]);
    expect(first).toEqual({ imported: 2, duplicates: 0 });
    const again = await service.importLines(orgId, bankId, 'a.csv', [stmt('2026-03-02', -5_000, 'biaya  adm', 0)]);
    expect(again).toEqual({ imported: 0, duplicates: 1 });
    expect((await view()).lines).toHaveLength(2);
  });

  it('auto-matches the unambiguous within a few days, and leaves the rest', async () => {
    await bookIn('2026-03-09', 100_000);
    await service.importLines(orgId, bankId, null as never, [stmt('2026-03-10', 100_000, 'TRSF A')]);
    // Two identical ledger lines: only the user can say which.
    await bookIn('2026-03-12', 70_000);
    await bookIn('2026-03-12', 70_000);
    await service.importLines(orgId, bankId, null as never, [stmt('2026-03-13', 70_000, 'TRSF B')]);
    // Too far apart.
    await bookIn('2026-03-01', 33_000);
    await service.importLines(orgId, bankId, null as never, [stmt('2026-03-20', 33_000, 'TRSF C')]);

    expect(await service.autoMatch(orgId, bankId, FROM, TO)).toEqual({ matched: 1 });
    const r = await view();
    const line = (d: string) => r.lines.find((l) => l.description === d)!;
    expect(line('TRSF A').status).toBe('MATCHED');
    expect(line('TRSF B').status).toBe('UNMATCHED');
    expect(line('TRSF C').status).toBe('UNMATCHED');
    expect(line('TRSF A').matches[0].amount).toBe(100_000);
  });

  it('matches several ledger lines to one bank line only when the amounts add up', async () => {
    const a = await bookIn('2026-03-14', 10_000);
    const b = await bookIn('2026-03-14', 15_000);
    await service.importLines(orgId, bankId, undefined, [stmt('2026-03-15', 25_000, 'GABUNGAN')]);
    const r = await view();
    const line = r.lines.find((l) => l.description === 'GABUNGAN')!;
    const ids = r.bookLines.filter((l) => l.entryId === a!.id || l.entryId === b!.id).map((l) => l.id);
    await expect(service.match(orgId, line.id, [ids[0]])).rejects.toBeInstanceOf(BadRequestException);
    await service.match(orgId, line.id, ids);
    await expect(service.match(orgId, line.id, ids)).rejects.toBeInstanceOf(BadRequestException);

    const after = await view();
    expect(after.lines.find((l) => l.id === line.id)!.status).toBe('MATCHED');
    expect(after.bookLines.some((l) => ids.includes(l.id))).toBe(false);

    await service.unmatch(orgId, line.id);
    const undone = await view();
    expect(undone.lines.find((l) => l.id === line.id)!.status).toBe('UNMATCHED');
    expect(undone.bookLines.filter((l) => ids.includes(l.id))).toHaveLength(2);
    await service.match(orgId, line.id, ids);
  });

  it('books a bank fee and ticks it off, on the right side', async () => {
    const line = (await view()).lines.find((l) => l.description === 'BIAYA ADM')!;
    await service.record(orgId, line.id, expense, 'Biaya bank');
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: orgId, memo: 'Biaya bank' },
      include: { lines: true },
    });
    expect(Number(entry.lines.find((l) => l.accountId === expense)!.debit)).toBe(5_000);
    expect(Number(entry.lines.find((l) => l.accountId === bankLedger)!.credit)).toBe(5_000);
    expect((await view()).lines.find((l) => l.id === line.id)!.status).toBe('MATCHED');
    const other = (await view()).lines.find((l) => l.description === 'BIAYA ADM' && l.status === 'UNMATCHED')!;
    await expect(service.record(orgId, other.id, bankLedger, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.record(orgId, other.id, receivable, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reopens a bank line when its ledger entry is later voided', async () => {
    const entry = await bookIn('2026-03-22', 44_000);
    await service.importLines(orgId, bankId, undefined, [stmt('2026-03-22', 44_000, 'VOIDED LATER')]);
    await service.autoMatch(orgId, bankId, FROM, TO);
    expect((await view()).lines.find((l) => l.description === 'VOIDED LATER')!.status).toBe('MATCHED');
    await journal.voidEntry(orgId, entry!.id, undefined, 'mistake');
    const r = await view();
    expect(r.lines.find((l) => l.description === 'VOIDED LATER')!.status).toBe('UNMATCHED');
    expect(r.lines.find((l) => l.description === 'VOIDED LATER')!.matches).toEqual([]);
  });

  it('ignores a line, and the summary balances the bank against the books', async () => {
    await service.importLines(orgId, bankId, undefined, [stmt('2026-03-25', -1, 'SALAH', 0, 999)]);
    const line = (await view()).lines.find((l) => l.description === 'SALAH')!;
    await service.setIgnored(orgId, line.id, true);
    const r = await view();
    const open = r.lines.filter((l) => l.status === 'UNMATCHED').reduce((s, l) => s + l.amount, 0);
    const openBook = r.bookLines.filter((l) => l.inPeriod).reduce((s, l) => s + l.amount, 0);
    expect(r.summary.unmatchedStatement).toBe(open);
    expect(r.summary.unmatchedBook).toBe(openBook);
    expect(r.summary.expectedStatementBalance).toBe(r.summary.bookBalance + open - openBook);
    expect(r.summary.ignored).toBe(1);
    expect(r.summary.lastStatementBalance).toBe(999);
  });

  it('clears only lines that are not matched, and stays inside the org', async () => {
    const before = (await view()).lines.filter((l) => l.status === 'MATCHED').length;
    await service.clearOpen(orgId, bankId, FROM, TO);
    const r = await view();
    expect(r.lines.every((l) => l.status === 'MATCHED')).toBe(true);
    expect(r.lines).toHaveLength(before);
    const other = await prisma.organization.create({ data: { name: `Other ${randomUUID()}` } });
    await expect(service.report(other.id, bankId, FROM, TO)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.unmatch(other.id, r.lines[0].id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
