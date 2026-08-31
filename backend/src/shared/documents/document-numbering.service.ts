import { Injectable } from '@nestjs/common';

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
}