'use client';

import { useState } from 'react';
import DatePicker from './DatePicker';
import TimeInput from './TimeInput';
import { useLanguage } from '@/app/context/LanguageContext';

type Props = {
  /** "YYYY-MM-DDTHH:mm" (what <input type="datetime-local"> produced), or '' */
  value: string;
  onChange: (value: string) => void;
  size?: 'md' | 'sm';
  clearable?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  /** Wrapper classes — width/layout only. */
  className?: string;
};

const split = (v: string) => {
  const [date = '', time = ''] = v ? v.split('T') : [];
  return { date, time: time.slice(0, 5) };
};

// Replaces <input type="datetime-local">: the shared calendar for the day
// plus TimeInput for the time. Like the native control, it only reports a
// value once both halves are filled, and '' while either is empty.
export default function DateTimePicker({ value, onChange, size = 'md', clearable = true, disabled, 'aria-label': ariaLabel, className = '' }: Props) {
  const { t } = useLanguage();
  // Half-filled input lives here until it's complete; a complete value from
  // the parent always wins.
  const [draft, setDraft] = useState(() => split(value));
  const parts = value ? split(value) : draft;

  function update(next: { date: string; time: string }) {
    setDraft(next);
    onChange(next.date && next.time ? `${next.date}T${next.time}` : '');
  }

  return (
    <div className={`flex gap-2 ${className}`}>
      <DatePicker
        variant="field"
        size={size}
        clearable={clearable}
        disabled={disabled}
        value={parts.date}
        onChange={(date) => update({ ...parts, date })}
        aria-label={ariaLabel}
        // Wide enough for "12 Sep 2026" even when the parent is auto-width.
        className="flex-1 min-w-[9.5rem]"
      />
      <div className="w-[7.5rem] shrink-0">
        <TimeInput
          size={size}
          disabled={disabled}
          value={parts.time}
          onChange={(time) => update({ ...parts, time })}
          aria-label={ariaLabel ? `${ariaLabel} · ${t('shared.dateRangePicker.time')}` : t('shared.dateRangePicker.time')}
        />
      </div>
    </div>
  );
}
