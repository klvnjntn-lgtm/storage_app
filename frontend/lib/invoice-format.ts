// lib/invoice-format.ts
export { formatIDR } from './format';

export function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

// @page size per format. Roll-paper widths use a generous height since
// Puppeteer clips to actual content when printing to PDF with no fixed height.
export const PAGE_CSS: Record<string, string> = {
  THERMAL_58: '@page { size: 58mm 297mm; margin: 3mm; }',
  RECEIPT: '@page { size: 80mm 297mm; margin: 4mm; }',
  A5: '@page { size: A5 landscape; margin: 12mm; }',
  A4: '@page { size: A4; margin: 0mm; }',
};

export const IS_RECEIPT_FORMAT = (format: string) =>
  format === 'THERMAL_58' || format === 'RECEIPT';

// A5 landscape content width = 210mm page width - 2 × 12mm margin.
// Kept as a named export so A5Template doesn't hardcode a number that
// silently drifts if the margin above ever changes.
export const A5_CONTENT_WIDTH_MM = 210 - 12 * 2; // 186