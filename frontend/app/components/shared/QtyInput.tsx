'use client';

import { useState } from 'react';

type Props = {
  value: number;
  /** Called with a positive quantity rounded to 2 decimals. */
  onCommit: (value: number) => void;
  disabled?: boolean;
  'aria-label'?: string;
};

export function roundQty(n: number): number {
  return Math.round(n * 100) / 100;
}

// Accepts "2,5" as well as "2.5" — Indonesian keyboards and habits use a
// decimal comma.
function parseQty(raw: string): number | null {
  const n = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? roundQty(n) : null;
}

// The number between a cart line's −/+ steppers, typeable so a line can hold
// a fractional amount such as 1.5 kg. Commits on blur or Enter, Escape reverts; anything not
// a positive number snaps back (removing a line stays the trash button's job).
export default function QtyInput({ value, onCommit, disabled, 'aria-label': ariaLabel }: Props) {
  // Only holds text while the field is being edited; otherwise it shows the
  // prop, so a refused value (over stock, below what's fulfilled) snaps back.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const next = draft == null ? null : parseQty(draft);
    setDraft(null);
    if (next != null && next !== value) onCommit(next);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? String(value)}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setDraft(String(value));
        e.target.select();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        // Revert without blurring: blurring here would commit the stale draft.
        if (e.key === 'Escape') setDraft(null);
      }}
      className="w-12 h-7 text-center text-sm border border-transparent rounded-md bg-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
    />
  );
}
