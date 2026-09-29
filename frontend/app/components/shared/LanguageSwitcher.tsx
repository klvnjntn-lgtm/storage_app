'use client';

import { useState, useRef, useEffect } from 'react';
import { Globe, Check } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { locales } from '@/app/i18n/translations';

/**
 * `dark` styles it for the landing page (whose colours follow the landing
 * tokens in theme.css). `inline` renders the choices as a row of buttons
 * instead of a dropdown — for containers that clip overflow, like the
 * landing page's collapsing mobile menu.
 */
export default function LanguageSwitcher({
  className = '',
  dark = false,
  inline = false,
}: {
  className?: string;
  dark?: boolean;
  inline?: boolean;
}) {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = locales.find((l) => l.code === language) ?? locales[0];

  if (inline) {
    return (
      <div role="group" aria-label="Change language" className={`flex items-center gap-2 ${className}`}>
        <Globe size={14} strokeWidth={2} aria-hidden="true" className={dark ? 'text-white/60' : 'text-gray-500'} />
        {locales.map((l) => {
          const active = l.code === current.code;
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => setLanguage(l.code)}
              aria-pressed={active}
              className={`min-h-9 px-3 rounded-md border text-xs font-medium transition-colors ${
                dark
                  ? active
                    ? 'border-blue-400/40 bg-blue-500/15 text-white'
                    : 'border-white/15 text-white/70 hover:bg-white/10'
                  : active
                    ? 'border-blue-500/40 bg-blue-50 text-blue-700'
                    : 'border-blue-500/20 text-gray-600 hover:bg-blue-50'
              }`}
            >
              {l.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${
          dark
            ? 'border-white/15 text-white/75 hover:bg-white/10 hover:border-white/30'
            : 'border-blue-500/20 text-gray-600 hover:bg-blue-50 hover:border-blue-500/40'
        }`}
        aria-label="Change language"
      >
        <Globe size={14} strokeWidth={2} />
        <span>{language.toUpperCase()}</span>
      </button>

      {open && (
        <div
          className={`absolute right-0 mt-1.5 w-44 rounded-md border py-1 z-50 ${
            dark
              ? 'bg-[var(--l-raised)] border-white/10 shadow-[0_16px_40px_-12px_var(--l-shadow)]'
              : 'bg-white border-blue-500/15 shadow-lg shadow-blue-900/5'
          }`}
        >
          {locales.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => {
                setLanguage(l.code);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${
                dark ? 'hover:bg-white/5' : 'hover:bg-blue-50'
              }`}
            >
              <span
                className={
                  l.code === current.code
                    ? `font-medium ${dark ? 'text-white' : 'text-gray-900'}`
                    : dark
                      ? 'text-white/65'
                      : 'text-gray-600'
                }
              >
                {l.label}
              </span>
              {l.code === current.code && (
                <Check size={14} strokeWidth={2} className={dark ? 'text-blue-400' : 'text-blue-600'} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
