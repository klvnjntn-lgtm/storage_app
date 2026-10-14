'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

export type PickedProduct = { id: string; name: string; sku: string | null; unit?: string | null; trackSerials?: boolean };

// Search-as-you-type over the product list (/products/search), for forms
// that add one product at a time (transfers, batches, reorder settings).
export function ProductPicker({ onPick, placeholder }: { onPick: (p: PickedProduct) => void; placeholder?: string }) {
  const { t } = useLanguage();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/products/search?q=${encodeURIComponent(query)}`);
        if (!res.ok || mine !== seq.current) return;
        const body = await res.json();
        const list: PickedProduct[] = (body.products ?? body ?? []).slice(0, 12);
        setResults(list);
        setOpen(true);
      } catch {
        // leave the previous results
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 border border-gray-300 rounded-md px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-blue-500/30">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value.trim()) {
              setResults([]);
              setOpen(false);
            }
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder ?? t('common.search')}
          className="flex-1 text-sm outline-none bg-transparent"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(p);
                  setQ('');
                  setResults([]);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
              >
                <span className="font-medium">{p.name}</span>
                {p.sku && <span className="ml-2 text-xs text-gray-500">{p.sku}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Locations for a select. Shared by the transfer and return forms.
export function useLocations() {
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    (async () => {
      const res = await apiFetch('/locations').catch(() => null);
      if (res?.ok) setLocations(await res.json());
    })();
  }, []);
  return locations;
}

// Active suppliers for a select (the list endpoint is paginated; one big
// page is plenty for a picker).
export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    (async () => {
      const res = await apiFetch('/suppliers?isActive=true&pageSize=200').catch(() => null);
      if (!res?.ok) return;
      const body = await res.json();
      setSuppliers(Array.isArray(body) ? body : (body.data ?? body.items ?? []));
    })();
  }, []);
  return suppliers;
}
