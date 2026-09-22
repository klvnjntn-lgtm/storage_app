// lib/useQuerySync.ts
'use client';

import { useEffect, useRef } from 'react';

// Reads a single query param for a `useState(() => ...)` initializer, so a
// list page's filters/search/page start from the URL instead of always
// resetting to their defaults. `window` is undefined during the server
// render pass, so callers fall back to `fallback` there — the client's
// first render (hydration) re-runs the initializer with the real URL.
export function getInitialParam<T extends string>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const value = new URLSearchParams(window.location.search).get(key);
  return (value as T | null) ?? fallback;
}

export function getInitialNumberParam(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const value = new URLSearchParams(window.location.search).get(key);
  const n = value === null ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Mirrors `params` onto the URL's query string via history.replaceState
// (not router.replace — this must NOT trigger a Next.js navigation/refetch,
// it only needs to keep the address bar in sync with the filters). Keys
// with a null/undefined/'' value are omitted rather than written as `key=`,
// so a page at its defaults keeps a clean URL.
//
// Because this rewrites the *current* history entry, whatever filters were
// active when the user opens a detail page are what pressing the browser's
// Back button returns them to — no separate "restore state" wiring needed.
export function useSyncQueryParams(params: Record<string, string | number | null | undefined>) {
  const skipFirstRun = useRef(true);
  const values = Object.values(params);

  useEffect(() => {
    // The URL already reflects these values on first mount (that's what
    // seeded them via getInitialParam) — skip so we don't immediately
    // rewrite it and drop a stray history frame.
    if (skipFirstRun.current) {
      skipFirstRun.current = false;
      return;
    }
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === '') continue;
      search.set(key, String(value));
    }
    const query = search.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
    window.history.replaceState(window.history.state, '', url);
    // `values` has a stable length/order per call site (same object shape
    // every render), so spreading it as deps is safe despite being dynamic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, values);
}
