// The print designer's layout: a free-form page split into bands, the way
// Accurate's form designer works. Measurements are millimetres from the
// band's top-left corner (inside the page margins); font sizes are points.
//
//   pageHeader  – top of every page
//   header      – first page only, under the page header
//   (items table – grows with the lines, breaks across pages)
//   footer      – once, after the table (totals, notes, signatures)
//   pageFooter  – bottom of every page
//
// Keep in step with backend/src/print-templates/layout-validator.ts, which
// checks and rebuilds every layout before it's stored.

export type DocType = 'INVOICE' | 'QUOTATION' | 'WORK_ORDER';
export type PaperSize = 'A4' | 'A5';
export type BandKey = 'pageHeader' | 'header' | 'footer' | 'pageFooter';
export const BAND_KEYS: BandKey[] = ['pageHeader', 'header', 'footer', 'pageFooter'];

export type FontFamily = 'sans' | 'serif' | 'mono';
export type Align = 'left' | 'center' | 'right';
export type LineStyle = 'solid' | 'dashed' | 'dotted';

type ElementBase = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  // Only printed when this field has a value (e.g. a "Discount" label).
  showIf: string;
};

export type TextElement = ElementBase & {
  type: 'text';
  // Free text with {field.key} placeholders.
  text: string;
  fontFamily: FontFamily | '';
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  align: Align;
  vAlign: 'top' | 'middle' | 'bottom';
  color: string;
  // Too much text for the box: cut it off, or shrink the font to fit.
  fit: 'clip' | 'shrink';
  // Not printed when every placeholder in it is empty.
  hideIfEmpty: boolean;
};

export type ImageElement = ElementBase & {
  type: 'image';
  // 'logo' = the business logo; else an /uploads/ path from the media library.
  src: string;
  fit: 'contain' | 'cover' | 'fill';
};

export type LineElement = ElementBase & {
  type: 'line';
  thickness: number;
  color: string;
  lineStyle: LineStyle;
};

export type RectElement = ElementBase & {
  type: 'rect';
  borderWidth: number;
  borderColor: string;
  fill: string;
  radius: number;
  lineStyle: LineStyle;
};

export type LayoutElement = TextElement | ImageElement | LineElement | RectElement;
export type ElementType = LayoutElement['type'];

export type Band = { height: number; elements: LayoutElement[] };

export type ColumnKey = 'no' | 'name' | 'sku' | 'type' | 'qty' | 'unit' | 'qtyUnit' | 'price' | 'discount' | 'total';

export type TableColumn = {
  key: ColumnKey;
  label: string;
  // mm; 0 = shares what's left of the page width.
  width: number;
  align: Align;
  // Left out when no line has anything in it (e.g. prices on a job card).
  hideIfEmpty: boolean;
};

export type TableConfig = {
  columns: TableColumn[];
  fontSize: number;
  headerFontSize: number;
  headerBold: boolean;
  headerBg: string;
  headerColor: string;
  borders: 'none' | 'rows' | 'grid' | 'outer';
  borderColor: string;
  rowPadding: number;
  zebra: string;
  // Pads with blank lines, for forms that should always look the same size.
  minRows: number;
  gapBefore: number;
  gapAfter: number;
};

export type Layout = {
  version: 1;
  page: { margins: { top: number; right: number; bottom: number; left: number } };
  font: { family: FontFamily; size: number };
  bands: Record<BandKey, Band>;
  // Footer sits at the bottom of the last page instead of right under the table.
  footerAtBottom: boolean;
  table: TableConfig;
};

export type PrintTemplate = {
  id: string;
  name: string;
  docType: DocType;
  paperSize: PaperSize;
  isDefault: boolean;
  branchId: string;
  branch?: { id: string; name: string };
  layout: Layout;
  updatedAt?: string;
};

// What a print endpoint attaches: the design to draw with, or null for the
// app's built-in layout.
export type ResolvedTemplate = { id: string; name: string; paperSize: PaperSize; layout: Layout } | null;

export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  // Half an A4 sheet, landscape — printed on the top half of an A4 page,
  // the same as the built-in A5 invoice.
  A5: { w: 210, h: 148 },
};

export const FONT_STACK: Record<FontFamily, string> = {
  sans: 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

export const PX_PER_MM = 96 / 25.4;
export const PT_TO_MM = 25.4 / 72;

// Columns that hold numbers lean right by default.
export const NUMERIC_COLUMNS: ColumnKey[] = ['qty', 'price', 'discount', 'total'];

export function contentWidth(layout: Layout, paper: PaperSize) {
  return PAPER_MM[paper].w - layout.page.margins.left - layout.page.margins.right;
}

export function contentHeight(layout: Layout, paper: PaperSize) {
  return PAPER_MM[paper].h - layout.page.margins.top - layout.page.margins.bottom;
}

// Column widths in mm: fixed ones as set, the rest share what's left
// (never below 10mm each).
export function columnWidths(columns: TableColumn[], totalWidth: number): number[] {
  const fixed = columns.reduce((sum, c) => sum + (c.width > 0 ? c.width : 0), 0);
  const flex = columns.filter((c) => !(c.width > 0)).length;
  const share = flex > 0 ? Math.max(10, (totalWidth - fixed) / flex) : 0;
  return columns.map((c) => (c.width > 0 ? c.width : share));
}

let idCounter = 0;
export function newElementId() {
  idCounter += 1;
  return `e${Date.now().toString(36)}${idCounter.toString(36)}`;
}
