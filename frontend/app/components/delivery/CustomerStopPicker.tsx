'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, MapPin, MapPinOff, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

export type StopCustomer = {
  id: string;
  name: string;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
};

const SEARCH_DEBOUNCE_MS = 250;

// Picks a customer to visit as a route stop (orgs without INVOICE_POS).
// Only customers with a location pin can be chosen; the rest link to the
// customer page so the pin can be set there.
export default function CustomerStopPicker({
  value,
  onChange,
  disabled,
  className = '',
}: {
  value: StopCustomer | null;
  onChange: (customer: StopCustomer | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StopCustomer[]>([]);
  const [searching, setSearching] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const q = query.trim();
        const res = await apiFetch(q ? `/customers?q=${encodeURIComponent(q)}` : '/customers');
        if (res.ok) setResults(await res.json());
      } catch {
        // network/session errors are surfaced by apiFetch; keep the old list
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [open, query]);

  const hasPin = (c: StopCustomer) => c.latitude != null && c.longitude != null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (open) return setOpen(false);
          setQuery('');
          setOpen(true);
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
        className="w-full flex items-center gap-2 border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm bg-white text-left hover:border-blue-300 disabled:opacity-50 sm:min-w-[260px]"
      >
        <span className={`truncate flex-1 ${value ? '' : 'text-gray-500'}`}>
          {value ? value.name : t('delivery.routeDetail.selectCustomer')}
        </span>
        <ChevronDown size={14} className="shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full sm:w-96 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-gray-100">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('delivery.routeDetail.searchCustomer')}
              className="flex-1 min-w-0 text-base sm:text-sm outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
            {!searching && results.length === 0 && (
              <li className="px-3 py-3 text-sm text-gray-500">{t('delivery.driverPicker.noMatches')}</li>
            )}
            {results.map((c) =>
              hasPin(c) ? (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value?.id === c.id}
                    onClick={() => {
                      onChange(c);
                      setOpen(false);
                    }}
                    className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-blue-50"
                  >
                    <MapPin size={14} className="text-green-600 shrink-0 mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{c.name}</span>
                      {c.address && <span className="block text-xs text-gray-500 truncate">{c.address}</span>}
                    </span>
                    {value?.id === c.id && <Check size={14} className="text-blue-600 shrink-0" />}
                  </button>
                </li>
              ) : (
                <li key={c.id} className="flex items-start gap-2.5 px-3 py-2">
                  <MapPinOff size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate text-gray-400">{c.name}</span>
                    <span className="block text-xs text-amber-700">
                      {t('delivery.routeDetail.customerNoPin')}{' '}
                      <Link href={`/customers/${c.id}`} className="underline">
                        {t('delivery.routeDetail.setCustomerPin')}
                      </Link>
                    </span>
                  </span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
