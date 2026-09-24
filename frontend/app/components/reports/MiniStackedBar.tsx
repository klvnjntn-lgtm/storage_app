'use client';

import { formatIDRCompact } from '@/lib/format';

export type StackedSegment = { label: string; value: number; color: string };

// Thin proportional composition bar — part-to-whole, per the dataviz
// skill's form guidance ("Part-to-whole -> stacked bar ... go horizontal
// for many/long-named categories"). Pure CSS flex widths rather than a
// charting lib: at this size (one row) a lib adds no value. 4px rounded
// ends, a 2px surface gap between adjacent segments, and a visible
// label/value legend underneath (the "relief" mitigation for any segment
// color that sits below 3:1 contrast on its own).
export default function MiniStackedBar({ segments }: { segments: StackedSegment[] }) {
  const total = segments.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  if (total <= 0) return null;

  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-gray-100">
        {segments.map((s, i) => {
          const pct = (Math.max(s.value, 0) / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={i}
              style={{ width: `${pct}%`, backgroundColor: s.color }}
              className="h-full first:rounded-l-full last:rounded-r-full"
              title={`${s.label}: ${formatIDRCompact(s.value)}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-[11px] text-gray-500">{s.label}</span>
            <span className="text-[11px] font-semibold text-gray-700">{formatIDRCompact(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
