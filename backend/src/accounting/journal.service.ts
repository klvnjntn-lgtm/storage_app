import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, FiscalPeriodStatus, JournalEntryStatus, JournalSourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toBusinessDate, resolveTimezone } from './business-date';
import { escapeLike } from '../common/text/escape-like';

type Db = Prisma.TransactionClient | PrismaService;

export type JournalLineInput = {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
  locationId?: string;
  // The branch the line is reported under. When left out it's the
  // location's branch (stock postings), else the line has none.
  branchId?: string;
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

// FIX — was 0.01. Every other money-noise tolerance in this codebase
// (expenses.service.ts, fixed-assets.service.ts) uses half a cent, since
// amounts are 2dp and anything smaller is genuine float noise. A full-cent
// tolerance let a manual/posted entry that's off by up to a full cent be
// accepted as "balanced" and posted to the ledger — small errors like
// that compound silently over many entries with nothing else catching it.
const EPSILON = 0.005; // rounding tolerance for Decimal(14,2) sums

// An entry that still counts for its source document: posted, and not one
// half of a reversal. Two kinds of undone entry exist — a pair voided
// inside an open period (both VOID), and an original from a closed period
// with its reversal posted later (both stay POSTED so the closed period's
// figures don't move; reversedBy / reversalOfId mark them).
const LIVE: Prisma.JournalEntryWhereInput = {
  status: JournalEntryStatus.POSTED,
  reversalOfId: null,
  reversedBy: { is: null },
};

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
          { entryNumber: { contains: escapeLike(search), mode: 'insensitive' as const } },
          { memo: { contains: escapeLike(search), mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        where,
        // Not entryNumber: as text, JE-…-10000 sorts before JE-…-9999.
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }, { entryNumber: 'desc' }],
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
        // FIX — this transaction can also throw P2002 from FiscalPeriod's
        // own unique constraint (organizationId_year_month) if two
        // concurrent posts both race to create the same new fiscal period
        // in getOrCreateOpenFiscalPeriod() below — not just from the
        // entry-number assignment. Both are equally harmless (still rolls
        // back, still safe to retry), but the error text was always wrong
        // for the fiscal-period case.
        const target = (err.meta?.target as string[] | undefined) ?? [];
        if (target.some((t) => t.includes('year') || t.includes('month'))) {
          throw new BadRequestException(
            'Fiscal period creation conflicted with a concurrent post — please retry',
          );
        }
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
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const entryDate = toBusinessDate(input.date, resolveTimezone(org));
    const fiscalPeriod = await this.getOrCreateOpenFiscalPeriod(tx, organizationId, entryDate);

    // Only live entries count as duplicates. A voided or reversed original
    // and its reversal are both ignored, so a source document can be
    // reposted after a void.
    if (input.sourceId) {
      const existing = await tx.journalEntry.findFirst({
        where: {
          organizationId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          ...LIVE,
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `A posted journal entry already exists for ${input.sourceType} ${input.sourceId} (${existing.id}). Void it before reposting.`,
        );
      }
    }

    const entryNumber = this.buildEntryNumber(
      fiscalPeriod.year,
      fiscalPeriod.month,
      await this.nextEntrySeq(tx, organizationId, fiscalPeriod.id, fiscalPeriod.year, fiscalPeriod.month),
    );

    const missing = [...new Set(input.lines.filter((l) => !l.branchId && l.locationId).map((l) => l.locationId!))];
    const branchOfLocation = new Map(
      missing.length === 0
        ? []
        : (
            await tx.location.findMany({
              where: { id: { in: missing }, organizationId },
              select: { id: true, branchId: true },
            })
          ).map((l) => [l.id, l.branchId] as const),
    );

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
            branchId: l.branchId ?? (l.locationId ? branchOfLocation.get(l.locationId) : undefined) ?? null,
          })),
        },
      },
      include: { lines: true },
    });
  }

  // Never mutate or delete a POSTED entry. To undo one, post its mirror
  // image and link the pair (reversalOfId).
  //
  // While the original's period is still OPEN, both the original and the
  // reversal end up VOID, so they leave every POSTED-only report together —
  // as if the entry had never been made.
  //
  // Once that period is CLOSED or LOCKED its figures have been reported and
  // must not move. The original then stays exactly as it is, and the
  // reversal is posted today, in the current open period, where it shows as
  // a correction. Both stay POSTED; over the two periods they net to zero.
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
      include: { lines: true, reversedBy: { select: { id: true } } },
    });
    if (!original) throw new BadRequestException('Journal entry not found');
    if (original.status === JournalEntryStatus.VOID) {
      throw new BadRequestException('Journal entry is already void');
    }
    if (original.reversalOfId || original.reversedBy) {
      throw new BadRequestException('Journal entry is already reversed');
    }

    // Read under the same lock a posting takes, so a close in progress has
    // either landed or waits for this void.
    const originalPeriod = await this.lockPeriodForPosting(tx, original.fiscalPeriodId);
    const inOpenPeriod = originalPeriod.status === FiscalPeriodStatus.OPEN;
    // A closed period keeps its entry; the correction goes in today's.
    const period = inOpenPeriod
      ? originalPeriod
      : await this.getOrCreateOpenFiscalPeriod(tx, organizationId, await this.today(tx, organizationId));
    const entryDate = inOpenPeriod ? original.entryDate : await this.today(tx, organizationId);

    const entryNumber = this.buildEntryNumber(
      period.year,
      period.month,
      await this.nextEntrySeq(tx, organizationId, period.id, period.year, period.month),
    );

    const reversal = await tx.journalEntry.create({
      data: {
        organizationId,
        entryNumber,
        // Open period: the original's date, so the pair sits together in
        // the period they both leave. Closed period: today.
        entryDate,
        memo: reason ? `Reversal: ${reason}` : `Reversal of ${original.entryNumber ?? original.id}`,
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        // VOID leaves reports together with the original; POSTED is the
        // correction a closed period's entry gets instead.
        status: inOpenPeriod ? JournalEntryStatus.VOID : JournalEntryStatus.POSTED,
        fiscalPeriodId: period.id,
        userId,
        reversalOfId: original.id,
        lines: {
          create: original.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.credit, // swapped
            credit: l.debit, // swapped
            description: l.description,
            locationId: l.locationId,
            branchId: l.branchId,
          })),
        },
      },
    });

    if (inOpenPeriod) {
      await tx.journalEntry.update({ where: { id: original.id }, data: { status: JournalEntryStatus.VOID } });
    }

    return reversal;
  }

  private async today(tx: Prisma.TransactionClient, organizationId: string) {
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    return toBusinessDate(new Date(), resolveTimezone(org));
  }

  // The period row, share-locked until this transaction ends. Postings and
  // voids read the status through here; closing or locking a period updates
  // the row, which waits for every share lock. So a close can no longer
  // slip in between a posting's "is it open?" check and its commit.
  private async lockPeriodForPosting(tx: Prisma.TransactionClient, fiscalPeriodId: string) {
    await tx.$queryRaw`SELECT id FROM "FiscalPeriod" WHERE id = ${fiscalPeriodId} FOR SHARE`;
    return tx.fiscalPeriod.findUniqueOrThrow({ where: { id: fiscalPeriodId } });
  }

  async findPostedBySource(
    organizationId: string,
    sourceType: JournalSourceType,
    sourceId: string,
    tx: Db = this.prisma,
  ) {
    return tx.journalEntry.findFirst({
      where: { organizationId, sourceType, sourceId, ...LIVE },
    });
  }

  // Every live entry whose sourceId starts with `prefix` — for documents
  // that post a run of entries under generated ids (an invoice's cost
  // corrections, `${invoiceId}:cogs:recost:…`).
  async findPostedBySourcePrefix(
    organizationId: string,
    sourceType: JournalSourceType,
    prefix: string,
    tx: Db = this.prisma,
  ) {
    return tx.journalEntry.findMany({
      where: { organizationId, sourceType, sourceId: { startsWith: prefix }, ...LIVE },
      orderBy: { createdAt: 'asc' },
    });
  }

  async voidAllForSourcePrefix(
    organizationId: string,
    sourceType: JournalSourceType,
    prefix: string,
    userId: string | undefined,
    reason: string,
    tx: Prisma.TransactionClient,
  ) {
    const entries = await this.findPostedBySourcePrefix(organizationId, sourceType, prefix, tx);
    for (const entry of entries) {
      await this.voidEntryInner(tx, organizationId, entry.id, userId, reason);
    }
    return entries.length;
  }

async closePeriod(organizationId: string, year: number, month: number) {
  return this.setPeriodStatus(organizationId, year, month, FiscalPeriodStatus.CLOSED);
}

  async reopenPeriod(organizationId: string, year: number, month: number) {
    return this.setPeriodStatus(organizationId, year, month, FiscalPeriodStatus.OPEN);
  }

  // Permanent: for a period whose figures have gone to the tax office or
  // an auditor. Nothing can be posted to it or reopen it afterwards; a
  // correction to one of its documents posts in the current period instead
  // (see voidEntry).
  async lockPeriod(organizationId: string, year: number, month: number) {
    return this.setPeriodStatus(organizationId, year, month, FiscalPeriodStatus.LOCKED);
  }

  // One transaction, with the row made first and then updated: the UPDATE
  // waits for every posting that holds the period share-locked (see
  // lockPeriodForPosting), so the status never changes underneath one.
  private async setPeriodStatus(organizationId: string, year: number, month: number, to: FiscalPeriodStatus) {
    return this.prisma.$transaction(async (tx) => {
      if (to !== FiscalPeriodStatus.OPEN) {
        await tx.$executeRaw`
          INSERT INTO "FiscalPeriod" (id, "organizationId", year, month)
          VALUES (${randomUUID()}, ${organizationId}, ${year}, ${month})
          ON CONFLICT ("organizationId", year, month) DO NOTHING
        `;
      }
      const [row] = await tx.$queryRaw<{ id: string; status: FiscalPeriodStatus }[]>`
        SELECT id, status FROM "FiscalPeriod"
        WHERE "organizationId" = ${organizationId} AND year = ${year} AND month = ${month}
        FOR UPDATE
      `;
      if (!row) throw new BadRequestException('Fiscal period not found');
      if (row.status === FiscalPeriodStatus.LOCKED) {
        throw new BadRequestException(
          to === FiscalPeriodStatus.OPEN ? 'LOCKED periods cannot be reopened' : 'LOCKED periods cannot be changed',
        );
      }
      if (to === FiscalPeriodStatus.CLOSED && row.status === FiscalPeriodStatus.CLOSED) {
        throw new BadRequestException('Fiscal period is already closed');
      }
      return tx.fiscalPeriod.update({
        where: { id: row.id },
        data: { status: to, closedAt: to === FiscalPeriodStatus.OPEN ? null : new Date() },
      });
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

    // INSERT … ON CONFLICT, not find-then-create: the first two postings of
    // a new month both tried to create its period, and one of them failed.
    await tx.$executeRaw`
      INSERT INTO "FiscalPeriod" (id, "organizationId", year, month)
      VALUES (${randomUUID()}, ${organizationId}, ${year}, ${month})
      ON CONFLICT ("organizationId", year, month) DO NOTHING
    `;
    const { id } = await tx.fiscalPeriod.findUniqueOrThrow({
      where: { organizationId_year_month: { organizationId, year, month } },
      select: { id: true },
    });
    const period = await this.lockPeriodForPosting(tx, id);

    if (period.status !== FiscalPeriodStatus.OPEN) {
      const hint =
        period.status === FiscalPeriodStatus.LOCKED
          ? 'Locked periods cannot be reopened.'
          : 'Ask an admin to reopen the period first, then try again.';
      throw new BadRequestException(
        `Cannot post to ${month}/${year} — this fiscal period is ${period.status}. ${hint}`,
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

  // Per-month counter row, bumped with a row-level UPDATE so two sales
  // posted at the same moment get different numbers. Counting the period's
  // entries instead handed both the same number and one sale failed with
  // "please retry". A month's first use seeds the counter from the entries
  // already numbered by that count.
  private async nextEntrySeq(
    tx: Prisma.TransactionClient,
    organizationId: string,
    fiscalPeriodId: string,
    year: number,
    month: number,
  ) {
    const documentType = `JOURNAL_ENTRY_${String(month).padStart(2, '0')}`;
    const existing = await tx.documentCounter.findUnique({
      where: { organizationId_documentType_year: { organizationId, documentType, year } },
      select: { id: true },
    });
    const seed = existing ? 0 : await tx.journalEntry.count({ where: { organizationId, fiscalPeriodId } });
    // One statement, so two first posts of the month can't both insert.
    const [counter] = await tx.$queryRaw<{ lastNumber: number }[]>`
      INSERT INTO "DocumentCounter" (id, "organizationId", "documentType", year, "lastNumber", "updatedAt")
      VALUES (${randomUUID()}, ${organizationId}, ${documentType}, ${year}, ${seed + 1}, now())
      ON CONFLICT ("organizationId", "documentType", year)
      DO UPDATE SET "lastNumber" = "DocumentCounter"."lastNumber" + 1, "updatedAt" = now()
      RETURNING "lastNumber"
    `;
    return counter.lastNumber;
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