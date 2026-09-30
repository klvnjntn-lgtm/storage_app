'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { barRuns, planBarcode } from '@/lib/labels/barcode';
import { type LabelLayout, type PrinterSettings, getLayout, labelsPerPage } from '@/lib/labels/layouts';

export type LabelFormat = 'barcode' | 'qrcode';

export type LabelItem = {
  sku: string;
  name: string;
};

export type PrintJob = {
  items: LabelItem[];
  format: LabelFormat;
  settings: PrinterSettings;
  // Sheets only: 1-based slot to start at, so a partly used sheet can be
  // fed back in instead of wasted.
  startAt?: number;
  // Alignment test: outlines every slot so offsets can be calibrated.
  test?: boolean;
};

// Label content geometry, in mm.
const PAD = 1.5;
const SKU_FONT = 2.8;
const NAME_FONT = 2.2;
const MAX_BAR_HEIGHT = 15;

// What a label will actually print as. A barcode that can't be encoded
// (non-ASCII SKU) or would be too fine to scan at this size/resolution
// falls back to QR rather than printing something unreadable.
export function resolveLabelFormat(item: LabelItem, format: LabelFormat, layout: LabelLayout, dpi: number) {
  if (format === 'qrcode') return { printAs: 'qrcode' as const, plan: null, reason: null };
  const plan = planBarcode(item.sku, layout.labelWidthMm - 2 * PAD, dpi);
  if (!plan) return { printAs: 'qrcode' as const, plan: null, reason: 'unencodable' as const };
  if (!plan.scannable) return { printAs: 'qrcode' as const, plan, reason: 'tooLong' as const };
  return { printAs: 'barcode' as const, plan, reason: null };
}

const textLine = (fontMm: number, bold = false): React.CSSProperties => ({
  fontSize: `${fontMm}mm`,
  lineHeight: 1.15,
  fontWeight: bold ? 700 : 400,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  margin: 0,
  color: '#000',
});

/**
 * One label, drawn in real millimetres. `pageXMm` is where the label's left
 * edge sits on the printed page — used to snap the barcode's first bar to a
 * whole printer dot so every bar rasterises to the same number of dots.
 */
export function LabelFace({
  item,
  format,
  layout,
  dpi,
  pageXMm = 0,
  outline = false,
}: {
  item: LabelItem;
  format: LabelFormat;
  layout: LabelLayout;
  dpi: number;
  pageXMm?: number;
  outline?: boolean;
}) {
  const w = layout.labelWidthMm;
  const h = layout.labelHeightMm;
  const { printAs, plan } = resolveLabelFormat(item, format, layout, dpi);

  const box: React.CSSProperties = {
    position: 'relative',
    width: `${w}mm`,
    height: `${h}mm`,
    overflow: 'hidden',
    boxSizing: 'border-box',
    background: '#fff',
    fontFamily: 'Arial, Helvetica, sans-serif',
    outline: outline ? '0.2mm dashed #999' : undefined,
    outlineOffset: '-0.2mm',
  };

  if (printAs === 'barcode' && plan) {
    // Text block + bars, centred vertically on the label.
    const textHeight = SKU_FONT * 1.15 + NAME_FONT * 1.15 + 0.8;
    const barsHeight = Math.min(h - 2 * PAD - textHeight, MAX_BAR_HEIGHT);
    const textTop = (h - textHeight - barsHeight) / 2;
    const barsTop = textTop + textHeight;
    const dot = 25.4 / dpi;
    const centredX = (w - plan.symbolWidthMm) / 2;
    const x = Math.round((pageXMm + centredX) / dot) * dot - pageXMm;
    const count = plan.modules.length;

    return (
      <div style={box}>
        <div style={{ position: 'absolute', top: `${textTop}mm`, left: `${PAD}mm`, right: `${PAD}mm`, textAlign: 'center' }}>
          <p style={textLine(SKU_FONT, true)}>{item.sku}</p>
          <p style={textLine(NAME_FONT)}>{item.name}</p>
        </div>
        <svg
          style={{ position: 'absolute', left: `${x}mm`, top: `${barsTop}mm`, width: `${plan.symbolWidthMm}mm`, height: `${barsHeight}mm` }}
          viewBox={`0 0 ${count} 1`}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
          aria-label={item.sku}
        >
          {barRuns(plan.modules).map(([start, width]) => (
            <rect key={start} x={start} y={0} width={width} height={1} fill="#000" />
          ))}
        </svg>
      </div>
    );
  }

  const side = Math.max(Math.min(h - 2 * PAD, w * 0.45, 22), 7);
  return (
    <div style={box}>
      <div style={{ position: 'absolute', top: `${(h - side) / 2}mm`, left: `${PAD}mm`, width: `${side}mm`, height: `${side}mm` }}>
        <QRCodeSVG value={item.sku} level="M" marginSize={2} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: `${PAD * 2 + side}mm`,
          right: `${PAD}mm`,
          top: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* The SKU is what a person reads off the label, so it wraps
            rather than being cut off. */}
        <p style={{ ...textLine(SKU_FONT, true), whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{item.sku}</p>
        <p
          style={{
            ...textLine(NAME_FONT),
            whiteSpace: 'normal',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {item.name}
        </p>
      </div>
    </div>
  );
}

export type PlacedLabel = { item: LabelItem; xMm: number; yMm: number };

export function paginate(job: PrintJob, layout: LabelLayout): PlacedLabel[][] {
  const { offsetXMm, offsetYMm } = job.settings;
  if (layout.kind === 'roll') {
    return job.items.map((item) => [{ item, xMm: offsetXMm, yMm: offsetYMm }]);
  }

  const perPage = labelsPerPage(layout);
  const slotOf = (i: number) => {
    const col = i % layout.columns;
    const row = Math.floor(i / layout.columns) % layout.rows;
    return {
      xMm: layout.marginLeftMm + col * (layout.labelWidthMm + layout.gapXMm) + offsetXMm,
      yMm: layout.marginTopMm + row * (layout.labelHeightMm + layout.gapYMm) + offsetYMm,
    };
  };

  const pages: PlacedLabel[][] = [];
  const skip = Math.min(Math.max((job.startAt ?? 1) - 1, 0), perPage - 1);
  job.items.forEach((item, i) => {
    const slot = i + skip;
    const pageIndex = Math.floor(slot / perPage);
    (pages[pageIndex] ??= []).push({ item, ...slotOf(slot % perPage) });
  });
  return pages;
}

/**
 * Print-only label pages, rendered into a portal directly under <body>.
 * Printing hides every other child of <body> with display:none — not
 * visibility:hidden, which kept the (invisible) app layout in the flow and
 * printed two extra blank pages (a wasted label or two on a roll printer)
 * after every job.
 *
 * `@page` is set to the physical page — the whole A4 sheet, or a single
 * label for roll printers — with zero margin, and every label is placed at
 * absolute millimetre positions. In the print dialog, choose that paper
 * size, margins "None" and scale 100% ("Actual size"); "Fit to page"
 * rescales everything and breaks both alignment and bar widths.
 */
export default function PrintLabels({ job, onDone }: { job: PrintJob | null; onDone: () => void }) {
  // Portals need document.body, which only exists on the client.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const layout = useMemo(() => (job ? getLayout(job.settings.layoutId) : null), [job]);
  const pages = useMemo(() => (job && layout ? paginate(job, layout) : []), [job, layout]);

  // Open the dialog only once the pages are in the DOM (everything here
  // renders synchronously — no async barcode drawing to wait for).
  useEffect(() => {
    if (!job) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => window.print());
    });
    const done = () => onDone();
    window.addEventListener('afterprint', done, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', done);
    };
  }, [job, onDone]);

  if (!mounted || !job || !layout) return null;

  return createPortal(<PrintPages job={job} layout={layout} pages={pages} />, document.body);
}

// The printable pages themselves — split out from the portal/print
// plumbing above so it can be rendered on its own (and tested headless).
export function PrintPages({ job, layout, pages }: { job: PrintJob; layout: LabelLayout; pages: PlacedLabel[][] }) {
  return (
    <div id="label-print-root">
      <style>{`
        #label-print-root { display: none; }
        @media print {
          @page { size: ${layout.pageWidthMm}mm ${layout.pageHeightMm}mm; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          body > *:not(#label-print-root) { display: none !important; }
          #label-print-root { display: block; }
          #label-print-root .lp-page {
            position: relative;
            width: ${layout.pageWidthMm}mm;
            height: ${layout.pageHeightMm}mm;
            overflow: hidden;
            break-after: page;
            page-break-after: always;
          }
          #label-print-root .lp-page:last-child { break-after: auto; page-break-after: auto; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      {pages.map((placed, p) => (
        <div className="lp-page" key={p}>
          {placed.map(({ item, xMm, yMm }, i) => (
            <div key={i} style={{ position: 'absolute', left: `${xMm}mm`, top: `${yMm}mm` }}>
              <LabelFace
                item={item}
                format={job.format}
                layout={layout}
                dpi={job.settings.dpi}
                pageXMm={xMm}
                outline={job.test || job.settings.cutGuides}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

