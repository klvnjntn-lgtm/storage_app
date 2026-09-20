import { BadRequestException, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, FiscalPeriodStatus, JournalEntryStatus, JournalSourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toBusinessDate } from './business-date';

type Db = Prisma.TransactionClient | PrismaService;

export type JournalLineInput = {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
  locationId?: string;
};

export type PostEntryInput = {
  date: Date;
  memo?: string;
  sourceType: JournalSourceType;
  sourceId?: string;
  userId?: string;
  lines: JournalLineInput[];
};

export type ListJournalEntriesFilters = {
  status?: JournalEntryStatus;
  sourceType?: JournalSourceType;
  from?: Date;
  to?: Date;
  search?: string; // matches entryNumber or memo
  page?: number;
  pageSize?: number;
};

const EPSILON = 0.01; // rounding tolerance for Decimal(14,2) sums

// The only service that writes JournalEntry/JournalEntryLine rows. Every
// document-specific posting rule builds a set of lines and calls
// postEntry() — it never touches the ledger tables directly.
//
// TRANSACTION COMPOSABILITY: pass `tx` when calling this from inside a
// document service's own transaction. If tx is omitted, postEntry opens
// its own transaction, which is only safe for genuinely standalone calls.
// Never call this without tx from inside another open transaction.
//
// DATES: input.date may be an instant (payment.createdAt, new Date()) or a
// date-only value (invoice.invoiceDate). Either way it's normalised to the
// business calendar date (see business-date.ts) before being stored and
// before the fiscal period is chosen, so entryDate and period always agree.
@Injectable()
export class JournalService {
  constructor(private prisma: PrismaService) {}

  // ---- reads ----------------------------------------------------------

  // Paginated journal list, newest first. Includes each entry's lines (with
  // account code/name); pageSize is capped at 100 to bound the payload.
  async listEntries(organizationId: string, filters: ListJournalEntriesFilters = {}) {
    const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
    const pageSize =
      filters.pageSize && filters.pageSize > 0 ? Math.min(Math.floor(filters.pageSize), 100) : 25;
    const search = filters.search?.trim();

    const where: Prisma.JournalEntryWhereInput = {
      organizationId,
      ...(filters.status && { status: filters.status }),
      ...(filters.sourceType && { sourceType: filters.sourceType }),
      ...((filters.from || filters.to) && {
        entryDate: {
          ...(filters.from && { gte: filters.from }),
          ...(filters.to && { lte: filters.to }),
        },
      }),
      ...(search && {
        OR: [
          { entryNumber: { contains: search, mode: 'insensitive' as const } },
          { memo: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ entryDate: 'desc' }, { entryNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          lines: {
            include: { account: { select: { id: true, code: true, name: true } } },
          },
        },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getEntry(organizationId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, organizationId },
      include: {
        lines: { include: { account: { select: { id: true, code: true, name: true } } } },
        reversalOf: { select: { id: true, entryNumber: true } },
        reversedBy: { select: { id: true, entryNumber: true } },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  // ---- writes ---------------------------------------------------------

  async postEntry(organizationId: string, input: PostEntryInput, tx?: Prisma.TransactionClient) {
    this.validateLines(input.lines);

    try {
      if (tx) return await this.postEntryInner(tx, organizationId, input);
      return await this.prisma.$transaction((innerTx) => this.postEntryInner(innerTx, organizationId, input));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(
          'Journal entry number assignment conflicted with a concurrent post — please retry',
        );
      }
      throw err;
    }
  }

  private async postEntryInner(tx: Prisma.TransactionClient, organizationId: string, input: PostEntryInput) {
    // One business calendar date drives BOTH the stored entryDate and the
    // fiscal period, so they can never disagree near a month boundary.
    const entryDate = toBusinessDate(input.date);
    const fiscalPeriod = await this.getOrCreateOpenFiscalPeriod(tx, organizationId, entryDate);

    // Only POSTED entries count as duplicates. A voided original AND its
    // (also VOID) reversal are both ignored, so a source document can be
    // reposted after a void.
    if (input.sourceId) {
      const existing = await tx.journalEntry.findFirst({
        where: {
          organizationId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          status: JournalEntryStatus.POSTED,
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `A posted journal entry already exists for ${input.sourceType} ${input.sourceId} (${existing.id}). Void it before reposting.`,
        );
      }
    }

    const count = await tx.journalEntry.count({ where: { organizationId, fiscalPeriodId: fiscalPeriod.id } });
    const entryNumber = this.buildEntryNumber(fiscalPeriod.year, fiscalPeriod.month, count + 1);

    return tx.journalEntry.create({
      data: {
        organizationId,
        entryNumber,
        entryDate,
        memo: input.memo,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        status: JournalEntryStatus.POSTED,
        fiscalPeriodId: fiscalPeriod.id,
        userId: input.userId,
        lines: {
          create: input.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit ?? 0,
            credit: l.credit ?? 0,
            description: l.description,
            locationId: l.locationId,
          })),
        },
      },
      include: { lines: true },
    });
  }

  // Never mutate or delete a POSTED entry. To undo one, post its mirror
  // image and link the pair. BOTH the original and the reversal end up VOID
  // so they leave every POSTED-only report together (net effect: zero, not
  // negative). The audit trail stays in the table via reversalOfId.
  async voidEntry(
    organizationId: string,
    journalEntryId: string,
    userId?: string,
    reason?: string,
    tx?: Prisma.TransactionClient,
  ) {
    try {
      if (tx) return await this.voidEntryInner(tx, organizationId, journalEntryId, userId, reason);
      return await this.prisma.$transaction((innerTx) =>
        this.voidEntryInner(innerTx, organizationId, journalEntryId, userId, reason),
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(
          'Reversal entry number assignment conflicted with a concurrent void — please retry',
        );
      }
      throw err;
    }
  }

  private async voidEntryInner(
    tx: Prisma.TransactionClient,
    organizationId: string,
    journalEntryId: string,
    userId?: string,
    reason?: string,
  ) {
    const original = await tx.journalEntry.findFirst({
      where: { id: journalEntryId, organizationId },
      include: { lines: true, fiscalPeriod: true },
    });
    if (!original) throw new BadRequestException('Journal entry not found');
    if (original.status === JournalEntryStatus.VOID) {
      throw new BadRequestException('Journal entry is already void');
    }
    if (original.fiscalPeriod.status !== FiscalPeriodStatus.OPEN) {
      throw new BadRequestException(`Cannot void an entry in a ${original.fiscalPeriod.status} fiscal period`);
    }

    const count = await tx.journalEntry.count({
      where: { organizationId, fiscalPeriodId: original.fiscalPeriodId },
    });
    const entryNumber = this.buildEntryNumber(original.fiscalPeriod.year, original.fiscalPeriod.month, count + 1);

    const reversal = await tx.journalEntry.create({
      data: {
        organizationId,
        entryNumber,
        // Same date as the original, so the reversal sits inside the fiscal
        // period it's filed under (it used to get "now" while being filed
        // under the original's period).
        entryDate: original.entryDate,
        memo: reason ? `Reversal: ${reason}` : `Reversal of ${original.entryNumber ?? original.id}`,
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        status: JournalEntryStatus.VOID, // must leave reports together with the original
        fiscalPeriodId: original.fiscalPeriodId,
        userId,
        reversalOfId: original.id,
        lines: {
          create: original.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.credit, // swapped
            credit: l.debit, // swapped
            description: l.description,
            locationId: l.locationId,
          })),
        },
      },
    });

    await tx.journalEntry.update({ where: { id: original.id }, data: { status: JournalEntryStatus.VOID } });

    return reversal;
  }

  async findPostedBySource(
    organizationId: string,
    sourceType: JournalSourceType,
    sourceId: string,
    tx: Db = this.prisma,
  ) {
    return tx.journalEntry.findFirst({
      where: { organizationId, sourceType, sourceId, status: JournalEntryStatus.POSTED },
    });
  }

async closePeriod(organizationId: string, year: number, month: number) {
  const existing = await this.prisma.fiscalPeriod.findUnique({
    where: { organizationId_year_month: { organizationId, year, month } },
  });
  if (existing?.status === FiscalPeriodStatus.LOCKED) {
    throw new BadRequestException('LOCKED periods cannot be changed');
  }
  if (existing?.status === FiscalPeriodStatus.CLOSED) {
    throw new BadRequestException('Fiscal period is already closed');
  }

  return this.prisma.fiscalPeriod.upsert({
    where: { organizationId_year_month: { organizationId, year, month } },
    update: { status: FiscalPeriodStatus.CLOSED, closedAt: new Date() },
    create: { organizationId, year, month, status: FiscalPeriodStatus.CLOSED, closedAt: new Date() },
  });
}

  async reopenPeriod(organizationId: string, year: number, month: number) {
    const period = await this.prisma.fiscalPeriod.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
    });
    if (!period) throw new BadRequestException('Fiscal period not found');
    if (period.status === FiscalPeriodStatus.LOCKED) {
      throw new BadRequestException('LOCKED periods cannot be reopened');
    }
    return this.prisma.fiscalPeriod.update({
      where: { id: period.id },
      data: { status: FiscalPeriodStatus.OPEN, closedAt: null },
    });
  }

  // `businessDate` is already normalised by toBusinessDate() (00:00 UTC of
  // the business calendar date), so the UTC getters read the business
  // year/month directly. No server-local getters anywhere.
  private async getOrCreateOpenFiscalPeriod(
    tx: Prisma.TransactionClient,
    organizationId: string,
    businessDate: Date,
  ) {
    const year = businessDate.getUTCFullYear();
    const month = businessDate.getUTCMonth() + 1;

    let period = await tx.fiscalPeriod.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
    });

    if (!period) {
      period = await tx.fiscalPeriod.create({
        data: { organizationId, year, month, status: FiscalPeriodStatus.OPEN },
      });
    }

    if (period.status !== FiscalPeriodStatus.OPEN) {
      throw new BadRequestException(
        `Fiscal period ${month}/${year} is ${period.status} — cannot post new entries into it`,
      );
    }

    return period;
  }

  private validateLines(lines: JournalLineInput[]) {
    if (!lines || lines.length < 2) {
      throw new BadRequestException('A journal entry needs at least two lines');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      const debit = line.debit ?? 0;
      const credit = line.credit ?? 0;
      if (debit < 0 || credit < 0) throw new BadRequestException('debit/credit amounts cannot be negative');
      if (debit > 0 && credit > 0) throw new BadRequestException('A single line cannot have both a debit and a credit');
      if (debit === 0 && credit === 0) throw new BadRequestException('Each line must have a non-zero debit or credit');
      totalDebit += debit;
      totalCredit += credit;
    }

    if (Math.abs(totalDebit - totalCredit) > EPSILON) {
      throw new BadRequestException(
        `Journal entry does not balance: total debits ${totalDebit} vs total credits ${totalCredit}`,
      );
    }
  }

  private buildEntryNumber(year: number, month: number, seq: number) {
    return `JE-${year}${String(month).padStart(2, '0')}-${String(seq).padStart(4, '0')}`;
  }

  // Owns the mechanics of reversing every posted entry for a set of source
// IDs. Callers (InvoiceService, etc.) shouldn't know or care what those
// IDs look like — see PostingRulesService for the ID conventions.
async voidAllForSource(
  organizationId: string,
  sourceType: JournalSourceType,
  sourceIds: string[],
  userId: string | undefined,
  reason: string,
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const voided: string[] = [];
  for (const sourceId of sourceIds) {
    const entry = await this.findPostedBySource(organizationId, sourceType, sourceId, tx);
    if (entry) {
      await this.voidEntryInner(tx, organizationId, entry.id, userId, reason);
      voided.push(sourceId);
    }
  }
  return voided;
}
}