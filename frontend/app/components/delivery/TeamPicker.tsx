'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Users, X } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { driverLabel, DriverAvatar, type PickerDriver } from './DriverPicker';

// A team with its driver (one per team) — the shape GET /teams members and
// the route endpoints' `team` both reduce to.
export type PickerTeam = {
  id: string;
  name: string;
  driver: PickerDriver | null;
};

// GET /teams returns members[]; routes return driver directly.
export function toPickerTeam(team: { id: string; name: string; members?: PickerDriver[]; driver?: PickerDriver | null }): PickerTeam {
  return { id: team.id, name: team.name, driver: team.driver ?? team.members?.[0] ?? null };
}

export function teamLabel(team: PickerTeam, noDriver: string) {
  return `${team.name} · ${team.driver ? driverLabel(team.driver) : noDriver}`;
}

// Searchable team dropdown (routes belong to teams). Matches team or driver name.
export default function TeamPicker({
  teams,
  value,
  onChange,
  clearLabel,
  disabled,
  className = '',
}: {
  teams: PickerTeam[];
  value: string;
  onChange: (teamId: string) => void;
  // When set, shows a first option with this label that selects '' (e.g. "All teams").
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

  const selected = teams.find((x) => x.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? teams.filter((x) =>
          [x.name, x.driver?.displayName ?? '', x.driver?.email ?? ''].some((s) => s.toLowerCase().includes(q)),
        )
      : teams;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [teams, query]);

  const options: (PickerTeam | null)[] = clearLabel !== undefined && !query ? [null, ...filtered] : filtered;

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

  function choose(x: PickerTeam | null) {
    onChange(x?.id ?? '');
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
            <Users size={16} className="text-blue-600 shrink-0" />
            <span className="truncate flex-1">{teamLabel(selected, t('delivery.teams.noDriver'))}</span>
          </>
        ) : (
          <span className="truncate flex-1 text-gray-500">{clearLabel ?? t('delivery.teams.pickerPlaceholder')}</span>
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
              placeholder={t('delivery.teams.pickerSearch')}
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
            {options.map((x, i) => {
              const isSelected = x ? x.id === value : value === '';
              return (
                <li key={x?.id ?? '__clear'}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(x)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left ${i === active ? 'bg-blue-50' : ''}`}
                  >
                    {x ? (
                      <>
                        {x.driver ? (
                          <DriverAvatar driver={x.driver} />
                        ) : (
                          <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                            <Users size={14} className="text-gray-400" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">{x.name}</span>
                          <span className={`block text-xs truncate ${x.driver ? 'text-gray-500' : 'text-amber-600'}`}>
                            {x.driver ? driverLabel(x.driver) : t('delivery.teams.noDriver')}
                          </span>
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
