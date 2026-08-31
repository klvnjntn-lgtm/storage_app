// components/invoices/ProductSearch.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, MapPin, MapPinOff, ChevronDown, Check } from 'lucide-react';
import { LocationOption, ProductSearchResult } from './types';
import { formatIDR } from '@/lib/format';

export function ProductSearch({
  query,
  setQuery,
  results,
  searching,
  locations,
  locationFilter,
  onSelectLocationFilter,
  onAddToCart,
  posModeEnabled,
}: {
  query: string;
  setQuery: (q: string) => void;
  results: ProductSearchResult[];
  searching: boolean;
  locations: LocationOption[];
  locationFilter: LocationOption | null;
  onSelectLocationFilter: (loc: LocationOption | null) => void;
  onAddToCart: (product: ProductSearchResult) => void;
  posModeEnabled: boolean;
}) {
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const locationDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (locationDropdownRef.current && !locationDropdownRef.current.contains(e.target as Node)) {
        setLocationDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">
          <Search size={14} strokeWidth={2} />
          Search item
        </div>

        <div className="relative" ref={locationDropdownRef}>
          <button
            onClick={() => setLocationDropdownOpen((v) => !v)}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-2 sm:py-1.5 rounded-md border-2 transition-colors ${
              locationFilter
                ? 'border-black bg-black text-white'
                : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-black'
            }`}
          >
            <MapPin size={12} strokeWidth={2} />
            {locationFilter ? locationFilter.name : 'All locations'}
            <ChevronDown
              size={12}
              strokeWidth={2.5}
              className={`transition-transform ${locationDropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {locationDropdownOpen && (
            <div className="absolute right-0 z-10 mt-1.5 w-56 max-w-[calc(100vw-2rem)] bg-white border-2 border-gray-200 rounded-md shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setLocationDropdownOpen(false);
                  onSelectLocationFilter(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 sm:py-2 text-sm text-left hover:bg-gray-50 active:bg-gray-100 border-b border-gray-100"
              >
                <MapPinOff size={14} strokeWidth={2} className="text-gray-400" />
                <span className={!locationFilter ? 'font-semibold' : 'text-gray-700'}>All locations</span>
                {!locationFilter && <Check size={14} strokeWidth={2.5} className="ml-auto text-black" />}
              </button>

              <div className="max-h-64 overflow-y-auto">
                {locations.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No locations found</p>}
                {locations.map((loc) => {
                  const selected = locationFilter?.id === loc.id;
                  return (
                    <button
                      key={loc.id}
                      onClick={() => {
                        setLocationDropdownOpen(false);
                        onSelectLocationFilter(selected ? null : loc);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 sm:py-2 text-sm text-left hover:bg-gray-50 active:bg-gray-100"
                    >
                      <MapPin size={14} strokeWidth={2} className={selected ? 'text-black' : 'text-gray-400'} />
                      <span className={selected ? 'font-semibold' : 'text-gray-700'}>{loc.name}</span>
                      {selected && <Check size={14} strokeWidth={2.5} className="ml-auto text-black" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, SKU, or OEM..."
        autoFocus
        className="w-full border-2 border-gray-300 rounded-md p-3 text-base sm:text-sm outline-none focus:border-black"
      />

      <div className="mt-3 flex flex-col gap-2">
        {searching && <p className="text-sm text-gray-500">Searching...</p>}
        {!searching && query && results.length === 0 && <p className="text-sm text-gray-500">No matching items</p>}
        {!searching && !query && locationFilter && results.length === 0 && (
          <p className="text-sm text-gray-500">Nothing stocked at {locationFilter.name}</p>
        )}

        {results.map((product) => {
          // FIX — was summing stockByLocation across ALL locations even
          // when a location filter was active, so a product with stock
          // elsewhere but zero at the filtered location rendered as
          // fully available. addToCart() (in the parent page) already
          // checks stock at the specific filtered location — this now
          // matches that same logic so the card's appearance doesn't
          // lie about what clicking it will actually do.
          const relevantStock = locationFilter
            ? product.stockByLocation.find((s) => s.locationId === locationFilter.id)?.quantity ?? 0
            : product.stockByLocation.reduce((s, l) => s + l.quantity, 0);
          const outOfStock = !posModeEnabled && relevantStock === 0;
          return (
            <div
              key={product.id}
              // FIX — the card's disabled styling wasn't backed by an
              // actual guard; clicking it while "disabled" still fired
              // onAddToCart and relied on the parent to reject it with
              // an error. Now a visually disabled card behaves disabled.
              onClick={() => {
                if (outOfStock) return;
                onAddToCart(product);
              }}
              className={`border-2 rounded-md p-3 transition-colors ${
                outOfStock
                  ? 'opacity-50 cursor-not-allowed border-gray-200'
                  : 'cursor-pointer border-gray-300 hover:bg-gray-50 active:bg-gray-100 hover:border-gray-400'
              }`}
            >
              <div className="flex items-start sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{product.name}</p>
                  <p className="text-xs text-gray-500">{product.sku ?? '—'}</p>
                </div>
                {!posModeEnabled && (
                  <span className="text-sm font-semibold shrink-0 text-right">
                    {product.sellingPrice != null ? formatIDR(product.sellingPrice) : 'No price'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {product.stockByLocation.length === 0 && <span className="text-xs text-gray-400">No stock recorded</span>}
                {product.stockByLocation.map((s) => (
                  <span
                    key={s.locationId}
                    className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border ${
                      locationFilter && s.locationId !== locationFilter.id
                        ? 'border-gray-200 text-gray-400'
                        : 'border-gray-300 text-gray-700'
                    }`}
                  >
                    <MapPin size={10} strokeWidth={2} />
                    {s.locationName}: {s.quantity}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}