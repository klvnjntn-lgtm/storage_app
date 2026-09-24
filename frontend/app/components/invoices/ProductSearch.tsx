'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Search, MapPin, MapPinOff, ChevronDown, Check, List, LayoutGrid, ImageOff,
  Minus, Plus, X, Percent, Pencil, ShoppingCart,
} from 'lucide-react';
import { DiscountType, LocationOption, ProductSearchResult, TaxRate } from './types';
import { formatIDR } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';
import { LineDiscountControl } from '@/app/components/shared/LineDiscountControl';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// A product the user just clicked in the results, held here — not yet in
// the cart — so its quantity/price/tax/discount can be set before it
// joins the real cart (and shows up in CartPanel). Mirrors CartLine's
// editable fields, minus the location bookkeeping the parent resolves at
// confirm time.
type StagedLine = {
  product: ProductSearchResult;
  quantity: number;
  unitPrice: number;
  unit: string | null;
  taxRateIds: string[];
  discountType: DiscountType | null;
  discountValue: number | null;
};

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
  taxRates,
}: {
  query: string;
  setQuery: (q: string) => void;
  results: ProductSearchResult[];
  searching: boolean;
  locations: LocationOption[];
  locationFilter: LocationOption | null;
  onSelectLocationFilter: (loc: LocationOption | null) => void;
  // Returns false when the parent rejected the add (e.g. not enough
  // stock) — the staging card then stays open with its inputs intact
  // instead of clearing, so the person can adjust quantity and retry.
  onAddToCart: (
    product: ProductSearchResult,
    details: {
      quantity: number;
      unitPrice: number;
      unit: string | null;
      taxRateIds: string[];
      discountType: DiscountType | null;
      discountValue: number | null;
    },
  ) => boolean;
  posModeEnabled: boolean;
  taxRates: TaxRate[];
}) {
  const { t } = useLanguage();
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const locationDropdownRef = useRef<HTMLDivElement>(null);
  // Grid view is the only place a product's photo shows up here — the list
  // rows stay text-only/compact, matching how this search looked before
  // products could have images at all.
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [brokenImageIds, setBrokenImageIds] = useState<Record<string, boolean>>({});

  const [staged, setStaged] = useState<StagedLine | null>(null);
  const [editingStagedPrice, setEditingStagedPrice] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (locationDropdownRef.current && !locationDropdownRef.current.contains(e.target as Node)) {
        setLocationDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Same target-resolution rule every page's addToCart uses: the filtered
  // location's stock if one's picked, otherwise whichever location has the
  // most on hand. Used here only to cap the staged quantity stepper —
  // the parent re-derives and re-validates this independently on confirm.
  function resolveTarget(product: ProductSearchResult) {
    if (locationFilter) {
      return product.stockByLocation.find((s) => s.locationId === locationFilter.id);
    }
    return [...product.stockByLocation].sort((a, b) => b.quantity - a.quantity)[0];
  }

  function selectProduct(product: ProductSearchResult) {
    const defaultRate = taxRates.find((r) => r.isDefault);
    setStaged({
      product,
      quantity: 1,
      unitPrice: product.sellingPrice ?? 0,
      unit: product.unit ?? null,
      taxRateIds: defaultRate ? [defaultRate.id] : [],
      discountType: null,
      discountValue: null,
    });
    setEditingStagedPrice(false);
  }

  function confirmStaged() {
    if (!staged) return;
    const added = onAddToCart(staged.product, {
      quantity: staged.quantity,
      unitPrice: staged.unitPrice,
      unit: staged.unit,
      taxRateIds: staged.taxRateIds,
      discountType: staged.discountType,
      discountValue: staged.discountValue,
    });
    if (added) {
      setStaged(null);
      setEditingStagedPrice(false);
    }
  }

  const stagedAvailable = staged ? resolveTarget(staged.product)?.quantity ?? 0 : 0;
  const stagedSubtotal = staged ? round2(staged.unitPrice * staged.quantity) : 0;
  const stagedDiscountAmount = staged
    ? staged.discountType === 'PERCENTAGE'
      ? round2(stagedSubtotal * ((staged.discountValue ?? 0) / 100))
      : staged.discountType === 'FIXED'
      ? round2(Math.min(staged.discountValue ?? 0, stagedSubtotal))
      : 0
    : 0;
  const stagedNet = round2(stagedSubtotal - stagedDiscountAmount);
  const stagedTaxAmount = staged
    ? round2(
        taxRates
          .filter((r) => staged.taxRateIds.includes(r.id))
          .reduce((sum, r) => sum + stagedNet * (r.percentage / 100), 0),
      )
    : 0;
  const stagedTotal = round2(stagedNet + stagedTaxAmount);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">
          <Search size={14} strokeWidth={2} className="text-blue-600/70" />
          {t('sales.productSearch.searchItem')}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-blue-500/20 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            title={t('sales.productSearch.listView')}
            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
              viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-blue-700'
            }`}
          >
            <List size={13} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            title={t('sales.productSearch.gridView')}
            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
              viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-blue-700'
            }`}
          >
            <LayoutGrid size={13} strokeWidth={2.5} />
          </button>
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
            {locationFilter ? locationFilter.name : t('sales.productSearch.allLocations')}
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
                  {t('sales.productSearch.allLocations')}
                </span>
                {!locationFilter && <Check size={14} strokeWidth={2.5} className="ml-auto text-blue-600 shrink-0" />}
              </button>

              <div className="max-h-64 overflow-y-auto">
                {locations.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">{t('sales.productSearch.noLocationsFound')}</p>}
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
          placeholder={t('sales.productSearch.searchPlaceholder')}
          autoFocus
          className="flex-1 min-w-0 text-base sm:text-sm outline-none placeholder:text-gray-400 bg-transparent"
        />
      </div>

      {staged && (
        <div className="mt-3 border-2 border-blue-500/40 bg-blue-50/30 rounded-xl p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <ShoppingCart size={13} strokeWidth={2} className="text-blue-600/70 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-blue-900/60 uppercase tracking-wide">
                  {t('sales.productSearch.adjustBeforeAdding')}
                </p>
                <p className="text-sm font-medium break-words leading-snug">{staged.product.name}</p>
              </div>
            </div>
            <button
              onClick={() => {
                setStaged(null);
                setEditingStagedPrice(false);
              }}
              className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-blue-700 hover:bg-white shrink-0"
              aria-label={t('sales.productSearch.cancelSelection')}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-2">
            {posModeEnabled ? (
              editingStagedPrice ? (
                <div className="flex items-center gap-1 bg-white border-2 border-blue-600 rounded-md pl-2 pr-1 py-1">
                  <span className="text-xs text-gray-400">Rp</span>
                  <input
                    type="number"
                    min={0}
                    autoFocus
                    value={staged.unitPrice}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      setStaged((prev) => (prev ? { ...prev, unitPrice: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 } : prev));
                    }}
                    onBlur={() => setEditingStagedPrice(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setEditingStagedPrice(false);
                    }}
                    className="w-20 text-xs outline-none"
                  />
                </div>
              ) : (
                <button
                  onClick={() => setEditingStagedPrice(true)}
                  className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-blue-500/20 bg-white text-gray-700 hover:border-blue-500/50 hover:bg-blue-50/50 transition-colors"
                >
                  <Pencil size={10} strokeWidth={2} className="text-gray-400" />
                  {formatIDR(staged.unitPrice)}
                </button>
              )
            ) : (
              <span className="text-xs text-gray-500">{formatIDR(staged.unitPrice)}</span>
            )}

            <div className="flex items-center gap-1.5">
              <button
                onClick={() =>
                  setStaged((prev) => (prev ? { ...prev, quantity: Math.max(1, prev.quantity - 1) } : prev))
                }
                disabled={staged.quantity <= 1}
                className="w-7 h-7 flex items-center justify-center border border-blue-500/20 rounded-md bg-white hover:bg-blue-50/60 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Minus size={14} strokeWidth={2} />
              </button>
              <span className="w-5 text-center text-sm">{staged.quantity}</span>
              <button
                onClick={() => setStaged((prev) => (prev ? { ...prev, quantity: prev.quantity + 1 } : prev))}
                disabled={!posModeEnabled && staged.quantity >= stagedAvailable}
                className="w-7 h-7 flex items-center justify-center border border-blue-500/20 rounded-md bg-white hover:bg-blue-50/60 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={14} strokeWidth={2} />
              </button>
            </div>

            <span className="text-xs text-gray-400">
              = <span className="font-medium text-gray-700">{formatIDR(stagedSubtotal)}</span>
            </span>
          </div>

          <LineDiscountControl
            discountType={staged.discountType}
            discountValue={staged.discountValue}
            discountAmount={stagedDiscountAmount}
            onChange={(discountType, rawValue) =>
              setStaged((prev) => {
                if (!prev) return prev;
                if (discountType === null) return { ...prev, discountType: null, discountValue: null };
                const parsed = Number(rawValue);
                const clamped = discountType === 'PERCENTAGE' ? Math.min(parsed, 100) : parsed;
                const nextValue = Number.isFinite(clamped) && clamped >= 0 ? clamped : (prev.discountValue ?? 0);
                return { ...prev, discountType, discountValue: nextValue };
              })
            }
          />

          {taxRates.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-0.5 mt-1.5">
              <span className="flex items-center gap-1 text-[11px] text-gray-400">
                <Percent size={10} strokeWidth={2} />
                {t('sales.invoiceCart.taxLabel')}
              </span>
              {taxRates.map((rate) => {
                const checked = staged.taxRateIds.includes(rate.id);
                return (
                  <label key={rate.id} className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setStaged((prev) => {
                          if (!prev) return prev;
                          const has = prev.taxRateIds.includes(rate.id);
                          return {
                            ...prev,
                            taxRateIds: has
                              ? prev.taxRateIds.filter((id) => id !== rate.id)
                              : [...prev.taxRateIds, rate.id],
                          };
                        })
                      }
                      className="w-3.5 h-3.5 accent-blue-600"
                    />
                    {rate.name} ({rate.percentage}%)
                  </label>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between mt-3 pt-2 border-t border-blue-500/15">
            <span className="text-sm font-semibold">{formatIDR(stagedTotal)}</span>
            <button
              onClick={confirmStaged}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold transition-colors"
            >
              <ShoppingCart size={14} strokeWidth={2} />
              {t('sales.productSearch.addToCart')}
            </button>
          </div>
        </div>
      )}

      <div className={viewMode === 'grid' ? 'mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2' : 'mt-3 flex flex-col gap-2'}>
        {searching && <p className="text-sm text-gray-500">{t('sales.productSearch.searching')}</p>}
        {!searching && query && results.length === 0 && <p className="text-sm text-gray-500">{t('sales.productSearch.noMatchingItems')}</p>}
        {!searching && !query && locationFilter && results.length === 0 && (
          <p className="text-sm text-gray-500">{t('sales.productSearch.nothingStockedAt', { location: locationFilter.name })}</p>
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

          if (viewMode === 'grid') {
            const showImage = product.image && !brokenImageIds[product.id];
            return (
              <div
                key={product.id}
                onClick={() => {
                  if (outOfStock) return;
                  selectProduct(product);
                }}
                className={`border rounded-xl overflow-hidden transition-colors ${
                  outOfStock
                    ? 'opacity-50 cursor-not-allowed border-gray-200'
                    : 'cursor-pointer border-blue-500/15 hover:bg-blue-50/50 active:bg-blue-50 hover:border-blue-500/35'
                }`}
              >
                <div className="aspect-square bg-blue-50/40 flex items-center justify-center">
                  {showImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.image as string}
                      alt={product.name}
                      className="w-full h-full object-cover"
                      onError={() => setBrokenImageIds((prev) => ({ ...prev, [product.id]: true }))}
                    />
                  ) : (
                    <ImageOff size={22} strokeWidth={1.75} className="text-blue-200" />
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium break-words leading-snug line-clamp-2">{product.name}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{product.sku ?? '—'}</p>
                  {!posModeEnabled && (
                    <p className="text-xs font-semibold mt-1">
                      {product.sellingPrice != null ? formatIDR(product.sellingPrice) : t('sales.productSearch.noPrice')}
                    </p>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div
              key={product.id}
              onClick={() => {
                if (outOfStock) return;
                selectProduct(product);
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
                    {product.sellingPrice != null ? formatIDR(product.sellingPrice) : t('sales.productSearch.noPrice')}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {product.stockByLocation.length === 0 && <span className="text-xs text-gray-400">{t('sales.productSearch.noStockRecorded')}</span>}
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