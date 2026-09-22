// lib/mappers/invoice-format.ts

export { formatIDR } from '../format';

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

// A4 physical dimensions. Used both as the A4 page size itself, and as
// the PDF canvas that A5 is now centered inside (see A5 case below) —
// so any A4-capable printer (virtually all of them) produces correct
// A5 output without the user having to touch driver/paper-size dialogs.
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

// Physical A5-landscape sheet dimensions. Landscape width matches A4's
// width exactly, so only vertical centering is needed inside the A4
// canvas — horizontal margin is 0.
export const A5_SHEET_WIDTH_MM = 210;
export const A5_SHEET_HEIGHT_MM = 148;

// Top/bottom margin to center the A5 sheet vertically within the A4
// canvas: (297 - 148) / 2.
export const A5_ON_A4_MARGIN_TOP_MM = (A4_HEIGHT_MM - A5_SHEET_HEIGHT_MM) / 2; // 74.5

// @page size per format — used ONLY by the headless Puppeteer PDF route
// (app/print/invoices/[id]/page.tsx -> renderPdf() -> page.pdf()).
// The in-app "Print" button doesn't use window.print() against the live
// page — it downloads this same PDF and opens it in Chrome's PDF viewer
// for printing. So this file only has to satisfy Puppeteer's CDP
// print-to-PDF path from here on.
//
// CHANGED — A5's @page size is now A4, not a bare 210x148 sheet. Many
// printer drivers don't expose A5 as a selectable paper size at all, so
// a PDF page literally sized 210x148 could still get silently rescaled
// or mis-fit depending on the user's local print dialog. Rendering onto
// a full A4 canvas with the A5 content centered inside it (see the
// wrapper in app/print/invoices/[id]/page.tsx) means any A4-capable
// printer — i.e. essentially all of them — reproduces it correctly with
// zero manual "fit to page" steps required from the user. Physical A5
// paper stacking under an A4 print job is then just an optional refinement,
// not a requirement.
//
// Roll-paper widths (THERMAL_58/RECEIPT) use a generous fixed height
// since Puppeteer clips to actual content when printing to PDF with no
// fixed height — 297mm is comfortably longer than any real receipt.
export const PAGE_CSS: Record<string, string> = {
  THERMAL_58: `@page { size: 58mm 297mm; margin: ${MARGIN_MM.THERMAL_58}mm; }`,
  RECEIPT: `@page { size: 80mm 297mm; margin: ${MARGIN_MM.RECEIPT}mm; }`,
  A5: `@page { size: A4; margin: ${A5_ON_A4_MARGIN_TOP_MM}mm ${MARGIN_MM.A5}mm; }`,
  A4: `@page { size: A4; margin: ${MARGIN_MM.A4}mm; }`,
};

export const RECEIPT_CONTENT_WIDTH_MM = 80 - MARGIN_MM.RECEIPT * 2; // 72
export const IS_RECEIPT_FORMAT = (format: string) =>
  format === 'THERMAL_58' || format === 'RECEIPT';


// A5 landscape content width = 210mm sheet width - 2 × margin. This is
// unchanged — it still describes the A5Template's own inner content
// width, independent of the A4 canvas it now sits centered inside.
export const A5_CONTENT_WIDTH_MM = 210 - MARGIN_MM.A5 * 2; // 186