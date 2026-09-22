import { Injectable } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';

// Format is always PREFIX-YYYY-NNNNN, atomically sequenced per
// (organizationId, documentType, year) — see nextSequential below.
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
    const year = date.getFullYear();
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

    return `${updated.prefix}${updated.lastNumber}`;
  }
}