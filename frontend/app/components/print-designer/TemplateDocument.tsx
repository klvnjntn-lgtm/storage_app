'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PrintData, PrintRow } from '@/lib/print-designer/context';
import {
  PAPER_MM,
  PX_PER_MM,
  columnWidths,
  contentHeight,
  contentWidth,
  type Band,
  type Layout,
  type PaperSize,
} from '@/lib/print-designer/types';
import { ElementView, isElementVisible } from './ElementView';
import { ItemsTable } from './ItemsTable';

// Slack so rounding never pushes a row past the page edge.
const SAFETY_MM = 0.6;

export type PagePlan = {
  rows: [number, number]; // [start, end) into the row list
  table: boolean;
  header: boolean;
  footerTop: number | null; // mm from the content top, when the footer is on this page
};

// Splits the table across pages. Every page has the page header and page
// footer; the first also has the header band. Rows fill each page; the
// footer follows the last row, or starts a page of its own when it won't fit.
export function paginate(layout: Layout, paper: PaperSize, headHeight: number, rowHeights: number[]): PagePlan[] {
  const { pageHeader, header, footer, pageFooter } = layout.bands;
  const { gapBefore, gapAfter } = layout.table;
  const bottom = contentHeight(layout, paper) - pageFooter.height - SAFETY_MM;
  const pages: PagePlan[] = [];
  let i = 0;
  let first = true;
  let used = 0;
  do {
    const top = pageHeader.height + (first ? header.height : 0);
    let y = top + gapBefore + headHeight;
    const start = i;
    while (i < rowHeights.length && (y + rowHeights[i] <= bottom || i === start)) {
      y += rowHeights[i];
      i += 1;
    }
    pages.push({ rows: [start, i], table: true, header: first, footerTop: null });
    used = y;
    first = false;
  } while (i < rowHeights.length);

  const last = pages[pages.length - 1];
  const footerY = used + gapAfter;
  if (footer.height === 0 || footerY + footer.height <= bottom + SAFETY_MM) {
    last.footerTop = layout.footerAtBottom ? bottom + SAFETY_MM - footer.height : footerY;
  } else {
    pages.push({
      rows: [0, 0],
      table: false,
      header: false,
      footerTop: layout.footerAtBottom ? bottom + SAFETY_MM - footer.height : pageHeader.height,
    });
  }
  return pages;
}

function BandView({
  band,
  top,
  values,
  data,
  layout,
}: {
  band: Band;
  top: number;
  values: Record<string, string>;
  data: PrintData;
  layout: Layout;
}) {
  if (band.height === 0 && band.elements.length === 0) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: `${top}mm`, height: `${band.height}mm` }}>
      {band.elements
        .filter((el) => isElementVisible(el, values))
        .map((el) => (
          <ElementView key={el.id} el={el} values={values} logoUrl={data.logoUrl} baseFamily={layout.font.family} />
        ))}
    </div>
  );
}

export function useTableColumns(layout: Layout, paper: PaperSize, rows: PrintRow[]) {
  return useMemo(() => {
    const columns = layout.table.columns.filter((c) => !c.hideIfEmpty || rows.some((r) => r[c.key]));
    const shown = columns.length > 0 ? columns : layout.table.columns.slice(0, 1);
    return { columns: shown, widths: columnWidths(shown, contentWidth(layout, paper)) };
  }, [layout, paper, rows]);
}

// A whole document drawn from a design: measured, split into pages, and
// printed one page per sheet. While it's measuring the root carries
// data-print-pending, which the PDF renderer waits on.
export function TemplateDocument({
  layout,
  paper,
  data,
  pageGap = 0,
  onPageCount,
}: {
  layout: Layout;
  paper: PaperSize;
  data: PrintData;
  // Space between pages on screen (mm); print always breaks per page.
  pageGap?: number;
  onPageCount?: (n: number) => void;
}) {
  const { columns, widths } = useTableColumns(layout, paper, data.rows);
  const rows = useMemo<(PrintRow | null)[]>(() => {
    const pad = Math.max(0, layout.table.minRows - data.rows.length);
    return [...data.rows, ...Array<null>(pad).fill(null)];
  }, [data.rows, layout.table.minRows]);

  const measureRef = useRef<HTMLTableElement>(null);
  const [plan, setPlan] = useState<PagePlan[] | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      const table = measureRef.current;
      if (!table || cancelled) return;
      // getBoundingClientRect keeps fractions. The table's width is known in
      // mm, so it calibrates px→mm whatever zoom or scale the page sits in.
      const widthMm = widths.reduce((a, b) => a + b, 0);
      const pxPerMm = widthMm > 0 ? table.getBoundingClientRect().width / widthMm : PX_PER_MM;
      const mm = (el: Element) => el.getBoundingClientRect().height / (pxPerMm || PX_PER_MM);
      const head = table.querySelector('[data-head]');
      const heights = [...table.querySelectorAll('[data-row]')].map(mm);
      const next = paginate(layout, paper, head ? mm(head) : 0, heights);
      setPlan(next);
      onPageCount?.(next.length);
    };
    measure();
    // Web fonts can land after the first layout and change line breaks.
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // onPageCount is a notification only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, paper, rows, columns, widths]);

  const paperMm = PAPER_MM[paper];
  const { margins } = layout.page;
  const innerH = contentHeight(layout, paper);
  const count = plan?.length ?? 0;

  return (
    <div data-print-document="" {...(!plan && { 'data-print-pending': '' })} style={{ color: '#000000' }}>
      <style>{'@media print { [data-print-page] { margin: 0 !important; box-shadow: none !important; } }'}</style>
      {/* Hidden copy the pagination measures. */}
      {/* Zero-sized and clipped, so a long table never adds blank printed pages. */}
      <div aria-hidden style={{ position: 'relative', height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }}>
        <ItemsTable ref={measureRef} config={layout.table} columns={columns} widths={widths} rows={rows} family={layout.font.family} />
      </div>

      {plan?.map((page, p) => {
        const values = { ...data.fields, 'page.number': String(p + 1), 'page.count': String(count) };
        const tableTop = layout.bands.pageHeader.height + (page.header ? layout.bands.header.height : 0) + layout.table.gapBefore;
        return (
          <div
            key={p}
            data-print-page=""
            style={{
              position: 'relative',
              width: `${paperMm.w}mm`,
              height: `${paperMm.h}mm`,
              background: '#ffffff',
              overflow: 'hidden',
              boxSizing: 'border-box',
              breakAfter: p < count - 1 ? 'page' : 'auto',
              marginBottom: p < count - 1 && pageGap ? `${pageGap}mm` : 0,
              boxShadow: pageGap ? '0 1px 3px rgba(0,0,0,0.1), 0 8px 24px rgba(0,0,0,0.12)' : undefined,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: `${margins.left}mm`,
                top: `${margins.top}mm`,
                width: `${contentWidth(layout, paper)}mm`,
                height: `${innerH}mm`,
              }}
            >
              <BandView band={layout.bands.pageHeader} top={0} values={values} data={data} layout={layout} />
              {page.header && (
                <BandView band={layout.bands.header} top={layout.bands.pageHeader.height} values={values} data={data} layout={layout} />
              )}
              {page.table && (
                <div style={{ position: 'absolute', left: 0, top: `${tableTop}mm` }}>
                  <ItemsTable
                    config={layout.table}
                    columns={columns}
                    widths={widths}
                    rows={rows.slice(page.rows[0], page.rows[1])}
                    offset={page.rows[0]}
                    family={layout.font.family}
                  />
                </div>
              )}
              {page.footerTop != null && (
                <BandView band={layout.bands.footer} top={page.footerTop} values={values} data={data} layout={layout} />
              )}
              <BandView
                band={layout.bands.pageFooter}
                top={innerH - layout.bands.pageFooter.height}
                values={values}
                data={data}
                layout={layout}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
