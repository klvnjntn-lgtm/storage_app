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

// @page size per format. Roll-paper widths use a generous height since
// Puppeteer clips to actual content when printing to PDF with no fixed height.
// lib/invoice-format.ts
export const PAGE_CSS: Record<string, string> = {
  THERMAL_58: `@page { size: 58mm 297mm; margin: ${MARGIN_MM.THERMAL_58}mm; }`,
  RECEIPT: `@page { size: 80mm 297mm; margin: ${MARGIN_MM.RECEIPT}mm; }`,
  A5: `@page { size: 210mm 148mm; margin: ${MARGIN_MM.A5}mm; }`, // was: A5 landscape
  A4: `@page { size: A4; margin: ${MARGIN_MM.A4}mm; }`,
};

export const RECEIPT_CONTENT_WIDTH_MM = 80 - MARGIN_MM.RECEIPT * 2; // 72
export const IS_RECEIPT_FORMAT = (format: string) =>
  format === 'THERMAL_58' || format === 'RECEIPT';

// A5 landscape content width = 210mm page width - 2 × margin.
export const A5_CONTENT_WIDTH_MM = 210 - MARGIN_MM.A5 * 2; // 186