// app/admin/products/page.tsx
'use client';

import ProductEditorDrawer from '@/app/components/admin/ProductEditorDrawer';
import { useEffect, useState } from 'react';
import { display } from '@/lib/fonts';
import { Package, AlertTriangle, CheckCircle2, Archive, ArchiveRestore, Pencil, Plus, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { usePriceLevels } from '@/lib/price-levels';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import Pagination from '@/app/components/shared/Pagination';
import SortableTh from '@/app/components/shared/SortableTh';
import { useWarehouseOps } from '@/lib/hooks/useWarehouseOps';
import { useLanguage } from '@/app/context/LanguageContext';
import { errorMessage } from '@/lib/api-error';


type Product = {
  id: string;
  sku: string | null;
  oem?: string | null;
  name: string;
  category?: string | null;
  brand?: string | null;
  active: boolean;
  sellingPrice: number | null;
  costPrice: number | null;
  // Non-default price level prices (see ProductEditorDrawer).
  prices?: { priceLevelId: string; price: number }[];
};

// Stock lives per-location (see the Stock page), not as a scalar on the
// product itself — this is a read-only summary keyed by productId.
type StockSummary = {
  totalStock: number;
  locations: { location: string; qty: number }[];
};

type Option = { id: string; name: string };
type Location = { id: string; name: string };

// Columns the table can be sorted by, same as Stock's SortKey. OEM and
// brand ride along under the name rather than getting their own column.
type SortKey = 'sku' | 'name' | 'category' | 'brand' | 'sellingPrice' | 'costPrice' | 'stock';

const PAGE_SIZE_DEFAULT = 20;
const LOW_STOCK_THRESHOLD = 5;
// Level prices listed under the default price before collapsing to "+N".
const LEVEL_PRICES_SHOWN = 3;

// The session cookie and CSRF header are added by apiFetch; only the
// content type varies here.
function authHeaders(json = true): Record<string, string> {
  return json ? { 'Content-Type': 'application/json' } : {};
}

function StockBadge({ stock }: { stock: number | undefined }) {
  const { t } = useLanguage();
  if (stock == null) return <span className="text-gray-400">-</span>;
  if (stock <= 0) {
    return (
      <span className="inline-block text-xs px-2 py-0.5 rounded-md border font-medium bg-red-100 text-red-800 border-red-300 whitespace-nowrap">
        {t('admin.products.outOfStock')}
      </span>
    );
  }
  if (stock <= LOW_STOCK_THRESHOLD) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border font-medium bg-amber-100 text-amber-800 border-amber-300 whitespace-nowrap">
        <AlertTriangle size={11} strokeWidth={2.5} />
        {t('admin.products.stockLeft', { count: stock })}
      </span>
    );
  }
  return <span className="font-medium tabular-nums">{stock}</span>;
}

export default function ProductsPage() {
  const { authorized, loading: authLoading } = useRequireAdmin();
  const { t } = useLanguage();
  const { levels, defaultLevelId, activeLevelIds } = usePriceLevels();

  // One page of the catalog, searched and sorted on the server
  // (GET /products?page=…) — the full list no longer comes down.
  const [products, setProducts] = useState<Product[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);
  const [stockByProduct, setStockByProduct] = useState<Record<string, StockSummary>>({});
  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

  // --- Pagination ---
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);

  // Create and edit both happen in the side drawer: { product: null } is
  // a new product, null is closed. Stock is per-location, so the drawer
  // applies a delta through /stock/adjust rather than overwriting a total.
  const [editor, setEditor] = useState<{ product: Product | null } | null>(null);
  const warehouseOps = useWarehouseOps();

  async function loadProducts() {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
    if (sort) {
      params.set('sort', sort.key);
      params.set('dir', sort.direction);
    }
    const res = await apiFetch(`/products?${params}`, { headers: authHeaders(false) });
    const data = await res.json();
    setProducts(Array.isArray(data?.data) ? data.data : []);
    setTotalProducts(Number(data?.total ?? 0));
  }

  // Same asc -> desc -> off cycle the client-side hook had.
  function toggleSort(key: SortKey) {
    setSort((s) => (s?.key !== key ? { key, direction: 'asc' } : s.direction === 'asc' ? { key, direction: 'desc' } : null));
    setPage(1);
  }

  // Stock totals come from the same aggregated-by-location summary the
  // Stock page uses — this page only reads it, never writes to it directly
  // (writes go through /stock/adjust, same as the Stock page).
  async function loadStockSummary() {
    try {
      const res = await apiFetch('/sessions/summary', { headers: authHeaders(false) });
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, StockSummary> = {};
      if (Array.isArray(data)) {
        for (const row of data) {
          map[row.productId] = { totalStock: row.totalStock, locations: row.locations ?? [] };
        }
      }
      setStockByProduct(map);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadCategories() {
    const res = await apiFetch('/categories', { headers: authHeaders(false) });
    const data = await res.json();
    setCategories(Array.isArray(data) ? data : []);
  }

  async function loadBrands() {
    const res = await apiFetch('/brands', { headers: authHeaders(false) });
    const data = await res.json();
    setBrands(Array.isArray(data) ? data : []);
  }

  async function loadLocations() {
    try {
      const res = await apiFetch('/locations', { headers: authHeaders(false) });
      if (!res.ok) return;
      const data = await res.json();
      setLocations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadStockSummary();
    loadCategories();
    loadBrands();
    loadLocations();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    // loadProducts() only sets state after its fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, debouncedQuery, sort]);

  const totalPages = Math.max(1, Math.ceil(totalProducts / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function cellHighlight(key: SortKey) {
    return sort?.key === key ? 'bg-blue-50/70' : '';
  }

  function openEditor(product: Product | null) {
    setError('');
    setSuccessMsg('');
    setEditor({ product });
  }

  async function onEditorSaved(message: string) {
    const wasNew = editor?.product == null;
    setEditor(null);
    setSuccessMsg(message);
    if (wasNew) setPage(1);
    await Promise.all([loadProducts(), loadStockSummary(), loadCategories(), loadBrands()]);
  }

  function requestArchive(id: string) {
    setError('');
    setSuccessMsg('');
    setPendingArchiveId(id);
  }

  async function confirmArchive() {
    if (!pendingArchiveId) return;
    const id = pendingArchiveId;
    const product = products.find((p) => p.id === id);

    try {
      const res = await apiFetch(`/products/${id}`, {
        method: 'DELETE',
        headers: authHeaders(false),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || t('admin.products.archiveFailed'));
      }
      setSuccessMsg(t('admin.products.archivedSuccess', { name: product?.name ?? t('admin.products.productFallback') }));
      await loadProducts();
    } catch (err) {
      console.error(err);
      setError(errorMessage(err) || t('admin.products.archiveFailed'));
    } finally {
      setPendingArchiveId(null);
    }
  }

  async function restoreProduct(id: string) {
    setError('');
    setSuccessMsg('');
    const product = products.find((p) => p.id === id);

    try {
      const res = await apiFetch(`/products/${id}/restore`, {
        method: 'PATCH',
        headers: authHeaders(false),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || t('admin.products.restoreFailed'));
      }
      setSuccessMsg(t('admin.products.restoredSuccess', { name: product?.name ?? t('admin.products.productFallback') }));
      await loadProducts();
    } catch (err) {
      console.error(err);
      setError(errorMessage(err) || t('admin.products.restoreFailed'));
    }
  }

  // A product's prices at the active non-default levels, in level order.
  function levelPricesOf(product: Product) {
    return levels
      .filter((l) => l.id !== defaultLevelId && activeLevelIds.has(l.id))
      .flatMap((l) => {
        const own = product.prices?.find((p) => p.priceLevelId === l.id);
        return own ? [{ id: l.id, name: l.name, price: own.price }] : [];
      });
  }

  const defaultLevelName = levels.find((l) => l.id === defaultLevelId)?.name;
  const pendingProduct = products.find((p) => p.id === pendingArchiveId);

  if (authLoading || !authorized) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{
          backgroundColor: 'var(--page-bg)',
          backgroundImage:
            'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      >
        <p className="text-sm text-gray-400">{t('admin.overview.checkingAccess')}</p>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >

      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Package size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('admin.products.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('admin.products.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={() => openEditor(null)}
            className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 shadow-sm transition-colors"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span className="hidden sm:inline">{t('admin.products.newProduct')}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} aria-label={t('common.close')} className="text-red-700/60 hover:text-red-800">
              <X size={16} />
            </button>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
            <span className="flex-1">{successMsg}</span>
            <button onClick={() => setSuccessMsg('')} aria-label={t('common.close')} className="text-green-700/60 hover:text-green-800">
              <X size={16} />
            </button>
          </div>
        )}

        {pendingArchiveId && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-sm">
            <div className="flex items-center gap-2">
              <Archive size={18} strokeWidth={2} className="shrink-0" />
              <span>
                {t('admin.products.archiveConfirmPrefix')} <strong>{pendingProduct?.name}</strong>{t('admin.products.archiveConfirmSuffix')}
              </span>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setPendingArchiveId(null)}
                className="px-3 py-1.5 rounded-md border border-amber-300 text-amber-900 text-xs font-semibold hover:bg-amber-100 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmArchive}
                className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors"
              >
                {t('admin.products.confirmArchive')}
              </button>
            </div>
          </div>
        )}

        {/* Product Table */}
        <div className="border border-blue-500/15 rounded-xl overflow-hidden bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-blue-500/15 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {t('admin.products.productCatalog')}{' '}
              <span className="ml-1 text-xs font-medium px-1.5 py-0.5 rounded-md bg-blue-600/10 text-blue-700 tabular-nums">
                {totalProducts}
              </span>
            </h2>
            <div className="relative w-full sm:w-80">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('admin.products.searchPlaceholder')}
                className="w-full border border-gray-300 rounded-md pl-8 pr-3 py-1.5 text-sm bg-white outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {products.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Package size={28} strokeWidth={1.5} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">{t('admin.products.noProductsFound')}</p>
              {!debouncedQuery && (
                <button
                  onClick={() => openEditor(null)}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800"
                >
                  <Plus size={15} strokeWidth={2.5} />
                  {t('admin.products.newProduct')}
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-blue-50/60 border-b border-blue-500/15 text-xs">
                  <tr>
                    <SortableTh<SortKey>
                      label="SKU"
                      columnKey="sku"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    <SortableTh<SortKey>
                      label={t('admin.products.productColumn')}
                      columnKey="name"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    <SortableTh<SortKey>
                      label={t('admin.products.categoryColumn')}
                      columnKey="category"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    <SortableTh<SortKey>
                      label={t('admin.products.priceColumn')}
                      columnKey="sellingPrice"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                      align="right"
                    />
                    <SortableTh<SortKey>
                      label={t('admin.products.costPriceColumn')}
                      columnKey="costPrice"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                      align="right"
                    />
                    <SortableTh<SortKey>
                      label={t('admin.products.totalStockColumn')}
                      columnKey="stock"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                      align="right"
                    />
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    const stock = stockByProduct[product.id]?.totalStock;
                    const levelPrices = levelPricesOf(product);
                    const margin =
                      product.sellingPrice != null && product.costPrice != null && product.sellingPrice > 0
                        ? ((product.sellingPrice - product.costPrice) / product.sellingPrice) * 100
                        : null;
                    const subline = [product.brand, product.oem && `OEM ${product.oem}`].filter(Boolean).join(' · ');
                    return (
                      <tr
                        key={product.id}
                        onClick={() => openEditor(product)}
                        className={`group border-t border-blue-500/10 cursor-pointer hover:bg-blue-50/40 transition-colors ${
                          product.active ? '' : 'text-gray-400'
                        }`}
                      >
                        <td className={`px-4 py-3 align-top font-mono text-xs text-gray-500 whitespace-nowrap ${cellHighlight('sku')}`}>
                          {product.sku ?? '-'}
                        </td>

                        <td className={`px-4 py-3 align-top max-w-[280px] ${cellHighlight('name')}`}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`font-medium truncate ${product.active ? 'text-gray-900' : ''}`} title={product.name}>
                              {product.name}
                            </span>
                            {!product.active && (
                              <span className="shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">
                                {t('admin.products.archived')}
                              </span>
                            )}
                          </div>
                          {subline && (
                            <div className="text-xs text-gray-500 truncate" title={subline}>
                              {subline}
                            </div>
                          )}
                        </td>

                        <td className={`px-4 py-3 align-top ${cellHighlight('category')}`}>
                          {product.category ? (
                            <span className="inline-block max-w-[160px] truncate text-xs px-2 py-0.5 rounded-md bg-gray-100 text-gray-700" title={product.category}>
                              {product.category}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>

                        <td className={`px-4 py-3 align-top text-right ${cellHighlight('sellingPrice')}`}>
                          {product.sellingPrice != null ? (
                            <div className="font-semibold tabular-nums whitespace-nowrap" title={defaultLevelName ?? undefined}>
                              {formatIDR(product.sellingPrice)}
                            </div>
                          ) : (
                            <div className="text-gray-400 text-xs">{t('admin.products.noPrice')}</div>
                          )}
                          {levelPrices.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {levelPrices.slice(0, LEVEL_PRICES_SHOWN).map((lp) => (
                                <div key={lp.id} className="flex justify-end gap-1.5 text-[11px] whitespace-nowrap">
                                  <span className="text-gray-400 truncate max-w-[90px]">{lp.name}</span>
                                  <span className="text-gray-600 tabular-nums">{formatIDR(lp.price)}</span>
                                </div>
                              ))}
                              {levelPrices.length > LEVEL_PRICES_SHOWN && (
                                <div className="text-[11px] text-blue-600">
                                  {t('admin.products.moreLevels', { count: levelPrices.length - LEVEL_PRICES_SHOWN })}
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        <td className={`px-4 py-3 align-top text-right ${cellHighlight('costPrice')}`}>
                          {product.costPrice != null ? (
                            <div className="tabular-nums whitespace-nowrap text-gray-700">{formatIDR(product.costPrice)}</div>
                          ) : (
                            <div className="text-gray-400 text-xs">{t('admin.products.noPrice')}</div>
                          )}
                          {margin != null && (
                            <div className={`text-[11px] tabular-nums ${margin < 0 ? 'text-red-600' : 'text-green-700'}`}>
                              {t('admin.products.marginPct', { pct: margin.toFixed(1) })}
                            </div>
                          )}
                        </td>

                        <td className={`px-4 py-3 align-top text-right ${cellHighlight('stock')}`}>
                          <StockBadge stock={stock} />
                        </td>

                        <td className="px-4 py-3 align-top text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => openEditor(product)}
                              title={t('admin.products.editProductTitle')}
                              aria-label={t('admin.products.editProductTitle')}
                              className="p-1.5 rounded-md text-gray-500 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                            >
                              <Pencil size={15} strokeWidth={2} />
                            </button>
                            {product.active ? (
                              <button
                                onClick={() => requestArchive(product.id)}
                                title={t('admin.products.archive')}
                                aria-label={t('admin.products.archive')}
                                className="p-1.5 rounded-md text-gray-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                              >
                                <Archive size={15} strokeWidth={2} />
                              </button>
                            ) : (
                              <button
                                onClick={() => restoreProduct(product.id)}
                                title={t('admin.products.restore')}
                                aria-label={t('admin.products.restore')}
                                className="p-1.5 rounded-md text-gray-500 hover:text-green-700 hover:bg-green-50 transition-colors"
                              >
                                <ArchiveRestore size={15} strokeWidth={2} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalProducts > 0 && (
            <div className="px-4 py-3 border-t border-blue-500/15">
              <Pagination
                page={page}
                pageSize={pageSize}
                totalItems={totalProducts}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>

      </div>
      {editor && (
        <ProductEditorDrawer
          product={editor.product}
          stock={editor.product ? stockByProduct[editor.product.id] : undefined}
          categories={categories}
          brands={brands}
          locations={locations}
          warehouseOps={warehouseOps}
          onClose={() => setEditor(null)}
          onSaved={onEditorSaved}
        />
      )}
    </main>
  );
}
