// components/DateRangePicker.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { parseCalendarDate, toCalendarDateString } from '@/lib/dates';

type Props = {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
};

type Preset = {
  label: string;
  range: () => [string, string];
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function sameDay(a: Date | null, b: Date | null) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Monday-first grid, padded to full weeks so every month renders 5-6 even rows.
function monthGrid(viewDate: Date): (Date | null)[] {
  const first = startOfMonth(viewDate);
  const last = endOfMonth(viewDate);
  const leading = (first.getDay() + 6) % 7; // 0 = Monday
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let day = 1; day <= last.getDate(); day++) {
    cells.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const MONTH_LABEL = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
const WEEKDAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

function formatShort(d: Date) {
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

const PRESETS: Preset[] = [
  {
    label: 'Today',
    range: () => {
      const t = toCalendarDateString(new Date());
      return [t, t];
    },
  },
  {
    label: 'Last 7 days',
    range: () => [toCalendarDateString(addDays(new Date(), -6)), toCalendarDateString(new Date())],
  },
  {
    label: 'Last 30 days',
    range: () => [toCalendarDateString(addDays(new Date(), -29)), toCalendarDateString(new Date())],
  },
  {
    label: 'This month',
    range: () => {
      const now = new Date();
      return [toCalendarDateString(startOfMonth(now)), toCalendarDateString(new Date())];
    },
  },
  {
    label: 'Last month',
    range: () => {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return [toCalendarDateString(startOfMonth(lastMonth)), toCalendarDateString(endOfMonth(lastMonth))];
    },
  },
];

export default function DateRangePicker({ from, to, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => (from ? parseCalendarDate(from) : new Date()));
  const [draftStart, setDraftStart] = useState<Date | null>(from ? parseCalendarDate(from) : null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(to ? parseCalendarDate(to) : null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-seed drafts from applied props each time the popover opens.
  useEffect(() => {
    if (!open) return;
    setDraftStart(from ? parseCalendarDate(from) : null);
    setDraftEnd(to ? parseCalendarDate(to) : null);
    setViewMonth(from ? parseCalendarDate(from) : new Date());
  }, [open, from, to]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  function pickDay(day: Date) {
    const clicked = startOfDay(day);
    // Fresh selection, or a click after a completed range: start over.
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(clicked);
      setDraftEnd(null);
      return;
    }
    // Second click: order start/end regardless of click order.
    if (clicked < draftStart) {
      setDraftEnd(draftStart);
      setDraftStart(clicked);
    } else {
      setDraftEnd(clicked);
    }
  }

  function applyPreset(preset: Preset) {
    const [f, t] = preset.range();
    onChange(f, t);
    setOpen(false);
  }

  function applyCustom() {
    if (!draftStart) return;
    const endDate = draftEnd ?? draftStart;
    onChange(toCalendarDateString(draftStart), toCalendarDateString(endDate));
    setOpen(false);
  }

  function clearAll() {
    onChange(null, null);
    setDraftStart(null);
    setDraftEnd(null);
    setOpen(false);
  }

  const label =
    from && to
      ? sameDay(parseCalendarDate(from), parseCalendarDate(to))
        ? formatShort(parseCalendarDate(from))
        : `${formatShort(parseCalendarDate(from))} – ${formatShort(parseCalendarDate(to))}`
      : 'All time';

  const cells = monthGrid(viewMonth);
  const rangeStart = draftStart;
  const rangeEnd = draftEnd;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 text-xs sm:text-sm px-3 py-2.5 sm:py-2 rounded-md border-2 font-semibold whitespace-nowrap ${
          from || to
            ? 'bg-black text-white border-black'
            : 'border-gray-300 text-gray-600 hover:bg-gray-50'
        }`}
      >
        <CalendarIcon size={14} strokeWidth={2} />
        {label}
        {(from || to) && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              clearAll();
            }}
            className="ml-0.5 rounded-full hover:bg-white/20 p-0.5"
          >
            <X size={12} strokeWidth={2.5} />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-20 mt-2 left-0 bg-white border-2 border-gray-200 rounded-lg shadow-lg flex flex-col sm:flex-row w-[calc(100vw-2rem)] max-w-[420px] sm:w-auto sm:max-w-none overflow-hidden">
          {/* Presets */}
          <div className="flex flex-row sm:flex-col gap-1 p-2 sm:w-36 sm:border-r-2 border-gray-100 overflow-x-auto sm:overflow-visible">
            <button
              onClick={clearAll}
              className="text-left text-xs sm:text-sm px-2.5 py-2 rounded-md hover:bg-gray-100 font-semibold text-gray-700 whitespace-nowrap"
            >
              All time
            </button>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className="text-left text-xs sm:text-sm px-2.5 py-2 rounded-md hover:bg-gray-100 text-gray-700 whitespace-nowrap"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-3 w-72">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                className="p-1.5 rounded-md hover:bg-gray-100"
                aria-label="Previous month"
              >
                <ChevronLeft size={16} strokeWidth={2} />
              </button>
              <span className="text-sm font-semibold capitalize">{MONTH_LABEL.format(viewMonth)}</span>
              <button
                onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                className="p-1.5 rounded-md hover:bg-gray-100"
                aria-label="Next month"
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-1 text-center">
              {WEEKDAY_LABELS.map((w) => (
                <span key={w} className="text-[10px] font-semibold text-gray-400 py-1">
                  {w}
                </span>
              ))}
              {cells.map((day, i) => {
                if (!day) return <span key={i} />;
                const isStart = sameDay(day, rangeStart);
                const isEnd = sameDay(day, rangeEnd);
                const inRange =
                  rangeStart && rangeEnd && day > startOfDay(rangeStart) && day < startOfDay(rangeEnd);
                const isToday = sameDay(day, new Date());
                return (
                  <button
                    key={i}
                    onClick={() => pickDay(day)}
                    className={`text-xs h-8 w-8 mx-auto rounded-md flex items-center justify-center font-medium transition-colors ${
                      isStart || isEnd
                        ? 'bg-black text-white'
                        : inRange
                        ? 'bg-gray-200 text-gray-800'
                        : isToday
                        ? 'border border-gray-400 text-gray-800 hover:bg-gray-100'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
              <span className="text-[11px] text-gray-400">
                {rangeStart ? formatShort(rangeStart) : 'Start'} –{' '}
                {rangeEnd ? formatShort(rangeEnd) : rangeStart ? formatShort(rangeStart) : 'End'}
              </span>
              <button
                onClick={applyCustom}
                disabled={!rangeStart}
                className="text-xs px-3 py-1.5 rounded-md bg-black text-white font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-800"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}