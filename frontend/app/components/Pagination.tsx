// components/Pagination.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Props = {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
};

// Builds a compact page list like: 1 … 4 5 [6] 7 8 … 24
function buildPageList(current: number, totalPages: number): (number | '…')[] {
  const pages: (number | '…')[] = [];
  const add = (p: number) => pages.push(p);

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) add(i);
    return pages;
  }

  add(1);
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);

  if (start > 2) pages.push('…');
  for (let i = start; i <= end; i++) add(i);
  if (end < totalPages - 1) pages.push('…');
  add(totalPages);

  return pages;
}

export default function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
}: Props) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);
  const pageList = buildPageList(page, totalPages);

  // Sliding highlight behind the active page number — measured against the
  // real button so it lands exactly right even with double-digit pages.
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const track = trackRef.current;
    const active = buttonRefs.current[page];
    if (!track || !active) return;
    const trackRect = track.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    setIndicator({ left: activeRect.left - trackRect.left, width: activeRect.width });
  }, [page, totalPages, pageList.join(',')]);

  if (totalItems === 0) return null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-1">
      <p className="text-sm text-gray-400 tabular-nums order-2 sm:order-1">
        <span className="font-semibold text-gray-600">{from}–{to}</span>{' '}
        <span className="text-gray-300">of</span> {totalItems}
      </p>

      <div className="flex items-center gap-3 sm:gap-4 order-1 sm:order-2 self-center sm:self-auto">
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5 rounded-full border border-blue-500/15 bg-white p-1 shadow-sm">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1}
              className="h-8 w-8 flex items-center justify-center rounded-full text-gray-500 hover:bg-blue-600 hover:text-white active:scale-95 transition-all duration-150 disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-transparent disabled:hover:text-gray-500"
              aria-label="Previous page"
            >
              <ChevronLeft size={16} strokeWidth={2.5} />
            </button>

            <div ref={trackRef} className="relative flex items-center gap-0.5">
              {/* Sliding highlight */}
              {indicator && (
                <div
                  className="absolute top-0 h-8 rounded-full bg-blue-600 shadow-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ left: indicator.left, width: indicator.width }}
                  aria-hidden
                />
              )}

              {pageList.map((p, i) =>
                p === '…' ? (
                  <span
                    key={`ellipsis-${i}`}
                    className="relative w-8 h-8 flex items-center justify-center text-sm text-gray-300 select-none"
                  >
                    ⋯
                  </span>
                ) : (
                  <button
                    key={p}
                    ref={(el) => {
                      buttonRefs.current[p] = el;
                    }}
                    onClick={() => onPageChange(p)}
                    aria-current={p === page ? 'page' : undefined}
                    className={`relative w-8 h-8 flex items-center justify-center rounded-full text-sm tabular-nums font-semibold transition-all duration-200 hover:scale-110 active:scale-95 ${
                      p === page ? 'text-white' : 'text-gray-500 hover:text-blue-700'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            </div>

            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page === totalPages}
              className="h-8 w-8 flex items-center justify-center rounded-full text-gray-500 hover:bg-blue-600 hover:text-white active:scale-95 transition-all duration-150 disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-transparent disabled:hover:text-gray-500"
              aria-label="Next page"
            >
              <ChevronRight size={16} strokeWidth={2.5} />
            </button>
          </div>
        )}

        {onPageSizeChange && (
          <>
            {totalPages > 1 && <span className="h-4 w-px bg-blue-500/15" aria-hidden />}
            <label className="flex items-center gap-1.5 text-sm text-gray-400">
              <span className="hidden sm:inline">Show</span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="bg-transparent text-gray-600 font-medium focus:outline-none cursor-pointer -ml-0.5 py-1 rounded-md hover:text-blue-700 transition-colors"
              >
                {pageSizeOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </div>
  );
}