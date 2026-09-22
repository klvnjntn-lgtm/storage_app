'use client';

import { useState, useRef, useEffect } from 'react';
import { Globe, Check } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { locales } from '@/app/i18n/translations';

export default function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const current = locales.find((l) => l.code === language) ?? locales[0];

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border border-blue-500/20 text-gray-600 hover:bg-blue-50 hover:border-blue-500/40 transition-colors"
        aria-label="Change language"
      >
        <Globe size={14} strokeWidth={2} />
        <span>{language.toUpperCase()}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-44 bg-white border border-blue-500/15 rounded-md shadow-lg shadow-blue-900/5 py-1 z-50">
          {locales.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLanguage(l.code);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-blue-50 transition-colors"
            >
              <span className={l.code === current.code ? 'font-medium text-gray-900' : 'text-gray-600'}>
                {l.label}
              </span>
              {l.code === current.code && <Check size={14} strokeWidth={2} className="text-blue-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
