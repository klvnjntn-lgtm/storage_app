import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import { resolveTimezone, toBusinessDate } from '../../accounting/business-date';
import { renderNumberFormat, validateNumberFormat } from './document-number-format.util';

export type NumberingConfig = {
  // Always a template — the legacy shapes are expressed as one, so the
  // settings page has a single thing to show and edit.
  format: string;
  // True until an admin saves a format (or the importer seeds one).
  isDefault: boolean;
  nextNumber: number;
  preview: string;
};

// Default format is PREFIX-YYYY-NNNNN, atomically sequenced per
// (organizationId, documentType, year) — see nextSequential below. Orgs
// with a DocumentSequence row (imported, or a format saved in Settings)
// use nextForOrganization instead.
//
// Call inside the same $transaction that writes the row, same as
// nextInvoiceNumber was called inside issue()'s transaction — numbering
// must not race between two concurrent issues.
@Injectable()
export class DocumentNumberingService {
  // FIX — replaces a former next()-plus-"count rows since Jan 1" pattern.
  // That pattern read a count and formatted it outside of any lock, so two
  // concurrent issues in the same transaction isolation window could read
  // the same count and mint the same number (the caller then hit a
  // unique-constraint violation and told the client to retry), and a
  // request that started just before midnight on Dec 31 but committed just
  // after could mix `year` and `count` from different years.
  //
  // DocumentCounter's row-level UPDATE (lastNumber = lastNumber + 1) is
  // what makes this safe: Postgres serializes concurrent updates to the
  // same (organizationId, documentType, year) row, so each caller gets a
  // distinct, gap-free lastNumber with no read-then-write race. Must be
  // called inside the same transaction that writes the document row, same
  // requirement as nextForOrganization above.
  async nextSequential(
    tx: Prisma.TransactionClient,
    organizationId: string,
    documentType: string,
    prefix: string,
    date: Date = new Date(),
  ): Promise<string> {
    // The business year in the org's timezone. The server clock is UTC
    // (Docker), so documents made in the first hours of Jan 1 in Jakarta
    // used to get last year's prefix and sequence.
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const year = toBusinessDate(date, resolveTimezone(org)).getUTCFullYear();
    const counter = await tx.documentCounter.upsert({
      where: { organizationId_documentType_year: { organizationId, documentType, year } },
      create: { organizationId, documentType, year, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return `${prefix}-${year}-${String(counter.lastNumber).padStart(5, '0')}`;
  }

  // ---------------------------------------------------------------------
  // Atomic, gap-free numbering for organizations that already have a
  // DocumentSequence row — currently seeded by the Accurate GDB importer
  // (see GdbImportService.importInvoices / detectInvoiceNumberFormat),
  // which detects an imported customer's existing numbering format (e.g.
  // "ATL - 59886") and stores it so new invoices continue that sequence
  // instead of starting over with nextSequential's PREFIX-YYYY-NNNNN scheme.
  //
  // Returns null when the org/documentType has no sequence row yet, so
  // callers fall back to nextSequential unchanged. This method never
  // creates a row itself — it's purely additive. Organizations that never
  // went through the importer are completely unaffected by its existence.
  //
  // Must be called inside the same transaction as the rest of the
  // document-issuing flow, same requirement as nextSequential above: the row's
  // UPDATE is what makes concurrent calls safe (the database serializes
  // concurrent `lastNumber = lastNumber + 1` writes to the same row via
  // row-level locking), so two simultaneous callers for the same
  // org/documentType always get two different lastNumber values.
  // ---------------------------------------------------------------------
  async nextForOrganization(
    tx: Prisma.TransactionClient,
    organizationId: string,
    documentType: DocumentType,
  ): Promise<string | null> {
    const existing = await tx.documentSequence.findUnique({
      where: { organizationId_documentType: { organizationId, documentType } },
    });

    if (!existing) return null;

    const updated = await tx.documentSequence.update({
      where: { id: existing.id },
      data: { lastNumber: { increment: 1 } },
    });

    if (!updated.format) return `${updated.prefix}${updated.lastNumber}`;
    return renderNumberFormat(updated.format, updated.lastNumber, await this.businessToday(tx, organizationId));
  }

  // ---------------------------------------------------------------------
  // Settings → document numbering. An org starts on one of two legacy
  // schemes: nextSequential's PREFIX-YYYY-NNNNN (counter resets every
  // year) or an imported prefix + number. Saving a format moves it onto a
  // DocumentSequence row with that format, and from then on one running
  // number is shared by every future format — it never resets, so a
  // format change continues the count instead of restarting it.
  // ---------------------------------------------------------------------
  async getConfig(
    organizationId: string,
    documentType: DocumentType,
    defaultPrefix: string,
    db: Prisma.TransactionClient,
  ): Promise<NumberingConfig> {
    const today = await this.businessToday(db, organizationId);
    const seq = await db.documentSequence.findUnique({
      where: { organizationId_documentType: { organizationId, documentType } },
    });

    let format: string;
    let lastNumber: number;
    if (seq) {
      // Braces can't appear in an imported prefix's literal text without
      // reading as tokens, so drop them.
      format = seq.format ?? `${seq.prefix.replace(/[{}]/g, '')}{SEQ}`;
      lastNumber = seq.lastNumber;
    } else {
      format = `${defaultPrefix}-{YYYY}-{SEQ:5}`;
      const counter = await db.documentCounter.findUnique({
        where: {
          organizationId_documentType_year: { organizationId, documentType, year: today.getUTCFullYear() },
        },
      });
      lastNumber = counter?.lastNumber ?? 0;
    }

    return {
      format,
      isDefault: !seq,
      nextNumber: lastNumber + 1,
      preview: renderNumberFormat(format, lastNumber + 1, today),
    };
  }

  // nextNumber is optional and forward-only: going back could hand out a
  // number that's already on an issued document.
  async setConfig(
    organizationId: string,
    documentType: DocumentType,
    input: { format: string; nextNumber?: number },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const format = input.format.trim();
    const error = validateNumberFormat(format);
    if (error) throw new BadRequestException(error);

    const seq = await tx.documentSequence.findUnique({
      where: { organizationId_documentType: { organizationId, documentType } },
    });
    // First save on a nextSequential org: carry over the latest year's
    // counter so the count continues rather than starting at 1.
    const lastNumber =
      seq?.lastNumber ??
      (
        await tx.documentCounter.findFirst({
          where: { organizationId, documentType },
          orderBy: { year: 'desc' },
        })
      )?.lastNumber ??
      0;

    let newLast = lastNumber;
    if (input.nextNumber !== undefined) {
      if (!Number.isInteger(input.nextNumber) || input.nextNumber < 1) {
        throw new BadRequestException('Next number must be a whole number of at least 1');
      }
      if (input.nextNumber <= lastNumber) {
        throw new BadRequestException(
          `Next number can't go below ${lastNumber + 1} — lower numbers may already be in use`,
        );
      }
      newLast = input.nextNumber - 1;
    }

    if (seq) {
      await tx.documentSequence.update({ where: { id: seq.id }, data: { format, lastNumber: newLast } });
    } else {
      await tx.documentSequence.create({
        data: { organizationId, documentType, prefix: '', format, lastNumber: newLast },
      });
    }
  }

  private async businessToday(db: Prisma.TransactionClient, organizationId: string): Promise<Date> {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    return toBusinessDate(new Date(), resolveTimezone(org));
  }
}