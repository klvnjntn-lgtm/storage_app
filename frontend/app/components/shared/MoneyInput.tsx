'use client';

import { useLayoutEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min'> & {
  value: number | string | null | undefined;
  // Bank statement lines and adjustments can go below zero; prices and payments can't.
  allowNegative?: boolean;
  // Accepted for drop-in use where NumberInput had min={0}; negatives are governed by allowNegative.
  min?: number | string;
};

// Plain number → "1.500.000" or "1.500.000,5" (Indonesian grouping: dots for thousands, comma for decimals).
export function formatMoneyInput(raw: string): string {
  if (raw === '' || raw === '-') return raw;
  const negative = raw.startsWith('-');
  const [int, dec] = raw.replace('-', '').split('.');
  const grouped = (int || '0').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${dec !== undefined ? `,${dec}` : ''}`;
}

// What was typed ("1.500.000,5", "1500000", "Rp 2.000") → plain "1500000.5". Dots are only ever
// grouping; a comma is the decimal mark, at most two places.
function parseTyped(text: string, allowNegative: boolean): string {
  const negative = allowNegative && text.trim().startsWith('-');
  const cleaned = text.replace(/[^\d,]/g, '');
  const [int, ...rest] = cleaned.split(',');
  const dec = rest.length ? rest.join('').slice(0, 2) : undefined;
  if (!int && dec === undefined) return negative ? '-' : '';
  return `${negative ? '-' : ''}${int.replace(/^0+(?=\d)/, '') || '0'}${dec !== undefined ? `.${dec}` : ''}`;
}

function toRaw(value: Props['value']): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? String(n) : String(value);
}

// A money field that shows thousands separators as you type ("1.500.000"). Drop-in for
// NumberInput on amounts: onChange still receives e.target.value as a plain number string
// ("1500000"), so a page's own Number(...) parsing is untouched.
export default function MoneyInput({ value, onChange, onFocus, onBlur, allowNegative = false, min: _min, ...rest }: Props) {
  // While focused, what the user is typing (plain form) — so "1.500," isn't snapped back mid-entry.
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  // Digits to the right of the caret, kept across reformatting so the caret doesn't jump to the end.
  const caretFromEnd = useRef<number | null>(null);

  const shown = formatMoneyInput(draft ?? toRaw(value));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || caretFromEnd.current === null || document.activeElement !== el) return;
    let digits = caretFromEnd.current;
    let pos = shown.length;
    while (pos > 0 && digits > 0) {
      pos--;
      if (/[\d,]/.test(shown[pos])) digits--;
    }
    el.setSelectionRange(pos, pos);
    caretFromEnd.current = null;
  }, [shown]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const text = e.target.value;
    const caret = e.target.selectionStart ?? text.length;
    caretFromEnd.current = text.slice(caret).replace(/[^\d,]/g, '').length;
    const raw = parseTyped(text, allowNegative);
    setDraft(raw);
    onChange?.({ ...e, target: { ...e.target, value: raw }, currentTarget: { ...e.currentTarget, value: raw } } as ChangeEvent<HTMLInputElement>);
  }

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onChange={handleChange}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
