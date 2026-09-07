// components/SortableTh.tsx
'use client';

import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import type { SortDirection } from '@/lib/hooks/useSortableData';

/**
 * A <th> that doubles as a sort control. Click to sort ascending, click
 * again for descending, a third click clears it. The active column gets
 * a highlighted background and a solid arrow; inactive columns show a
 * faint neutral arrow so it's discoverable without being noisy.
 */
export default function SortableTh<K extends string>({
  label,
  columnKey,
  activeKey,
  direction,
  onSort,
  align = 'left',
  className = '',
}: {
  label: React.ReactNode;
  columnKey: K;
  activeKey: K | null;
  direction: SortDirection | null;
  onSort: (key: K) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = activeKey === columnKey;

  return (
    <th
      className={`px-4 py-3 font-semibold whitespace-nowrap select-none transition-colors ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${active ? 'bg-gray-200/70' : ''} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        title={`Sort by ${typeof label === 'string' ? label : columnKey}`}
        className={`inline-flex items-center gap-1 ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-black' : 'text-gray-600 hover:text-black'}`}
      >
        <span className={active ? 'underline decoration-2 underline-offset-4' : ''}>{label}</span>
        {active ? (
          direction === 'asc' ? (
            <ArrowUp size={12} strokeWidth={2.5} />
          ) : (
            <ArrowDown size={12} strokeWidth={2.5} />
          )
        ) : (
          <ArrowUpDown size={12} strokeWidth={2} className="opacity-40" />
        )}
      </button>
    </th>
  );
}