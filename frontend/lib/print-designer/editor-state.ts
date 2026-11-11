'use client';

import { useCallback, useRef, useState } from 'react';
import {
  BAND_KEYS,
  contentHeight,
  contentWidth,
  type BandKey,
  type Layout,
  type LayoutElement,
  type PaperSize,
} from './types';

const HISTORY_LIMIT = 100;
// Typing in one box counts as one undo step, not one per keystroke.
const COALESCE_MS = 800;

// The layout being edited, with undo/redo. `change` records a step;
// `preview` updates without one (mid-drag), after `begin` saved the start.
export function useLayoutHistory(initial: Layout) {
  const [layout, setLayout] = useState(initial);
  const past = useRef<Layout[]>([]);
  const future = useRef<Layout[]>([]);
  const last = useRef<{ key: string; at: number } | null>(null);
  const current = useRef(initial);
  // Mirrors the stacks' sizes for the undo/redo buttons.
  const [counts, setCounts] = useState({ past: 0, future: 0 });
  const bump = () => setCounts({ past: past.current.length, future: future.current.length });

  const apply = (next: Layout) => {
    current.current = next;
    setLayout(next);
  };

  const push = () => {
    past.current.push(current.current);
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
  };

  const change = useCallback((fn: (l: Layout) => Layout, coalesceKey?: string) => {
    const now = Date.now();
    const same = coalesceKey && last.current?.key === coalesceKey && now - last.current.at < COALESCE_MS;
    if (!same) push();
    last.current = coalesceKey ? { key: coalesceKey, at: now } : null;
    apply(fn(current.current));
    bump();
  }, []);

  const begin = useCallback(() => {
    push();
    last.current = null;
    bump();
  }, []);

  const preview = useCallback((fn: (l: Layout) => Layout) => apply(fn(current.current)), []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(current.current);
    last.current = null;
    apply(prev);
    bump();
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(current.current);
    last.current = null;
    apply(next);
    bump();
  }, []);

  const reset = useCallback((l: Layout) => {
    past.current = [];
    future.current = [];
    apply(l);
    bump();
  }, []);

  return {
    layout,
    change,
    begin,
    preview,
    undo,
    redo,
    reset,
    canUndo: counts.past > 0,
    canRedo: counts.future > 0,
  };
}

export function updateElements(layout: Layout, band: BandKey, ids: string[], fn: (el: LayoutElement) => LayoutElement): Layout {
  const set = new Set(ids);
  return {
    ...layout,
    bands: {
      ...layout.bands,
      [band]: { ...layout.bands[band], elements: layout.bands[band].elements.map((el) => (set.has(el.id) ? fn(el) : el)) },
    },
  };
}

export function findElement(layout: Layout, id: string): { band: BandKey; el: LayoutElement } | null {
  for (const band of BAND_KEYS) {
    const el = layout.bands[band].elements.find((e) => e.id === id);
    if (el) return { band, el };
  }
  return null;
}

export type Warning = {
  level: 'error' | 'warn';
  // An i18n key under printDesigner.warnings, with vars.
  key: string;
  vars?: Record<string, string | number>;
  band?: BandKey;
  elementId?: string;
};

const round = (n: number) => Math.round(n * 10) / 10;

// What's wrong with a layout before it's printed: boxes off their band or
// off the page, and bands that leave no room for the items table.
export function checkLayout(layout: Layout, paper: PaperSize, tableHeadMm: number, overflowIds: Set<string>): Warning[] {
  const out: Warning[] = [];
  const W = contentWidth(layout, paper);
  const H = contentHeight(layout, paper);
  const { pageHeader, header, footer, pageFooter } = layout.bands;

  const firstPageRoom = H - pageHeader.height - header.height - pageFooter.height - layout.table.gapBefore - tableHeadMm;
  if (firstPageRoom < 10) {
    out.push({ level: 'error', key: 'noRoomForTable', vars: { mm: round(Math.max(0, firstPageRoom)) } });
  }
  if (pageHeader.height + footer.height + pageFooter.height > H) {
    out.push({ level: 'error', key: 'footerTooTall' });
  }

  for (const band of BAND_KEYS) {
    for (const el of layout.bands[band].elements) {
      const tol = 0.25;
      if (el.x < -tol || el.x + el.w > W + tol) {
        out.push({ level: 'warn', key: 'offPageSide', band, elementId: el.id });
      } else if (el.y < -tol || el.y + el.h > layout.bands[band].height + tol) {
        out.push({ level: 'warn', key: 'outsideBand', band, elementId: el.id });
      }
      if (el.type === 'text' && overflowIds.has(el.id)) {
        out.push({ level: 'warn', key: el.fit === 'clip' ? 'textClipped' : 'textTooLong', band, elementId: el.id });
      }
    }
  }
  return out;
}
