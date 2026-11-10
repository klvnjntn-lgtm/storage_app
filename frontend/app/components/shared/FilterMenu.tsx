'use client';

import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

export type FilterOption = { value: string; label: string };

// One filter in a list page's toolbar: a button reading "Location" (or
// "Location: No pin" once set) that opens its choices. Several of these sit
// side by side and wrap, so a page can show one per enabled module without
// the toolbar turning into rows of pills. '' is always "all".
export default function FilterMenu({
  label,
  icon: Icon,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>;
  value: string;
  options: FilterOption[];
  allLabel: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const active = !!value && !!selected;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const choices: FilterOption[] = [{ value: '', label: allLabel }, ...options];

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`flex items-center rounded-lg border shadow-sm transition-colors ${
          active
            ? 'border-blue-500/50 bg-blue-50 text-blue-800'
            : 'border-blue-500/20 bg-white text-gray-700 hover:border-blue-500/40'
        }`}
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          className="flex h-10 sm:h-9 items-center gap-1.5 rounded-lg pl-3 pr-2.5 text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          <Icon size={15} strokeWidth={2} className={active ? 'text-blue-600' : 'text-blue-600/70'} aria-hidden />
          <span className="font-medium">{label}</span>
          {active && (
            <>
              <span className="text-blue-400" aria-hidden>
                :
              </span>
              <span className="max-w-[11rem] truncate font-semibold" title={selected.label}>
                {selected.label}
              </span>
            </>
          )}
          <ChevronDown
            size={15}
            strokeWidth={2}
            aria-hidden
            className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {active && (
          <button
            type="button"
            onClick={() => pick('')}
            aria-label={t('common.filterMenu.clearOne', { name: label })}
            className="mr-1 flex h-7 w-7 items-center justify-center rounded-md text-blue-700 hover:bg-blue-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <X size={14} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 z-30 mt-1.5 min-w-[13rem] max-w-[calc(100vw-2rem)] max-h-72 overflow-y-auto rounded-lg border border-blue-500/20 bg-white p-1 shadow-lg"
        >
          {choices.map((o) => {
            const isSelected = o.value === value || (!o.value && !active);
            return (
              <li key={o.value || '__all'} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => pick(o.value)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm cursor-pointer focus-visible:outline-none focus-visible:bg-blue-50 ${
                    isSelected ? 'font-semibold text-blue-800' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Check size={14} strokeWidth={2.5} aria-hidden className={`shrink-0 ${isSelected ? 'text-blue-600' : 'invisible'}`} />
                  <span className="min-w-0 break-words">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
