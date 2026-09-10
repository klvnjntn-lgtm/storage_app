// lib/invoice-format.ts

export { formatIDR } from './format';

export function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

// Single source of truth for print margins. A4 is 0 here because its
// margin is baked into A4Template's own p-[15mm] instead — see
// PAGE_CSS.A4 below and the screen-preview wrapper in [id]/page.tsx,
// both of which key off this to avoid ever double-margining A4.
export const MARGIN_MM: Record<string, number> = {
  THERMAL_58: 3,
  RECEIPT: 4,
  A5: 12,
  A4: 0,
};

// @page size per format — used ONLY by the headless Puppeteer PDF route
// (app/print/invoices/[id]/page.tsx -> renderPdf() -> page.pdf()).
// The in-app "Print" button no longer uses window.print() against the
// live page at all — it now downloads this same PDF and opens it in
// Chrome's PDF viewer for printing, which is what actually gave us
// reliable A5-landscape output on real printers (see invoice detail
// page's handlePrint()). So this file only has to satisfy Puppeteer's
// CDP print-to-PDF path from here on.
//
// A5 uses explicit swapped dimensions (210mm 148mm) rather than the
// `size: A5 landscape;` keyword form — Chromium's CDP printToPDF path
// (which Puppeteer's page.pdf() calls under the hood) has a known bug
// where named-size + landscape keyword is unreliably honored even with
// preferCSSPageSize: true. Explicit dims sidestep that entirely.
//
// Roll-paper widths (THERMAL_58/RECEIPT) use a generous fixed height
// since Puppeteer clips to actual content when printing to PDF with no
// fixed height — 297mm is comfortably longer than any real receipt.
export const PAGE_CSS: Record<string, string> = {
  THERMAL_58: `@page { size: 58mm 297mm; margin: ${MARGIN_MM.THERMAL_58}mm; }`,
  RECEIPT: `@page { size: 80mm 297mm; margin: ${MARGIN_MM.RECEIPT}mm; }`,
  A5: `@page { size: 210mm 148mm; margin: ${MARGIN_MM.A5}mm; }`,
  A4: `@page { size: A4; margin: ${MARGIN_MM.A4}mm; }`,
};

export const RECEIPT_CONTENT_WIDTH_MM = 80 - MARGIN_MM.RECEIPT * 2; // 72
export const IS_RECEIPT_FORMAT = (format: string) =>
  format === 'THERMAL_58' || format === 'RECEIPT';

// A5 landscape content width = 210mm page width - 2 × margin.
export const A5_CONTENT_WIDTH_MM = 210 - MARGIN_MM.A5 * 2; // 186