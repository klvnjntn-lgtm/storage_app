'use client';

import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & {
  value: number | string | null | undefined;
};

// A number field that types the way people expect. Drop-in for
// <input type="number">: the same onChange, so a page's own parsing is
// untouched.
// - Focus selects what's there, so typing replaces the 0 instead of
//   making "05".
// - While focused it shows what was typed, even when the page turns it
//   into a number at once — so the field can be cleared ("" stays "", not
//   back to 0) on the way to typing a new value. Leaving the field shows
//   the page's value again.
// - The mouse wheel no longer nudges the value while scrolling the page.
export default function NumberInput({ value, onChange, onFocus, onBlur, onWheel, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...rest}
      type="number"
      value={draft ?? value ?? ''}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange?.(e);
      }}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
      onWheel={(e) => {
        e.currentTarget.blur();
        onWheel?.(e);
      }}
    />
  );
}
