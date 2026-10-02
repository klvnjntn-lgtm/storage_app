// components/DatePicker.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { parseCalendarDate, toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

type Props = {
  /** "YYYY-MM-DD", or '' for no date (field variant only). */
  value: string;
  onChange: (value: string) => void;
  /**
   * `filter` (default) is the black pill used in filter bars. `field` looks
   * like the app's form inputs and is what replaces <input type="date">.
   */
  variant?: 'filter' | 'field';
  /** `sm` matches the compact text-xs inputs in inline edit/pay forms. */
  size?: 'md' | 'sm';
  /** Shows a clear button when a date is set (field variant). */
  clearable?: boolean;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  /** Wrapper classes — width/layout only; the look comes from the variant. */
  className?: string;
};

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function sameDay(a: Date | null, b: Date | null) {
  if (!a || !b) return false;
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

// Calendar popover is w-72 (288px) and ~340px tall.
const POPOVER_W = 288;
const POPOVER_H = 340;

// Form-field look shared by DatePicker, DateTimePicker and TimeInput so
// every date/time control in the app reads as one family.
export const dateFieldClass = (size: 'md' | 'sm' = 'md') =>
  `w-full flex items-center gap-2 border-2 border-gray-300 rounded-md bg-white text-left transition-colors hover:border-blue-500/40 focus-visible:outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed ${
    size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'
  }`;

// Single-day counterpart to DateRangePicker — same calendar visuals (black
// selection, month nav, weekday grid). Picking a day applies and closes
// immediately instead of needing a separate Apply step.
export default function DatePicker({
  value,
  onChange,
  variant = 'filter',
  size = 'md',
  clearable = false,
  placeholder,
  min,
  max,
  disabled = false,
  id,
  'aria-label': ariaLabel,
  className = '',
}: Props) {
  const { t, language } = useLanguage();
  const localeTag = language === 'id' ? 'id-ID' : 'en-US';
  const monthLabelFormatter = new Intl.DateTimeFormat(localeTag, { month: 'long', year: 'numeric' });
  const weekdayLabels = language === 'id' ? WEEKDAY_LABELS_ID : WEEKDAY_LABELS_EN;
  const selected = value ? parseCalendarDate(value) : null;
  const minDate = min ? parseCalendarDate(min) : null;
  const maxDate = max ? parseCalendarDate(max) : null;

  function formatShort(d: Date) {
    return d.toLocaleDateString(localeTag, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => selected ?? new Date());
  const [placement, setPlacement] = useState({ up: false, right: false });
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    // Re-centre on the current value and keep the popover on screen.
    setViewMonth(selected ?? new Date());
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPlacement({
        right: rect.left + POPOVER_W > window.innerWidth - 8,
        up: rect.bottom + POPOVER_H > window.innerHeight && rect.top > POPOVER_H,
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const outOfRange = (d: Date) => (!!minDate && d < minDate) || (!!maxDate && d > maxDate);

  function pickDay(day: Date) {
    onChange(toCalendarDateString(day));
    setOpen(false);
    triggerRef.current?.focus();
  }

  const cells = monthGrid(viewMonth);
  const today = new Date();
  const label = selected ? formatShort(selected) : placeholder ?? t('shared.dateRangePicker.pickDate');

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {variant === 'filter' ? (
        <button
          ref={triggerRef}
          id={id}
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs sm:text-sm px-3 py-2.5 sm:py-2 rounded-md border-2 font-semibold whitespace-nowrap bg-black text-white border-black disabled:opacity-50"
        >
          <CalendarIcon size={14} strokeWidth={2} aria-hidden="true" />
          {label}
        </button>
      ) : (
        <>
          <button
            ref={triggerRef}
            id={id}
            type="button"
            onClick={toggle}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={`${dateFieldClass(size)} ${open ? 'border-blue-500' : ''} ${clearable && selected ? 'pr-8' : ''}`}
          >
            <CalendarIcon size={size === 'sm' ? 13 : 15} strokeWidth={2} aria-hidden="true" className="shrink-0 text-blue-600/70" />
            <span className={`truncate ${selected ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
          </button>
          {clearable && selected && !disabled && (
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label={t('shared.dateRangePicker.clear')}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <X size={size === 'sm' ? 12 : 14} strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
        </>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel ?? t('shared.dateRangePicker.pickDate')}
          className={`absolute z-50 bg-white border-2 border-gray-200 rounded-lg shadow-lg overflow-hidden w-72 ${
            placement.up ? 'bottom-full mb-2' : 'top-full mt-2'
          } ${placement.right ? 'right-0' : 'left-0'}`}
        >
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
                const isToday = sameDay(day, today);
                const blocked = outOfRange(day);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={blocked}
                    onClick={() => pickDay(day)}
                    aria-pressed={isSelected}
                    className={`text-xs h-8 w-8 mx-auto rounded-md flex items-center justify-center font-medium transition-colors disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-not-allowed ${
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
                onClick={() => pickDay(today)}
                disabled={outOfRange(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}
                className="text-xs px-3 py-1.5 rounded-md hover:bg-gray-100 font-semibold text-gray-700 disabled:opacity-40"
              >
                {t('shared.dateRangePicker.today')}
              </button>
              {clearable && selected && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  className="text-xs px-3 py-1.5 rounded-md hover:bg-red-50 font-semibold text-gray-500 hover:text-red-600"
                >
                  {t('shared.dateRangePicker.clear')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
