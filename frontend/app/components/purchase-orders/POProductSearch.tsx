// app/components/purchase-orders/POProductSearch.tsx
'use client';

import { useEffect, useState } from 'react';
import { Search, Plus, Minus, X, List, LayoutGrid, ImageOff, ShoppingCart } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { POProduct } from './types';
import { useLanguage } from '@/app/context/LanguageContext';

const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  onAddProduct: (product: POProduct, details: { quantity: number; unitCost: number }) => void;
};

// A product just clicked in the results, held here — not yet in the
// cart — so its quantity/unit cost can be set before it joins the real
// cart. Mirrors the sales-side ProductSearch staging card, minus
// tax/discount, which purchase-order lines don't have.
type StagedLine = {
  product: POProduct;
  quantity: number;
  unitCost: number;
};

export function POProductSearch({ onAddProduct }: Props) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<POProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [brokenImageIds, setBrokenImageIds] = useState<Record<string, boolean>>({});
  const [staged, setStaged] = useState<StagedLine | null>(null);

  function selectProduct(product: POProduct) {
    setStaged({ product, quantity: 1, unitCost: 0 });
  }

  function confirmStaged() {
    if (!staged) return;
    onAddProduct(staged.product, { quantity: staged.quantity, unitCost: staged.unitCost });
    setStaged(null);
  }

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
          data.map((p: any) => ({
            id: p.id,
            name: p.name,
            sku: p.sku ?? null,
            barcode: p.barcode ?? null,
            image: p.image ?? null,
          })),
        );
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="border-2 border-gray-200 rounded-md p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={16} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('purchasing.productSearch.searchPlaceholder')}
            className="w-full border-2 border-gray-300 focus:border-black rounded-md pl-9 pr-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border-2 border-gray-200 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            title={t('purchasing.productSearch.listView')}
            className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
              viewMode === 'list' ? 'bg-black text-white' : 'text-gray-400 hover:text-black'
            }`}
          >
            <List size={13} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            title={t('purchasing.productSearch.gridView')}
            className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
              viewMode === 'grid' ? 'bg-black text-white' : 'text-gray-400 hover:text-black'
            }`}
          >
            <LayoutGrid size={13} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {staged && (
        <div className="mb-3 border-2 border-black rounded-md p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <ShoppingCart size={13} strokeWidth={2} className="text-gray-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  {t('purchasing.productSearch.adjustBeforeAdding')}
                </p>
                <p className="text-sm font-medium break-words leading-snug">{staged.product.name}</p>
              </div>
            </div>
            <button
              onClick={() => setStaged(null)}
              className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-black hover:bg-gray-100 shrink-0"
              aria-label={t('purchasing.productSearch.cancelSelection')}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>

          <div className="flex items-center gap-4 flex-wrap mb-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">{t('purchasing.purchaseOrderNew.colQty')}</label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setStaged((prev) => (prev ? { ...prev, quantity: Math.max(1, prev.quantity - 1) } : prev))}
                  disabled={staged.quantity <= 1}
                  className="w-7 h-7 flex items-center justify-center border-2 border-gray-200 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Minus size={14} strokeWidth={2} />
                </button>
                <span className="w-6 text-center text-sm">{staged.quantity}</span>
                <button
                  onClick={() => setStaged((prev) => (prev ? { ...prev, quantity: prev.quantity + 1 } : prev))}
                  className="w-7 h-7 flex items-center justify-center border-2 border-gray-200 rounded hover:bg-gray-100"
                >
                  <Plus size={14} strokeWidth={2} />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-gray-500 mb-1">{t('purchasing.purchaseOrderNew.colUnitCost')}</label>
              <input
                type="number"
                min={0}
                value={staged.unitCost}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  setStaged((prev) => (prev ? { ...prev, unitCost: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 } : prev));
                }}
                className="w-28 border-2 border-gray-300 focus:border-black rounded-md px-2 py-1.5 text-sm outline-none"
              />
            </div>
          </div>

          <button
            onClick={confirmStaged}
            className="w-full flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black hover:bg-gray-800 text-white font-semibold transition-colors"
          >
            <ShoppingCart size={14} strokeWidth={2} />
            {t('purchasing.productSearch.addToCart')}
          </button>
        </div>
      )}

      {searching && <p className="text-sm text-gray-400">{t('purchasing.productSearch.searching')}</p>}

      {!searching && results.length > 0 && viewMode === 'list' && (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {results.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProduct(p)}
              className="w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md hover:bg-gray-100 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium truncate block">{p.name}</span>
                {p.sku && <span className="text-xs text-gray-500">{t('purchasing.productSearch.skuLabel', { sku: p.sku })}</span>}
              </span>
              <Plus size={16} strokeWidth={2} className="text-gray-400 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {!searching && results.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto">
          {results.map((p) => {
            const showImage = p.image && !brokenImageIds[p.id];
            return (
              <button
                key={p.id}
                onClick={() => selectProduct(p)}
                className="text-left border-2 border-gray-200 rounded-md overflow-hidden hover:border-black transition-colors"
              >
                <div className="aspect-square bg-gray-50 flex items-center justify-center">
                  {showImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image as string}
                      alt={p.name}
                      className="w-full h-full object-cover"
                      onError={() => setBrokenImageIds((prev) => ({ ...prev, [p.id]: true }))}
                    />
                  ) : (
                    <ImageOff size={18} strokeWidth={1.75} className="text-gray-300" />
                  )}
                </div>
                <div className="p-1.5">
                  <p className="text-xs font-medium truncate">{p.name}</p>
                  {p.sku && <p className="text-[10px] text-gray-500 truncate">{t('purchasing.productSearch.skuLabel', { sku: p.sku })}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!searching && query.trim() && results.length === 0 && (
        <p className="text-sm text-gray-400">{t('purchasing.productSearch.noProducts')}</p>
      )}
    </div>
  );
}