import { Injectable } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';

// Generalized from InvoiceService.nextInvoiceNumber. Format is always
// PREFIX-YYYY-NNNNN, reset by whatever "count so far this year" query
// the caller provides — each document type has its own idea of what
// counts (Invoice counts ISSUED invoices since Jan 1; SalesOrder will
// likely count CONFIRMED orders since Jan 1, etc.), so the counting
// query stays with the caller and this just owns the format + padding.
//
// Call inside the same $transaction that writes the row, same as
// nextInvoiceNumber was called inside issue()'s transaction — numbering
// must not race between two concurrent issues.
@Injectable()
export class DocumentNumberingService {
  async next(opts: { prefix: string; count: number; year?: number }): Promise<string> {
    const year = opts.year ?? new Date().getFullYear();
    return `${opts.prefix}-${year}-${String(opts.count + 1).padStart(5, '0')}`;
  }

  // ---------------------------------------------------------------------
  // Atomic, gap-free numbering for organizations that already have a
  // DocumentSequence row — currently seeded by the Accurate GDB importer
  // (see GdbImportService.importInvoices / detectInvoiceNumberFormat),
  // which detects an imported customer's existing numbering format (e.g.
  // "ATL - 59886") and stores it so new invoices continue that sequence
  // instead of starting over with next()'s PREFIX-YYYY-NNNNN scheme.
  //
  // Returns null when the org/documentType has no sequence row yet, so
  // callers fall back to next() unchanged. This method never creates a
  // row itself — it's purely additive. Organizations that never went
  // through the importer are completely unaffected by its existence.
  //
  // Must be called inside the same transaction as the rest of the
  // document-issuing flow, same requirement as next() above: the row's
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