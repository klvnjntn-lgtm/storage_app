// lib/hooks/useSortableData.ts
import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

/**
 * Generic client-side sorting for a table.
 *
 * Give it the rows and a map of "column key -> value extractor"; it
 * returns the sorted rows plus everything a column header needs to
 * render its own sort state — which column is active, which direction,
 * and a click handler that cycles asc -> desc -> off (back to original
 * row order).
 *
 * Numbers sort numerically, everything else sorts as a
 * locale-aware, case-insensitive string compare (so "10" sorts after
 * "9" instead of before it, and "brake" / "Brake" tie sensibly).
 * null/undefined values (e.g. "no price") always sort to the bottom
 * regardless of direction, and ties fall back to original row order so
 * sorting is stable across re-renders.
 */
export function useSortableData<T, K extends string>(
  rows: T[],
  extractors: Record<K, (row: T) => string | number | null | undefined>,
) {
  const [sort, setSort] = useState<SortState<K> | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const extract = extractors[sort.key];
    const indexed = rows.map((row, index) => ({ row, index }));

    indexed.sort((a, b) => {
      const av = extract(a.row);
      const bv = extract(b.row);

      const aEmpty = av == null || av === '';
      const bEmpty = bv == null || bv === '';
      if (aEmpty && bEmpty) return a.index - b.index;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), undefined, {
          sensitivity: 'base',
          numeric: true,
        });
      }
      if (cmp === 0) cmp = a.index - b.index;
      return sort.direction === 'asc' ? cmp : -cmp;
    });

    return indexed.map((i) => i.row);
  }, [rows, sort, extractors]);

  function toggleSort(key: K) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }

  return { sorted, sort, toggleSort };
}