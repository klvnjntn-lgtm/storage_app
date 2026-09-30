'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { userLabel as driverLabel, UserAvatar } from '@/app/components/shared/UserAvatar';

export type PickerDriver = {
  id: string;
  email: string;
  displayName?: string | null;
  team?: { id: string; name: string } | null;
};

// Name/avatar helpers live in shared/UserAvatar (also used by Admin →
// Members); re-exported under the driver-flavoured names this module uses.
export { driverLabel };

export function DriverAvatar({ driver, size }: { driver: PickerDriver & { avatarUrl?: string | null }; size?: number }) {
  return <UserAvatar user={driver} size={size} />;
}

// Searchable driver dropdown grouped by team. Matches name, email, or team.
export default function DriverPicker({
  drivers,
  value,
  onChange,
  placeholder,
  clearLabel,
  disabled,
  className = '',
}: {
  drivers: PickerDriver[];
  value: string;
  onChange: (driverId: string) => void;
  placeholder?: string;
  // When set, shows a first option with this label that selects '' (e.g. "All drivers").
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = drivers.find((d) => d.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? drivers.filter((d) =>
          [d.displayName ?? '', d.email, d.team?.name ?? ''].some((s) => s.toLowerCase().includes(q)),
        )
      : drivers;
    // Teams alphabetically, unassigned last, so group headers read in order.
    return [...list].sort((a, b) => {
      const ta = a.team?.name ?? '￿';
      const tb = b.team?.name ?? '￿';
      return ta.localeCompare(tb) || driverLabel(a).localeCompare(driverLabel(b));
    });
  }, [drivers, query]);

  // Flat option list for keyboard navigation: optional "clear" row, then drivers.
  const options: (PickerDriver | null)[] = clearLabel !== undefined && !query ? [null, ...filtered] : filtered;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function openMenu() {
    if (disabled) return;
    setQuery('');
    setActive(0);
    setOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function choose(d: PickerDriver | null) {
    onChange(d?.id ?? '');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[active] !== undefined) choose(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const teamOf = (d: PickerDriver | null | undefined) => (d ? (d.team?.name ?? t('delivery.routes.unassigned')) : undefined);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="w-full flex items-center gap-2 border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm bg-white text-left hover:border-blue-300 disabled:opacity-50 sm:min-w-[220px]"
      >
        {selected ? (
          <>
            <DriverAvatar driver={selected} size={20} />
            <span className="truncate flex-1">{driverLabel(selected)}</span>
          </>
        ) : (
          <span className="truncate flex-1 text-gray-500">{clearLabel ?? placeholder ?? t('delivery.driverPicker.placeholder')}</span>
        )}
        <ChevronDown size={14} className="shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full sm:w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-gray-100">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={t('delivery.driverPicker.search')}
              className="flex-1 min-w-0 text-base sm:text-sm outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
            {options.length === 0 && (
              <li className="px-3 py-3 text-sm text-gray-500">{t('delivery.driverPicker.noMatches')}</li>
            )}
            {options.map((d, i) => {
              const teamName = teamOf(d);
              const header = d && teamName !== teamOf(options[i - 1]) ? teamName : null;
              const isSelected = d ? d.id === value : value === '';
              return (
                <li key={d?.id ?? '__clear'}>
                  {header && (
                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      {header}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(d)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left ${i === active ? 'bg-blue-50' : ''}`}
                  >
                    {d ? (
                      <>
                        <DriverAvatar driver={d} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">{driverLabel(d)}</span>
                          {d.displayName?.trim() && <span className="block text-xs text-gray-500 truncate">{d.email}</span>}
                        </span>
                      </>
                    ) : (
                      <span className="flex-1 text-sm text-gray-600">{clearLabel}</span>
                    )}
                    {isSelected && <Check size={14} className="text-blue-600 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
