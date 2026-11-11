import { BadRequestException } from '@nestjs/common';

// The print designer's layout JSON, checked and rebuilt key by key before
// it is stored: unknown keys are dropped, numbers clamped to the page,
// strings capped. The frontend renders it with React only (no raw HTML),
// and image sources are limited to the business logo or this app's own
// uploads, so a stored layout can't carry markup or point the PDF renderer
// at another site. Keep in step with frontend/lib/print-designer/types.ts.

export const PAPER_SIZES = ['A4', 'A5'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

const BAND_KEYS = ['pageHeader', 'header', 'footer', 'pageFooter'] as const;
const ELEMENT_TYPES = ['text', 'image', 'line', 'rect'] as const;
const FONT_FAMILIES = ['sans', 'serif', 'mono'] as const;
const ALIGNS = ['left', 'center', 'right'] as const;
const V_ALIGNS = ['top', 'middle', 'bottom'] as const;
const FITS = ['clip', 'shrink'] as const;
const IMAGE_FITS = ['contain', 'cover', 'fill'] as const;
const BORDER_STYLES = ['none', 'rows', 'grid', 'outer'] as const;
const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
const COLUMN_KEYS = ['no', 'name', 'sku', 'type', 'qty', 'unit', 'qtyUnit', 'price', 'discount', 'total'] as const;

const MAX_ELEMENTS_PER_BAND = 150;
const MAX_COLUMNS = 12;
const MAX_TEXT = 2000;
const MAX_LAYOUT_BYTES = 256 * 1024;
const MAX_MM = 400;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const UPLOAD_SRC = /^\/uploads\/[A-Za-z0-9._\-/]{1,300}$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
}

function oneOf<T extends readonly string[]>(v: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function color(v: unknown, fallback: string): string {
  return typeof v === 'string' && (v === '' || COLOR.test(v)) ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function id(v: unknown, index: number): string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : `el${index}`;
}

function element(raw: unknown, index: number) {
  if (!isObj(raw)) return null;
  const type = oneOf(raw.type, ELEMENT_TYPES, 'text');
  const base = {
    id: id(raw.id, index),
    type,
    x: num(raw.x, -MAX_MM, MAX_MM, 0),
    y: num(raw.y, -MAX_MM, MAX_MM, 0),
    w: num(raw.w, 0, MAX_MM, 40),
    h: num(raw.h, 0, MAX_MM, 6),
    showIf: str(raw.showIf, 60),
  };
  if (type === 'text') {
    return {
      ...base,
      text: str(raw.text, MAX_TEXT),
      fontFamily: raw.fontFamily === '' ? '' : oneOf(raw.fontFamily, FONT_FAMILIES, 'sans'),
      fontSize: num(raw.fontSize, 4, 72, 9),
      bold: bool(raw.bold),
      italic: bool(raw.italic),
      underline: bool(raw.underline),
      uppercase: bool(raw.uppercase),
      align: oneOf(raw.align, ALIGNS, 'left'),
      vAlign: oneOf(raw.vAlign, V_ALIGNS, 'top'),
      color: color(raw.color, '#000000'),
      fit: oneOf(raw.fit, FITS, 'shrink'),
      hideIfEmpty: bool(raw.hideIfEmpty, true),
    };
  }
  if (type === 'image') {
    const src = raw.src === 'logo' ? 'logo' : typeof raw.src === 'string' && UPLOAD_SRC.test(raw.src) && !raw.src.includes('..') ? raw.src : 'logo';
    return { ...base, src, fit: oneOf(raw.fit, IMAGE_FITS, 'contain') };
  }
  if (type === 'line') {
    return {
      ...base,
      thickness: num(raw.thickness, 0.1, 5, 0.3),
      color: color(raw.color, '#000000'),
      lineStyle: oneOf(raw.lineStyle, LINE_STYLES, 'solid'),
    };
  }
  return {
    ...base,
    borderWidth: num(raw.borderWidth, 0, 5, 0.3),
    borderColor: color(raw.borderColor, '#000000'),
    fill: color(raw.fill, ''),
    radius: num(raw.radius, 0, 20, 0),
    lineStyle: oneOf(raw.lineStyle, LINE_STYLES, 'solid'),
  };
}

function band(raw: unknown, pageHeight: number) {
  const b = isObj(raw) ? raw : {};
  const list = Array.isArray(b.elements) ? b.elements.slice(0, MAX_ELEMENTS_PER_BAND) : [];
  return {
    height: num(b.height, 0, pageHeight, 0),
    elements: list.map(element).filter((e): e is NonNullable<ReturnType<typeof element>> => e !== null),
  };
}

function column(raw: unknown) {
  if (!isObj(raw)) return null;
  return {
    key: oneOf(raw.key, COLUMN_KEYS, 'name'),
    label: str(raw.label, 60),
    width: num(raw.width, 0, 200, 0),
    align: oneOf(raw.align, ALIGNS, 'left'),
    hideIfEmpty: bool(raw.hideIfEmpty),
  };
}

export function paperHeightMm(paper: PaperSize) {
  return paper === 'A5' ? 148 : 297;
}

export function validateLayout(raw: unknown, paper: PaperSize) {
  if (!isObj(raw)) throw new BadRequestException('Layout is missing');
  if (JSON.stringify(raw).length > MAX_LAYOUT_BYTES) throw new BadRequestException('Layout is too large');
  const pageHeight = paperHeightMm(paper);
  const page = isObj(raw.page) ? raw.page : {};
  const margins = isObj(page.margins) ? page.margins : {};
  const font = isObj(raw.font) ? raw.font : {};
  const bands = isObj(raw.bands) ? raw.bands : {};
  const table = isObj(raw.table) ? raw.table : {};
  const columns = (Array.isArray(table.columns) ? table.columns.slice(0, MAX_COLUMNS) : [])
    .map(column)
    .filter((c): c is NonNullable<ReturnType<typeof column>> => c !== null);
  if (columns.length === 0) throw new BadRequestException('The items table needs at least one column');

  return {
    version: 1,
    page: {
      margins: {
        top: num(margins.top, 0, 50, 10),
        right: num(margins.right, 0, 50, 10),
        bottom: num(margins.bottom, 0, 50, 10),
        left: num(margins.left, 0, 50, 10),
      },
    },
    font: { family: oneOf(font.family, FONT_FAMILIES, 'sans'), size: num(font.size, 5, 20, 9) },
    bands: Object.fromEntries(BAND_KEYS.map((k) => [k, band(bands[k], pageHeight)])),
    footerAtBottom: bool(raw.footerAtBottom),
    table: {
      columns,
      fontSize: num(table.fontSize, 5, 16, 8.5),
      headerFontSize: num(table.headerFontSize, 5, 16, 8.5),
      headerBold: bool(table.headerBold, true),
      headerBg: color(table.headerBg, ''),
      headerColor: color(table.headerColor, '#000000'),
      borders: oneOf(table.borders, BORDER_STYLES, 'rows'),
      borderColor: color(table.borderColor, '#999999'),
      rowPadding: num(table.rowPadding, 0, 6, 1.5),
      zebra: color(table.zebra, ''),
      minRows: Math.round(num(table.minRows, 0, 60, 0)),
      gapBefore: num(table.gapBefore, 0, 50, 2),
      gapAfter: num(table.gapAfter, 0, 50, 3),
    },
  };
}

export type PrintLayout = ReturnType<typeof validateLayout>;
