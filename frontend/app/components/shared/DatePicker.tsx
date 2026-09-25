// components/DatePicker.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { parseCalendarDate, toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

type Props = {
  value: string;
  onChange: (value: string) => void;
};

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Monday-first grid, padded to full weeks — same layout as DateRangePicker's.
function monthGrid(viewDate: Date): (Date | null)[] {
  const first = startOfMonth(viewDate);
  const last = endOfMonth(viewDate);
  const leading = (first.getDay() + 6) % 7;
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let day = 1; day <= last.getDate(); day++) {
    cells.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const WEEKDAY_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_LABELS_ID = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

// Single-day counterpart to DateRangePicker — same calendar visuals (black
// selection, month nav, weekday grid) but for filters that only ever need
// one day (route date, monitoring date), where picking a day applies and
// closes immediately instead of needing a separate Apply step.
export default function DatePicker({ value, onChange }: Props) {
  const { t, language } = useLanguage();
  const localeTag = language === 'id' ? 'id-ID' : 'en-US';
  const monthLabelFormatter = new Intl.DateTimeFormat(localeTag, { month: 'long', year: 'numeric' });
  const weekdayLabels = language === 'id' ? WEEKDAY_LABELS_ID : WEEKDAY_LABELS_EN;
  const selected = parseCalendarDate(value);

  function formatShort(d: Date) {
    return d.toLocaleDateString(localeTag, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(selected);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setViewMonth(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
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
    onChange(toCalendarDateString(day));
    setOpen(false);
  }

  const cells = monthGrid(viewMonth);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs sm:text-sm px-3 py-2.5 sm:py-2 rounded-md border-2 font-semibold whitespace-nowrap bg-black text-white border-black"
      >
        <CalendarIcon size={14} strokeWidth={2} />
        {formatShort(selected)}
      </button>

      {open && (
        <div className="absolute z-20 mt-2 left-0 bg-white border-2 border-gray-200 rounded-lg shadow-lg overflow-hidden w-72">
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                className="p-1.5 rounded-md hover:bg-gray-100"
                aria-label={t('shared.dateRangePicker.previousMonth')}
              >
                <ChevronLeft size={16} strokeWidth={2} />
              </button>
              <span className="text-sm font-semibold capitalize">{monthLabelFormatter.format(viewMonth)}</span>
              <button
                type="button"
                onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                className="p-1.5 rounded-md hover:bg-gray-100"
                aria-label={t('shared.dateRangePicker.nextMonth')}
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-1 text-center">
              {weekdayLabels.map((w) => (
                <span key={w} className="text-[10px] font-semibold text-gray-400 py-1">
                  {w}
                </span>
              ))}
              {cells.map((day, i) => {
                if (!day) return <span key={i} />;
                const isSelected = sameDay(day, selected);
                const isToday = sameDay(day, new Date());
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickDay(day)}
                    className={`text-xs h-8 w-8 mx-auto rounded-md flex items-center justify-center font-medium transition-colors ${
                      isSelected
                        ? 'bg-black text-white'
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
              <button
                type="button"
                onClick={() => pickDay(new Date())}
                className="text-xs px-3 py-1.5 rounded-md hover:bg-gray-100 font-semibold text-gray-700"
              >
                {t('shared.dateRangePicker.today')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
