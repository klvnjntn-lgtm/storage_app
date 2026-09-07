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
          <Search size={14} strokeWidth={2} className="text-blue-600/70" />
          Search item
        </div>

        <div className="relative" ref={locationDropdownRef}>
          <button
            onClick={() => setLocationDropdownOpen((v) => !v)}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-2 sm:py-1.5 rounded-lg border transition-colors ${
              locationFilter
                ? 'border-blue-600/30 bg-blue-600/10 text-blue-700'
                : 'border-blue-500/20 text-gray-500 hover:border-blue-500/40 hover:text-blue-700'
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
            <div className="absolute right-0 z-10 mt-1.5 w-56 max-w-[calc(100vw-2rem)] bg-white border border-blue-500/20 rounded-xl shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setLocationDropdownOpen(false);
                  onSelectLocationFilter(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 sm:py-2 text-sm text-left hover:bg-blue-50/60 active:bg-blue-50 border-b border-gray-100"
              >
                <MapPinOff size={14} strokeWidth={2} className="text-gray-400 shrink-0" />
                <span className={!locationFilter ? 'font-semibold text-blue-700' : 'text-gray-700'}>
                  All locations
                </span>
                {!locationFilter && <Check size={14} strokeWidth={2.5} className="ml-auto text-blue-600 shrink-0" />}
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
                      className="w-full flex items-center gap-2 px-3 py-2.5 sm:py-2 text-sm text-left hover:bg-blue-50/60 active:bg-blue-50"
                    >
                      <MapPin size={14} strokeWidth={2} className={`shrink-0 ${selected ? 'text-blue-600' : 'text-gray-400'}`} />
                      <span className={`break-words ${selected ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>
                        {loc.name}
                      </span>
                      {selected && <Check size={14} strokeWidth={2.5} className="ml-auto text-blue-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
        <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, SKU, or OEM..."
          autoFocus
          className="flex-1 min-w-0 text-base sm:text-sm outline-none placeholder:text-gray-400 bg-transparent"
        />
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {searching && <p className="text-sm text-gray-500">Searching...</p>}
        {!searching && query && results.length === 0 && <p className="text-sm text-gray-500">No matching items</p>}
        {!searching && !query && locationFilter && results.length === 0 && (
          <p className="text-sm text-gray-500">Nothing stocked at {locationFilter.name}</p>
        )}

        {results.map((product) => {
          // Stock shown/checked always matches the active location filter
          // (or the sum across all locations when there isn't one) — this
          // is what addToCart() in the parent page actually checks, so the
          // card never implies availability that clicking it would reject.
          const relevantStock = locationFilter
            ? product.stockByLocation.find((s) => s.locationId === locationFilter.id)?.quantity ?? 0
            : product.stockByLocation.reduce((s, l) => s + l.quantity, 0);
          const outOfStock = !posModeEnabled && relevantStock === 0;
          return (
            <div
              key={product.id}
              onClick={() => {
                if (outOfStock) return;
                onAddToCart(product);
              }}
              className={`border rounded-xl p-3 transition-colors ${
                outOfStock
                  ? 'opacity-50 cursor-not-allowed border-gray-200'
                  : 'cursor-pointer border-blue-500/15 hover:bg-blue-50/50 active:bg-blue-50 hover:border-blue-500/35'
              }`}
            >
              {/* items-start (not items-center) + break-words + min-w-0 on
                  the text column: a long product name now wraps onto a
                  second line inside the card instead of forcing a single
                  line that widens the page. The price column keeps
                  shrink-0 so it never gets squeezed by a long name. */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words leading-snug">{product.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{product.sku ?? '—'}</p>
                </div>
                {!posModeEnabled && (
                  <span className="text-sm font-semibold shrink-0 text-right whitespace-nowrap">
                    {product.sellingPrice != null ? formatIDR(product.sellingPrice) : 'No price'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {product.stockByLocation.length === 0 && <span className="text-xs text-gray-400">No stock recorded</span>}
                {product.stockByLocation.map((s) => (
                  <span
                    key={s.locationId}
                    className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border max-w-full ${
                      locationFilter && s.locationId !== locationFilter.id
                        ? 'border-gray-200 text-gray-400'
                        : 'border-blue-500/20 text-blue-700 bg-blue-600/5'
                    }`}
                  >
                    <MapPin size={10} strokeWidth={2} className="shrink-0" />
                    <span className="truncate">{s.locationName}: {s.quantity}</span>
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