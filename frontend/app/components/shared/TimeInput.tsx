'use client';

import { useRef } from 'react';
import { Clock } from 'lucide-react';
import { dateFieldClass } from './DatePicker';

type Props = {
  /** "HH:mm", or '' */
  value: string;
  onChange: (value: string) => void;
  size?: 'md' | 'sm';
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  /** Wrapper classes — width/layout only. */
  className?: string;
};

// Time-of-day field in the same look as DatePicker's `field` variant. The
// native time control stays underneath (good keyboard entry and the OS
// picker on phones); only the chrome around it is ours.
export default function TimeInput({ value, onChange, size = 'md', disabled, id, 'aria-label': ariaLabel, className = '' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  // A div, not a <label>: callers often already wrap fields in a <label>,
  // and labels can't nest. Clicking the chrome still focuses the input.
  return (
    <div className={className}>
      <div
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
        className={`${dateFieldClass(size)} cursor-text focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Clock size={size === 'sm' ? 13 : 15} strokeWidth={2} aria-hidden="true" className="shrink-0 text-blue-600/70" />
        <input
          ref={inputRef}
          id={id}
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={ariaLabel}
          className="min-w-0 flex-1 bg-transparent outline-none text-gray-900 [&::-webkit-calendar-picker-indicator]:hidden"
        />
      </div>
    </div>
  );
}
