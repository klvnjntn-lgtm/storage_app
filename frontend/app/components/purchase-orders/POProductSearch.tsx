// app/components/purchase-orders/POProductSearch.tsx
'use client';

import { useEffect, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { POProduct } from './types';

const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  onAddProduct: (product: POProduct) => void;
};

export function POProductSearch({ onAddProduct }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<POProduct[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: query.trim() });
        // NOTE: reusing the invoice product search endpoint — there's no
        // purchase-specific one. We only use id/name/sku/barcode from it.
        const res = await apiFetch(`/products/search-for-invoice?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        setResults(
          data.map((p: any) => ({ id: p.id, name: p.name, sku: p.sku ?? null, barcode: p.barcode ?? null })),
        );
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="border-2 border-gray-200 rounded-md p-4">
      <div className="relative mb-3">
        <Search size={16} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products by name or SKU..."
          className="w-full border-2 border-gray-300 focus:border-black rounded-md pl-9 pr-3 py-2 text-sm outline-none"
        />
      </div>

      {searching && <p className="text-sm text-gray-400">Searching...</p>}

      {!searching && results.length > 0 && (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {results.map((p) => (
            <button
              key={p.id}
              onClick={() => onAddProduct(p)}
              className="w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md hover:bg-gray-100 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium truncate block">{p.name}</span>
                {p.sku && <span className="text-xs text-gray-500">SKU: {p.sku}</span>}
              </span>
              <Plus size={16} strokeWidth={2} className="text-gray-400 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {!searching && query.trim() && results.length === 0 && (
        <p className="text-sm text-gray-400">No products found.</p>
      )}
    </div>
  );
}