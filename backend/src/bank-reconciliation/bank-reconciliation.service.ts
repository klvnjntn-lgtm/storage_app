import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { AccountType, BankStatementLineStatus, JournalEntryStatus, JournalSourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { parseDateOnly } from '../accounting/business-date';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 0.005;
const DAY_MS = 24 * 60 * 60 * 1000;
// A payment and its bank line are rarely on the same day across a weekend.
const AUTO_MATCH_DAYS = 3;
// Ledger lines this close to the period are offered too: they may clear in it.
const CANDIDATE_DAYS = 7;

export type StatementLineInput = {
  date: string;
  description: string;
  amount: number;
  balance?: number | null;
  // nth identical line in the file: two real Rp 5.000 fees on one day are both
  // kept, while re-importing the same file adds neither again.
  seq: number;
};

@Injectable()
export class BankReconciliationService {
  constructor(
    private prisma: PrismaService,
    private journal: JournalService,
  ) {}

  private async glAccountOf(organizationId: string, bankAccountId: string) {
    const bank = await this.prisma.organizationBankAccount.findFirst({
      where: { id: bankAccountId, organizationId },
      select: { id: true, bankName: true, accountNumber: true },
    });
    if (!bank) throw new NotFoundException('Bank account not found');
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { organizationId, bankAccountId },
      select: { id: true, code: true, name: true },
    });
    if (!account) throw new BadRequestException('This bank account has no linked ledger account');
    return { bank, account };
  }

  private async lineOrThrow(organizationId: string, id: string) {
    const line = await this.prisma.bankStatementLine.findFirst({ where: { id, organizationId } });
    if (!line) throw new NotFoundException('Statement line not found');
    return line;
  }

  async importLines(organizationId: string, bankAccountId: string, fileName: string | undefined, lines: StatementLineInput[], userId?: string) {
    await this.glAccountOf(organizationId, bankAccountId);
    const rows = lines.map((l) => {
      const description = l.description.trim().replace(/\s+/g, ' ');
      if (!l.amount || !Number.isFinite(l.amount)) throw new BadRequestException('A statement line needs an amount');
      const amount = round2(l.amount);
      return {
        organizationId,
        bankAccountId,
        date: parseDateOnly(l.date, 'date'),
        description,
        amount,
        balance: l.balance ?? null,
        dedupeKey: createHash('sha256').update(`${l.date}|${amount}|${description.toLowerCase()}|${l.seq}`).digest('hex'),
        fileName: fileName ?? null,
        createdById: userId ?? null,
      };
    });
    const { count } = await this.prisma.bankStatementLine.createMany({ data: rows, skipDuplicates: true });
    return { imported: count, duplicates: rows.length - count };
  }

  // A matched ledger entry can be voided later through its own document. The
  // money was never really booked then, so the bank line goes back to open.
  private async releaseVoided(organizationId: string, bankAccountId: string) {
    const stale = await this.prisma.bankReconciliationMatch.findMany({
      where: {
        statementLine: { organizationId, bankAccountId },
        journalEntryLine: { journalEntry: { status: { not: JournalEntryStatus.POSTED } } },
      },
      select: { id: true, statementLineId: true },
    });
    if (stale.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.bankReconciliationMatch.deleteMany({ where: { id: { in: stale.map((m) => m.id) } } });
      await tx.bankStatementLine.updateMany({
        where: { id: { in: stale.map((m) => m.statementLineId) } },
        data: { status: BankStatementLineStatus.UNMATCHED },
      });
    });
  }

  private openBookLines(organizationId: string, accountId: string, from: Date, to: Date) {
    return this.prisma.journalEntryLine.findMany({
      where: {
        accountId,
        reconciliation: null,
        journalEntry: { organizationId, status: JournalEntryStatus.POSTED, entryDate: { gte: from, lte: to } },
      },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { id: 'asc' }],
      select: {
        id: true,
        debit: true,
        credit: true,
        description: true,
        journalEntry: { select: { id: true, entryNumber: true, entryDate: true, memo: true, sourceType: true } },
      },
    });
  }

  async report(organizationId: string, bankAccountId: string, fromValue: string, toValue: string) {
    const { bank, account } = await this.glAccountOf(organizationId, bankAccountId);
    const from = parseDateOnly(fromValue, 'from');
    const to = parseDateOnly(toValue, 'to');
    if (from > to) throw new BadRequestException('from must be on or before to');
    await this.releaseVoided(organizationId, bankAccountId);

    const lines = await this.prisma.bankStatementLine.findMany({
      where: { organizationId, bankAccountId, date: { gte: from, lte: to } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      include: {
        matches: {
          select: {
            journalEntryLine: {
              select: {
                id: true,
                debit: true,
                credit: true,
                journalEntry: { select: { id: true, entryNumber: true, entryDate: true, memo: true } },
              },
            },
          },
        },
      },
    });
    const candidates = await this.openBookLines(
      organizationId,
      account.id,
      new Date(from.getTime() - CANDIDATE_DAYS * DAY_MS),
      new Date(to.getTime() + CANDIDATE_DAYS * DAY_MS),
    );
    const bookLines = candidates.map((l) => ({
      id: l.id,
      entryId: l.journalEntry.id,
      entryNumber: l.journalEntry.entryNumber,
      date: l.journalEntry.entryDate.toISOString().slice(0, 10),
      memo: l.journalEntry.memo ?? l.description,
      sourceType: l.journalEntry.sourceType,
      amount: round2(Number(l.debit) - Number(l.credit)),
      inPeriod: l.journalEntry.entryDate >= from && l.journalEntry.entryDate <= to,
    }));

    const booked = await this.prisma.journalEntryLine.aggregate({
      where: {
        accountId: account.id,
        journalEntry: { organizationId, status: JournalEntryStatus.POSTED, entryDate: { lte: to } },
      },
      _sum: { debit: true, credit: true },
    });
    const bookBalance = round2(Number(booked._sum.debit ?? 0) - Number(booked._sum.credit ?? 0));
    const open = lines.filter((l) => l.status === BankStatementLineStatus.UNMATCHED);
    const openBook = bookLines.filter((l) => l.inPeriod);
    const unmatchedStatement = round2(open.reduce((s, l) => s + Number(l.amount), 0));
    const unmatchedBook = round2(openBook.reduce((s, l) => s + l.amount, 0));
    const lastBalance = [...lines].reverse().find((l) => l.balance != null)?.balance;

    return {
      bankAccount: bank,
      ledgerAccount: account,
      from: fromValue,
      to: toValue,
      lines: lines.map((l) => ({
        id: l.id,
        date: l.date.toISOString().slice(0, 10),
        description: l.description,
        amount: Number(l.amount),
        balance: l.balance == null ? null : Number(l.balance),
        status: l.status,
        matches: l.matches.map((m) => ({
          id: m.journalEntryLine.id,
          entryId: m.journalEntryLine.journalEntry.id,
          entryNumber: m.journalEntryLine.journalEntry.entryNumber,
          date: m.journalEntryLine.journalEntry.entryDate.toISOString().slice(0, 10),
          memo: m.journalEntryLine.journalEntry.memo,
          amount: round2(Number(m.journalEntryLine.debit) - Number(m.journalEntryLine.credit)),
        })),
      })),
      bookLines,
      summary: {
        matched: lines.filter((l) => l.status === BankStatementLineStatus.MATCHED).length,
        unmatched: open.length,
        ignored: lines.filter((l) => l.status === BankStatementLineStatus.IGNORED).length,
        moneyIn: round2(lines.filter((l) => Number(l.amount) > 0).reduce((s, l) => s + Number(l.amount), 0)),
        moneyOut: round2(lines.filter((l) => Number(l.amount) < 0).reduce((s, l) => s - Number(l.amount), 0)),
        bookBalance,
        unmatchedStatement,
        unmatchedBook,
        // What the bank should show once everything open is settled: the books,
        // plus bank lines not booked yet, less book lines the bank hasn't shown.
        expectedStatementBalance: round2(bookBalance + unmatchedStatement - unmatchedBook),
        // The file's last stated balance, as a starting value the user can correct.
        lastStatementBalance: lastBalance == null ? null : Number(lastBalance),
      },
    };
  }

  // Only the obvious: one bank line and one ledger line with the same amount
  // within a few days, neither with another candidate. The rest is the user's call.
  async autoMatch(organizationId: string, bankAccountId: string, fromValue: string, toValue: string, userId?: string) {
    const { account } = await this.glAccountOf(organizationId, bankAccountId);
    const from = parseDateOnly(fromValue, 'from');
    const to = parseDateOnly(toValue, 'to');
    const open = await this.prisma.bankStatementLine.findMany({
      where: { organizationId, bankAccountId, status: BankStatementLineStatus.UNMATCHED, date: { gte: from, lte: to } },
      select: { id: true, date: true, amount: true },
    });
    const book = await this.openBookLines(
      organizationId,
      account.id,
      new Date(from.getTime() - AUTO_MATCH_DAYS * DAY_MS),
      new Date(to.getTime() + AUTO_MATCH_DAYS * DAY_MS),
    );
    const fits = (line: (typeof open)[number], b: (typeof book)[number]) =>
      Math.abs(Number(line.amount) - (Number(b.debit) - Number(b.credit))) < EPS &&
      Math.abs(line.date.getTime() - b.journalEntry.entryDate.getTime()) <= AUTO_MATCH_DAYS * DAY_MS;

    const pairs: { statementLineId: string; journalEntryLineId: string }[] = [];
    for (const line of open) {
      const candidates = book.filter((b) => fits(line, b));
      if (candidates.length !== 1) continue;
      const rivals = open.filter((other) => fits(other, candidates[0]));
      if (rivals.length === 1) pairs.push({ statementLineId: line.id, journalEntryLineId: candidates[0].id });
    }
    if (pairs.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.bankReconciliationMatch.createMany({ data: pairs.map((p) => ({ ...p, createdById: userId ?? null })) });
        await tx.bankStatementLine.updateMany({
          where: { id: { in: pairs.map((p) => p.statementLineId) } },
          data: { status: BankStatementLineStatus.MATCHED },
        });
      });
    }
    return { matched: pairs.length };
  }

  async match(organizationId: string, lineId: string, journalEntryLineIds: string[], userId?: string) {
    const line = await this.lineOrThrow(organizationId, lineId);
    if (line.status !== BankStatementLineStatus.UNMATCHED) throw new BadRequestException('This statement line is not open');
    const { account } = await this.glAccountOf(organizationId, line.bankAccountId);
    const ids = [...new Set(journalEntryLineIds)];
    const book = await this.prisma.journalEntryLine.findMany({
      where: {
        id: { in: ids },
        accountId: account.id,
        reconciliation: null,
        journalEntry: { organizationId, status: JournalEntryStatus.POSTED },
      },
      select: { id: true, debit: true, credit: true },
    });
    if (ids.length === 0 || book.length !== ids.length) throw new BadRequestException('Those ledger lines cannot be matched');
    const total = round2(book.reduce((s, b) => s + Number(b.debit) - Number(b.credit), 0));
    if (Math.abs(total - Number(line.amount)) >= EPS) {
      throw new BadRequestException('The ledger lines must add up to the statement amount');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bankReconciliationMatch.createMany({
        data: ids.map((journalEntryLineId) => ({ statementLineId: lineId, journalEntryLineId, createdById: userId ?? null })),
      });
      await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: BankStatementLineStatus.MATCHED } });
    });
    return { ok: true };
  }

  async unmatch(organizationId: string, lineId: string) {
    await this.lineOrThrow(organizationId, lineId);
    await this.prisma.$transaction(async (tx) => {
      await tx.bankReconciliationMatch.deleteMany({ where: { statementLineId: lineId } });
      await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: BankStatementLineStatus.UNMATCHED } });
    });
    return { ok: true };
  }

  // Corrects a statement line by hand (a misread date or amount from the file). A matched line's
  // date and amount are what its match was checked against, so those wait until it's unmatched.
  async editLine(
    organizationId: string,
    lineId: string,
    patch: { date?: string; description?: string; amount?: number; balance?: number | null },
  ) {
    const line = await this.lineOrThrow(organizationId, lineId);
    const matched = line.status === BankStatementLineStatus.MATCHED;
    const date = patch.date !== undefined ? parseDateOnly(patch.date, 'date') : undefined;
    const amount = patch.amount !== undefined ? round2(patch.amount) : undefined;
    if (matched && ((date && date.getTime() !== line.date.getTime()) || (amount !== undefined && Math.abs(amount - Number(line.amount)) >= EPS))) {
      throw new BadRequestException('Unmatch this line before changing its date or amount');
    }
    if (amount !== undefined && !amount) throw new BadRequestException('A statement line needs an amount');
    const description = patch.description?.trim().replace(/\s+/g, ' ');
    await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: {
        ...(date && { date }),
        ...(description !== undefined && { description }),
        ...(amount !== undefined && { amount }),
        ...(patch.balance !== undefined && { balance: patch.balance == null ? null : round2(patch.balance) }),
      },
    });
    return { ok: true };
  }

  // A line typed in rather than imported — for a bank that only gives a printed statement.
  async addLine(
    organizationId: string,
    bankAccountId: string,
    input: { date: string; description: string; amount: number; balance?: number | null },
    userId?: string,
  ) {
    await this.glAccountOf(organizationId, bankAccountId);
    if (!input.amount || !Number.isFinite(input.amount)) throw new BadRequestException('A statement line needs an amount');
    return this.prisma.bankStatementLine.create({
      data: {
        organizationId,
        bankAccountId,
        date: parseDateOnly(input.date, 'date'),
        description: input.description.trim().replace(/\s+/g, ' '),
        amount: round2(input.amount),
        balance: input.balance == null ? null : round2(input.balance),
        // Never collides with an import, so a re-imported file doesn't swallow it.
        dedupeKey: `manual:${randomUUID()}`,
        createdById: userId ?? null,
      },
    });
  }

  // Saves the closing balance the user read off the statement: it's kept on the period's last
  // line, which is where the report reads it back from (lastStatementBalance).
  async saveStatementBalance(organizationId: string, bankAccountId: string, fromValue: string, toValue: string, balance: number | null) {
    await this.glAccountOf(organizationId, bankAccountId);
    const last = await this.prisma.bankStatementLine.findFirst({
      where: { organizationId, bankAccountId, date: { gte: parseDateOnly(fromValue, 'from'), lte: parseDateOnly(toValue, 'to') } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });
    if (!last) throw new BadRequestException('Import or add a statement line for this period first');
    await this.prisma.bankStatementLine.update({
      where: { id: last.id },
      data: { balance: balance == null ? null : round2(balance) },
    });
    return { ok: true };
  }

  async setIgnored(organizationId: string, lineId: string, ignored: boolean) {
    const line = await this.lineOrThrow(organizationId, lineId);
    if (line.status === BankStatementLineStatus.MATCHED) throw new BadRequestException('Unmatch this line first');
    await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: ignored ? BankStatementLineStatus.IGNORED : BankStatementLineStatus.UNMATCHED },
    });
    return { ok: true };
  }

  // Money only the bank knew about (fees, interest): books it and ticks it off.
  async record(organizationId: string, lineId: string, accountId: string, memo: string | undefined, userId?: string) {
    const line = await this.lineOrThrow(organizationId, lineId);
    if (line.status !== BankStatementLineStatus.UNMATCHED) throw new BadRequestException('This statement line is not open');
    const { account: bankLedger } = await this.glAccountOf(organizationId, line.bankAccountId);
    const other = await this.prisma.chartOfAccount.findFirst({
      where: { id: accountId, organizationId, isActive: true },
      select: { id: true, type: true },
    });
    if (!other || other.id === bankLedger.id) throw new BadRequestException('Choose another active account');
    if (other.type !== AccountType.REVENUE && other.type !== AccountType.EXPENSE) {
      throw new BadRequestException('Only a revenue or expense account can be used here');
    }
    const amount = Number(line.amount);
    const abs = Math.abs(amount);
    await this.prisma.$transaction(async (tx) => {
      const entry = await this.journal.postEntry(
        organizationId,
        {
          date: line.date,
          memo: memo?.trim() || line.description,
          sourceType: JournalSourceType.MANUAL,
          userId,
          lines:
            amount > 0
              ? [{ accountId: bankLedger.id, debit: abs }, { accountId: other.id, credit: abs }]
              : [{ accountId: other.id, debit: abs }, { accountId: bankLedger.id, credit: abs }],
        },
        tx,
      );
      const bankLine = await tx.journalEntryLine.findFirstOrThrow({
        where: { journalEntryId: entry!.id, accountId: bankLedger.id },
        select: { id: true },
      });
      await tx.bankReconciliationMatch.create({
        data: { statementLineId: lineId, journalEntryLineId: bankLine.id, createdById: userId ?? null },
      });
      await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: BankStatementLineStatus.MATCHED } });
    });
    return { ok: true };
  }

  // Undoes a wrongly mapped import. Ticked-off lines stay.
  async clearOpen(organizationId: string, bankAccountId: string, fromValue: string, toValue: string) {
    await this.glAccountOf(organizationId, bankAccountId);
    const { count } = await this.prisma.bankStatementLine.deleteMany({
      where: {
        organizationId,
        bankAccountId,
        status: { not: BankStatementLineStatus.MATCHED },
        date: { gte: parseDateOnly(fromValue, 'from'), lte: parseDateOnly(toValue, 'to') },
      },
    });
    return { removed: count };
  }
}
