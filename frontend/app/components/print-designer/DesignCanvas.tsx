'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { ElementView } from './ElementView';
import { ItemsTable } from './ItemsTable';
import { useTableColumns } from './TemplateDocument';
import type { PrintRow } from '@/lib/print-designer/context';
import {
  BAND_KEYS,
  PAPER_MM,
  PX_PER_MM,
  contentHeight,
  contentWidth,
  type BandKey,
  type Layout,
  type LayoutElement,
  type PaperSize,
} from '@/lib/print-designer/types';

export type Selection = { kind: 'elements'; band: BandKey; ids: string[] } | { kind: 'table' } | { kind: 'band'; band: BandKey } | null;

type Guides = { x: number[]; y: number[] };
type Box = { x: number; y: number; w: number; h: number };

// What the palette drops: a field, or a new box of some kind.
export type DropPayload = { field: string } | { add: 'text' | 'hline' | 'vline' | 'rect' | 'logo' | 'image' };
export const DRAG_MIME = 'application/x-waresys-print';

const SNAP_MM = 1.2;
const DRAG_START_PX = 3;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

const round = (n: number, step: number) => Math.round(n / step) * step;
const clean = (n: number) => Math.round(n * 100) / 100;

export function DesignCanvas({
  layout,
  paper,
  zoom,
  values,
  logoUrl,
  rows,
  selection,
  snap,
  grid,
  showGrid,
  bandLabels,
  onSelect,
  onDrop,
  history,
  marqueeStartRef,
}: {
  layout: Layout;
  paper: PaperSize;
  zoom: number;
  values: Record<string, string>;
  logoUrl: string | null;
  rows: PrintRow[];
  selection: Selection;
  snap: boolean;
  grid: number;
  showGrid: boolean;
  bandLabels: Record<BandKey | 'table', string>;
  onSelect: (s: Selection) => void;
  onDrop: (band: BandKey, x: number, y: number, payload: DropPayload) => void;
  history: { begin: () => void; preview: (fn: (l: Layout) => Layout) => void };
  marqueeStartRef?: RefObject<((e: ReactPointerEvent) => void) | null>;
}) {
  const W = contentWidth(layout, paper);
  const H = contentHeight(layout, paper);
  const { margins } = layout.page;
  const pxPerMm = PX_PER_MM * zoom;
  const bandRefs = useRef<Partial<Record<BandKey, HTMLDivElement | null>>>({});
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [guides, setGuides] = useState<Guides>({ x: [], y: [] });
  const [marquee, setMarquee] = useState<Box | null>(null);
  const { columns, widths } = useTableColumns(layout, paper, rows);

  const selectedIds = selection?.kind === 'elements' ? selection.ids : [];
  const selectedBand = selection?.kind === 'elements' ? selection.band : null;

  // Pointer → mm inside a band.
  const toBandMm = (band: BandKey, clientX: number, clientY: number) => {
    const rect = bandRefs.current[band]?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / pxPerMm, y: (clientY - rect.top) / pxPerMm };
  };

  const bandAt = (clientX: number, clientY: number): BandKey | null => {
    for (const band of BAND_KEYS) {
      const rect = bandRefs.current[band]?.getBoundingClientRect();
      if (rect && clientY >= rect.top && clientY <= rect.bottom && clientX >= rect.left - 40 && clientX <= rect.right + 40) return band;
    }
    return null;
  };

  // Snap a moving edge set to another element's edges, the band's edges or
  // centre, else to the grid. Returns the shift to apply and the guide hit.
  function snapAxis(edges: number[], targets: number[]): { shift: number; guide: number | null } {
    let best: { shift: number; guide: number } | null = null;
    for (const e of edges) {
      for (const t of targets) {
        const d = t - e;
        if (Math.abs(d) <= SNAP_MM / Math.max(zoom, 0.5) && (!best || Math.abs(d) < Math.abs(best.shift))) best = { shift: d, guide: t };
      }
    }
    if (best) return best;
    return { shift: round(edges[0], grid) - edges[0], guide: null };
  }

  function startMove(e: ReactPointerEvent, band: BandKey, el: LayoutElement) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let ids = selectedBand === band ? selectedIds : [];
    if (additive) {
      ids = ids.includes(el.id) ? ids.filter((i) => i !== el.id) : [...ids, el.id];
      onSelect(ids.length ? { kind: 'elements', band, ids } : null);
      return;
    }
    if (!ids.includes(el.id)) ids = [el.id];
    onSelect({ kind: 'elements', band, ids });

    const origin = new Map(layout.bands[band].elements.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y }]));
    const others = layout.bands[band].elements.filter((x) => !ids.includes(x.id));
    const bandH = layout.bands[band].height;
    const xTargets = [0, W / 2, W, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
    const yTargets = [0, bandH / 2, bandH, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    let target: BandKey = band;

    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_START_PX) return;
        started = true;
        history.begin();
      }
      let dx = (ev.clientX - sx) / pxPerMm;
      let dy = (ev.clientY - sy) / pxPerMm;
      const g: Guides = { x: [], y: [] };
      if (snap && !ev.altKey) {
        const o = origin.get(el.id)!;
        const nx = o.x + dx;
        const ny = o.y + dy;
        const sxr = snapAxis([nx, nx + el.w / 2, nx + el.w], xTargets);
        const syr = snapAxis([ny, ny + el.h / 2, ny + el.h], yTargets);
        dx += sxr.shift;
        dy += syr.shift;
        if (sxr.guide != null) g.x.push(sxr.guide);
        if (syr.guide != null) g.y.push(syr.guide);
      }
      setGuides(g);
      target = bandAt(ev.clientX, ev.clientY) ?? band;
      history.preview((l) => ({
        ...l,
        bands: {
          ...l.bands,
          [band]: {
            ...l.bands[band],
            elements: l.bands[band].elements.map((x) => {
              const o = origin.get(x.id);
              return o ? { ...x, x: clean(o.x + dx), y: clean(o.y + dy) } : x;
            }),
          },
        },
      }));
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGuides({ x: [], y: [] });
      if (!started || target === band) return;
      // Dropped over another band: move the boxes there, same place on the page.
      const fromTop = bandRefs.current[band]?.getBoundingClientRect().top ?? 0;
      const toTop = bandRefs.current[target]?.getBoundingClientRect().top ?? 0;
      const shift = (fromTop - toTop) / pxPerMm;
      const to = target;
      history.preview((l) => {
        const moving = l.bands[band].elements.filter((x) => ids.includes(x.id)).map((x) => ({ ...x, y: clean(x.y + shift) }));
        return {
          ...l,
          bands: {
            ...l.bands,
            [band]: { ...l.bands[band], elements: l.bands[band].elements.filter((x) => !ids.includes(x.id)) },
            [to]: { ...l.bands[to], elements: [...l.bands[to].elements, ...moving] },
          },
        };
      });
      onSelect({ kind: 'elements', band: to, ids });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Pointer → mm inside the content area (all bands stacked), so the box
  // stays put if the page scrolls mid-drag.
  const toContentMm = (clientX: number, clientY: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / pxPerMm, y: (clientY - rect.top) / pxPerMm };
  };

  // Boxes touched by a rectangle (in content mm), per band. Touching is
  // enough, as in Windows Explorer — no need to enclose a box fully.
  function boxesIn(r: Box): Partial<Record<BandKey, string[]>> {
    const content = contentRef.current?.getBoundingClientRect();
    const out: Partial<Record<BandKey, string[]>> = {};
    if (!content) return out;
    for (const band of BAND_KEYS) {
      const rect = bandRefs.current[band]?.getBoundingClientRect();
      if (!rect) continue;
      const top = (rect.top - content.top) / pxPerMm;
      const ids = layout.bands[band].elements
        .filter((el) => {
          const ey = top + el.y;
          return el.x < r.x + r.w && el.x + Math.max(el.w, 0.5) > r.x && ey < r.y + r.h && ey + Math.max(el.h, 0.5) > r.y;
        })
        .map((el) => el.id);
      if (ids.length) out[band] = ids;
    }
    return out;
  }

  // Drag on empty space draws a selection rectangle. A selection holds one
  // band's boxes, so it takes the band the drag started in, else the band it
  // catches most boxes from. Shift/Ctrl adds to the current selection.
  function startMarquee(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive && selection?.kind === 'elements' ? selection : null;
    const startBand = bandAt(e.clientX, e.clientY);
    const start = toContentMm(e.clientX, e.clientY);
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;

    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_START_PX) return;
        started = true;
      }
      const p = toContentMm(ev.clientX, ev.clientY);
      const r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      setMarquee(r);
      const hits = boxesIn(r);
      let band: BandKey | null = base?.band ?? null;
      if (!band) {
        if (startBand && hits[startBand]) band = startBand;
        else for (const k of BAND_KEYS) if (hits[k] && (!band || hits[k].length > hits[band]!.length)) band = k;
      }
      const ids = band ? [...new Set([...(base?.ids ?? []), ...(hits[band] ?? [])])] : [];
      onSelect(band && ids.length ? { kind: 'elements', band, ids } : null);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setMarquee(null);
      // A plain click on empty space clears the selection.
      if (!started && !additive) onSelect(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // Let the editor start a rectangle from the grey area around the page too.
  useEffect(() => {
    if (marqueeStartRef) marqueeStartRef.current = startMarquee;
  });

  function startResize(e: ReactPointerEvent, band: BandKey, el: LayoutElement, handle: Handle) {
    e.stopPropagation();
    e.preventDefault();
    const o = { x: el.x, y: el.y, w: el.w, h: el.h };
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    const minW = el.type === 'line' && el.w < el.h ? 0 : 1;
    const minH = el.type === 'line' && el.w >= el.h ? 0 : 1;
    const step = snap ? grid : 0.1;
    const move = (ev: PointerEvent) => {
      if (!started) {
        started = true;
        history.begin();
      }
      const dx = (ev.clientX - sx) / pxPerMm;
      const dy = (ev.clientY - sy) / pxPerMm;
      let { x, y, w, h } = o;
      if (handle.includes('e')) w = Math.max(minW, round(o.x + o.w + dx, step) - o.x);
      if (handle.includes('s')) h = Math.max(minH, round(o.y + o.h + dy, step) - o.y);
      if (handle.includes('w')) {
        const nx = Math.min(round(o.x + dx, step), o.x + o.w - minW);
        w = o.x + o.w - nx;
        x = nx;
      }
      if (handle.includes('n')) {
        const ny = Math.min(round(o.y + dy, step), o.y + o.h - minH);
        h = o.y + o.h - ny;
        y = ny;
      }
      history.preview((l) => ({
        ...l,
        bands: {
          ...l.bands,
          [band]: {
            ...l.bands[band],
            elements: l.bands[band].elements.map((x2) => (x2.id === el.id ? { ...x2, x: clean(x), y: clean(y), w: clean(w), h: clean(h) } : x2)),
          },
        },
      }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startBandResize(e: ReactPointerEvent, band: BandKey) {
    e.stopPropagation();
    e.preventDefault();
    const start = layout.bands[band].height;
    const sy = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        started = true;
        history.begin();
      }
      const h = Math.max(0, round(start + (ev.clientY - sy) / pxPerMm, snap ? 0.5 : 0.1));
      history.preview((l) => ({ ...l, bands: { ...l.bands, [band]: { ...l.bands[band], height: clean(h) } } }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function handleDrop(e: React.DragEvent, band: BandKey) {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    try {
      const payload = JSON.parse(raw) as DropPayload;
      const { x, y } = toBandMm(band, e.clientX, e.clientY);
      onDrop(band, snap ? round(x, grid) : clean(x), snap ? round(y, grid) : clean(y), payload);
    } catch {
      // Not ours.
    }
  }

  const gridBg = showGrid
    ? {
        backgroundImage: `linear-gradient(to right, rgba(59,130,246,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(59,130,246,0.10) 1px, transparent 1px)`,
        backgroundSize: `${Math.max(grid, 1) * (grid < 2 ? 5 : 1)}mm ${Math.max(grid, 1) * (grid < 2 ? 5 : 1)}mm`,
      }
    : {};

  const renderBand = (band: BandKey) => {
    const b = layout.bands[band];
    const bandSelected = selection?.kind === 'band' && selection.band === band;
    return (
      // Above the items table, so a box hanging out of its band can still be grabbed.
      <div key={band} className="relative" style={{ height: `${b.height}mm`, zIndex: 2 }}>
        <BandLabel
          text={b.height === 0 ? `${bandLabels[band]} (0 mm)` : bandLabels[band]}
          above={b.height < 4}
          active={bandSelected || selectedBand === band}
          onClick={() => onSelect({ kind: 'band', band })}
        />
        <div
          ref={(n) => {
            bandRefs.current[band] = n;
          }}
          data-band={band}
          className={`absolute inset-0 ${bandSelected ? 'bg-blue-500/5' : ''}`}
          style={{ outline: '1px dashed rgba(100,116,139,0.45)', outlineOffset: 0, ...gridBg }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => handleDrop(e, band)}
        >
          {b.elements.map((el) => (
            <ElementView key={el.id} el={el} values={values} logoUrl={logoUrl} baseFamily={layout.font.family} design />
          ))}
          {b.elements.map((el) => {
            const selected = selectedBand === band && selectedIds.includes(el.id);
            const single = selected && selectedIds.length === 1;
            const isLine = el.type === 'line';
            const horizontal = isLine && el.w >= el.h;
            // Lines get a fatter grab area than their thickness.
            const grab = isLine ? (horizontal ? { top: `${el.y - 1.2}mm`, height: '2.4mm' } : { left: `${el.x - 1.2}mm`, width: '2.4mm' }) : {};
            return (
              <div
                key={el.id}
                className="absolute"
                style={{
                  left: `${el.x}mm`,
                  top: `${el.y}mm`,
                  width: `${Math.max(el.w, 0.5)}mm`,
                  height: `${Math.max(el.h, 0.5)}mm`,
                  ...grab,
                  cursor: 'move',
                  outline: selected ? '1.5px solid #2563eb' : undefined,
                  boxShadow: selected ? undefined : 'inset 0 0 0 1px rgba(37,99,235,0.0)',
                }}
                onPointerDown={(e) => startMove(e, band, el)}
                onMouseEnter={(e) => {
                  if (!selected) (e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(37,99,235,0.45)');
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(37,99,235,0.0)';
                }}
              >
                {single &&
                  HANDLES.filter((h) => !isLine || (horizontal ? h === 'e' || h === 'w' : h === 'n' || h === 's')).map((h) => (
                    <span
                      key={h}
                      onPointerDown={(e) => startResize(e, band, el, h)}
                      className="absolute bg-white border border-blue-600"
                      style={{
                        width: 8 / zoom,
                        height: 8 / zoom,
                        borderWidth: 1 / zoom,
                        left: h.includes('w') ? -4 / zoom : h.includes('e') ? `calc(100% - ${4 / zoom}px)` : `calc(50% - ${4 / zoom}px)`,
                        top: h.includes('n') ? -4 / zoom : h.includes('s') ? `calc(100% - ${4 / zoom}px)` : `calc(50% - ${4 / zoom}px)`,
                        cursor: `${h}-resize`,
                      }}
                    />
                  ))}
              </div>
            );
          })}
          {selectedBand === band &&
            guides.x.map((gx, i) => <div key={`gx${i}`} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${gx}mm`, borderLeft: '1px solid #ec4899' }} />)}
          {selectedBand === band &&
            guides.y.map((gy, i) => <div key={`gy${i}`} className="absolute left-0 right-0 pointer-events-none" style={{ top: `${gy}mm`, borderTop: '1px solid #ec4899' }} />)}
        </div>
        {/* Drag to change the band's height. */}
        <div
          className="absolute left-0 right-0 z-10 group"
          style={{ bottom: -3 / zoom, height: 6 / zoom, cursor: 'ns-resize' }}
          onPointerDown={(e) => startBandResize(e, band)}
          title={bandLabels[band]}
        >
          <div className="mx-auto h-full w-12 rounded bg-blue-500/0 group-hover:bg-blue-500/40" />
        </div>
      </div>
    );
  };

  const tableSelected = selection?.kind === 'table';
  const used = BAND_KEYS.reduce((s, k) => s + layout.bands[k].height, 0);

  return (
    <div
      style={{ width: `${PAPER_MM[paper].w * zoom}mm`, height: `${Math.max(PAPER_MM[paper].h, used + margins.top + margins.bottom + 40) * zoom}mm` }}
      onPointerDown={startMarquee}
    >
      <div
        className="relative bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)]"
        style={{
          width: `${PAPER_MM[paper].w}mm`,
          minHeight: `${PAPER_MM[paper].h}mm`,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
          paddingTop: `${margins.top}mm`,
          paddingBottom: `${margins.bottom}mm`,
          paddingLeft: `${margins.left}mm`,
          paddingRight: `${margins.right}mm`,
          boxSizing: 'border-box',
          color: '#000',
        }}
      >
        {/* Where the first page ends. */}
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{ top: `${PAPER_MM[paper].h}mm`, borderTop: '1px dashed #ef4444' }}
        />
        <div ref={contentRef} className="relative" style={{ width: `${W}mm` }}>
          {marquee && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${marquee.x}mm`,
                top: `${marquee.y}mm`,
                width: `${marquee.w}mm`,
                height: `${marquee.h}mm`,
                zIndex: 20,
                border: `${1 / zoom}px solid #2563eb`,
                background: 'rgba(59,130,246,0.12)',
              }}
            />
          )}
          {renderBand('pageHeader')}
          {renderBand('header')}
          <div
            className="relative cursor-pointer"
            style={{ paddingTop: `${layout.table.gapBefore}mm`, paddingBottom: `${layout.table.gapAfter}mm` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect({ kind: 'table' });
            }}
          >
            <BandLabel text={bandLabels.table} active={tableSelected} onClick={() => onSelect({ kind: 'table' })} />
            <div style={{ outline: tableSelected ? '1.5px solid #2563eb' : '1px dashed rgba(100,116,139,0.45)' }}>
              <ItemsTable config={layout.table} columns={columns} widths={widths} rows={rows} family={layout.font.family} />
            </div>
          </div>
          {renderBand('footer')}
          <div style={{ height: `${Math.max(0, H - used - 60)}mm`, maxHeight: '30mm' }} />
          {renderBand('pageFooter')}
        </div>
      </div>
    </div>
  );
}

// Short bands put their label above the line, so it can't sit on the next band's.
function BandLabel({ text, active, onClick, above = false }: { text: string; active: boolean; onClick: () => void; above?: boolean }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={`absolute right-full mr-[3mm] ${above ? '-top-[4mm]' : 'top-0'} whitespace-nowrap rounded px-1.5 py-0.5 text-[2.6mm] leading-none font-semibold ${
        active ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
      }`}
      style={{ fontFamily: 'system-ui, sans-serif' }}
    >
      {text}
    </button>
  );
}
