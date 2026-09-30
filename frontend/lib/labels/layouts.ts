// Physical label stock the print engine lays out for. All sizes in mm.
//
// Sheet presets follow the common A4 label-sheet geometries (Avery
// L7159/L7160 and the many compatible brands). Brands differ by a
// millimetre or two, which the per-device offset calibration absorbs.
// Roll presets are one label per page — the page IS the label — which is
// what thermal label printers expect.

export type LabelLayout = {
  id: string;
  kind: 'sheet' | 'roll';
  pageWidthMm: number;
  pageHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  columns: number;
  rows: number;
  marginTopMm: number;
  marginLeftMm: number;
  gapXMm: number;
  gapYMm: number;
};

function sheet(id: string, labelW: number, labelH: number, columns: number, rows: number, gapX: number, gapY = 0): LabelLayout {
  const pageW = 210;
  const pageH = 297;
  return {
    id,
    kind: 'sheet',
    pageWidthMm: pageW,
    pageHeightMm: pageH,
    labelWidthMm: labelW,
    labelHeightMm: labelH,
    columns,
    rows,
    // Sheets are centred on the page.
    marginLeftMm: (pageW - (columns * labelW + (columns - 1) * gapX)) / 2,
    marginTopMm: (pageH - (rows * labelH + (rows - 1) * gapY)) / 2,
    gapXMm: gapX,
    gapYMm: gapY,
  };
}

function roll(id: string, w: number, h: number): LabelLayout {
  return {
    id,
    kind: 'roll',
    pageWidthMm: w,
    pageHeightMm: h,
    labelWidthMm: w,
    labelHeightMm: h,
    columns: 1,
    rows: 1,
    marginTopMm: 0,
    marginLeftMm: 0,
    gapXMm: 0,
    gapYMm: 0,
  };
}

export const LABEL_LAYOUTS: LabelLayout[] = [
  sheet('a4-3x8', 63.5, 33.9, 3, 8, 2.5), // 24 per sheet (L7159-compatible)
  sheet('a4-3x7', 63.5, 38.1, 3, 7, 2.5), // 21 per sheet (L7160-compatible)
  sheet('a4-4x10', 48.5, 25.4, 4, 10, 0), // 40 per sheet
  roll('roll-50x30', 50, 30),
  roll('roll-40x30', 40, 30),
  roll('roll-60x40', 60, 40),
];

export const DEFAULT_LAYOUT_ID = 'a4-3x8';

export function getLayout(id: string | null | undefined): LabelLayout {
  return LABEL_LAYOUTS.find((l) => l.id === id) ?? LABEL_LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT_ID)!;
}

export function labelsPerPage(layout: LabelLayout) {
  return layout.columns * layout.rows;
}

// Per-device printer settings. Stored in localStorage by the labels page —
// they describe the printer attached to THIS machine, not the org.
export type PrinterSettings = {
  layoutId: string;
  dpi: 203 | 300 | 600;
  offsetXMm: number;
  offsetYMm: number;
  cutGuides: boolean;
};

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  layoutId: DEFAULT_LAYOUT_ID,
  dpi: 600,
  offsetXMm: 0,
  offsetYMm: 0,
  cutGuides: false,
};
