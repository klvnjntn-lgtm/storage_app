'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { LayoutDashboard, Search, Plus, ChevronDown, ChevronUp, Tag, Hash, Wallet, Boxes, AlertTriangle, CheckCircle2, List, LayoutGrid, ImageOff, ArrowUpDown } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useSortableData } from '@/lib/hooks/useSortableData';
import SortableTh from '@/app/components/shared/SortableTh';
import Pagination from '@/app/components/shared/Pagination';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import { toCalendarDateString } from '@/lib/dates';


type ProductSummary = {
  productId: string;
  sku: string | null;
  name: string;
  sellingPrice: number | null;
  costPrice: number | null;
  totalStock: number;
  // Primary product image, if one has been set on /products/[id]. Optional
  // by design — List View never needs it, and Grid View falls back to a
  // placeholder when it's null. Keeping this on the summary row (rather
  // than a separate fetch per card) avoids an N+1 in Grid View.
  image: string | null;
  locations: {
    location: string;
    qty: number;
  }[];
};

type CurrentUser = {
  role: 'ADMIN' | 'USER';
};

type OversoldSale = {
  id: number;
  productId: string;
  productName: string | null;
  sku: string | null;
  quantity: number;
  createdAt: string;
  userEmail: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

type Option = { id: string; name: string };

type FieldErrors = {
  name?: string;
  sku?: string;
  category?: string;
  sellingPrice?: string;
  costPrice?: string;
  stock?: string;
};

// Columns the table (and the Grid View sort control) can be sorted by.
// Locations is deliberately excluded — it's a per-row breakdown list, not a
// single sortable value.
type SortKey = 'sku' | 'name' | 'sellingPrice' | 'costPrice' | 'totalStock';

// Display preference only — not a separate feature/dataset. Both views read
// from the same `products` state; this just controls how a row is rendered.
type ViewMode = 'list' | 'grid';
const VIEW_MODE_STORAGE_KEY = 'inventory-stock-view-mode';

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const inputBase =
  'w-full border-2 rounded-md px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 bg-white';
const inputOk = 'border-gray-300 focus:border-blue-500';
const inputBad = 'border-red-400 focus:border-red-500 bg-red-50/40';

function fieldClass(err?: string) {
  return `${inputBase} ${err ? inputBad : inputOk}`;
}

/**
 * Searchable combobox for category/brand: filters existing options as you
 * type, lets you pick one with the mouse or keyboard, and offers to use
 * whatever you typed as a brand-new value if there's no exact match.
 */
function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [value, options]);

  const exactMatch = options.some((o) => o.name.toLowerCase() === value.trim().toLowerCase());
  const showCreate = value.trim().length > 0 && !exactMatch;
  const listLength = filtered.length + (showCreate ? 1 : 0);

  useEffect(() => {
    setHighlight(0);
  }, [value, open]);

  function selectOption(name: string) {
    onChange(name);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(listLength - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (listLength === 0) return;
      e.preventDefault();
      if (highlight < filtered.length) {
        selectOption(filtered[highlight].name);
      } else if (showCreate) {
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        className={className}
      />
      {open && (filtered.length > 0 || showCreate) && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border-2 border-gray-300 rounded-md shadow-lg text-sm">
          {filtered.length > 0 ? (
            filtered.map((opt, i) => (
              <button
                key={opt.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => selectOption(opt.name)}
                className={`w-full text-left px-3 py-2 ${i === highlight ? 'bg-blue-50' : ''}`}
              >
                {opt.name}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-gray-400">{t('inventory.stockPage.comboBoxNoMatches')}</div>
          )}
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(filtered.length)}
              onClick={() => selectOption(value.trim())}
              className={`w-full text-left px-3 py-2 border-t border-gray-200 text-gray-600 ${
                highlight === filtered.length ? 'bg-blue-50' : ''
              }`}
            >
              {t('inventory.stockPage.comboBoxCreateOption', { value: value.trim() })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Square product thumbnail used in Grid View. Falls back to a plain
 * placeholder (not a broken-image icon) whenever a product has no image —
 * images are optional, so an empty state here is normal, not an error.
 */
function ProductThumb({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const showPlaceholder = !src || failed;

  if (showPlaceholder) {
    return (
      <div className="w-full aspect-square rounded-md bg-gray-50 border border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-300">
        <ImageOff size={22} strokeWidth={1.75} />
      </div>
    );
  }

  return (
    <div className="w-full aspect-square rounded-md bg-gray-50 border border-gray-200 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export default function StockPage() {
  const { t } = useLanguage();
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  // Seeded from the URL so pressing the browser's Back button from a
  // product's detail page restores the same search/page instead of
  // resetting to page 1 with no search.
  const [search, setSearch] = useState<string>(() => getInitialParam('search', ''));
  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', 20));
  // Oversold report, folded into this page as a filter rather than a
  // separate subpage — negative stock is already computed client-side
  // from totalStock, so no extra endpoint is needed for "products below
  // zero stock". Sales that pushed stock negative are on the product's own
  // Event History (Stock detail page), same as any other movement.
  const [oversoldOnly, setOversoldOnly] = useState<boolean>(() => getInitialParam<'' | '1'>('oversold', '') === '1');
  const [oversoldFrom, setOversoldFrom] = useState(() => toCalendarDateString(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [oversoldTo, setOversoldTo] = useState(() => toCalendarDateString(new Date()));
  const [oversoldSales, setOversoldSales] = useState<OversoldSale[] | null>(null);
  const [oversoldSalesLoading, setOversoldSalesLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!oversoldOnly) return;
    setOversoldSalesLoading(true);
    apiFetch(`/stock/reports/oversold?from=${oversoldFrom}&to=${oversoldTo}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: OversoldSale[]) => setOversoldSales(data))
      .catch(() => setOversoldSales([]))
      .finally(() => setOversoldSalesLoading(false));
  }, [oversoldOnly, oversoldFrom, oversoldTo]);

  useSyncQueryParams({
    search,
    page: page !== 1 ? page : null,
    pageSize: pageSize !== 20 ? pageSize : null,
    oversold: oversoldOnly ? '1' : null,
  });

  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);

  // --- View mode (List / Grid) ---
  // A UI/display preference only: both views read the same `products` state
  // and the same filter/sort/pagination pipeline below. Persisted per
  // browser so an org that always wants Grid (e.g. a flower shop) doesn't
  // have to re-toggle it every visit. Defaults to List, since large
  // inventories are the more common case and List is the safer first paint.
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === 'list' || stored === 'grid') setViewMode(stored);
  }, []);

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  }

  // --- New Product dropdown ---
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [oem, setOem] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [brandInput, setBrandInput] = useState('');
  const [sellingPriceInput, setSellingPriceInput] = useState('');
  const [costPriceInput, setCostPriceInput] = useState('');
  const [stockInput, setStockInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccessMsg, setCreateSuccessMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Drag-to-scroll support for the table on desktop (no touch gesture available with a mouse)
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ isDown: false, startX: 0, startScrollLeft: 0 });

  async function loadProducts() {
    try {
      const res = await apiFetch('/sessions/summary');
      const data = await res.json();
      console.log('SUMMARY:', data);
      setProducts(data);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadCategories() {
    const res = await apiFetch('/categories');
    if (!res.ok) return;
    setCategories(await res.json());
  }

  async function loadBrands() {
    const res = await apiFetch('/brands');
    if (!res.ok) return;
    setBrands(await res.json());
  }

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    async function loadModules() {
      const res = await apiFetch('/organizations/modules');
      if (!res.ok) return;
      setEnabledModules(await res.json());
    }
    loadModules();
  }, []);

  useEffect(() => {
    async function loadCurrentUser() {
      // Adjust this endpoint to match your actual "who am I" route
      const res = await apiFetch('/auth/me');
      if (!res.ok) return;
      setCurrentUser(await res.json());
    }
    loadCurrentUser();
  }, []);

  useEffect(() => {
    loadCategories();
    loadBrands();
  }, []);

  const showCostPrice =
    enabledModules.includes('INVOICE_POS') && currentUser?.role === 'ADMIN';

  // Per-location breakdown only means anything for orgs actually running
  // the warehouse module — single-location (CENTRE-only) orgs would just
  // see one redundant row repeating the Total Stock column.
  const showLocations = enabledModules.includes('WAREHOUSE_OPS');

  // Only admins get the ability to create products from this page at all —
  // everyone else is here to look up stock, not manage the catalog.
  const canCreateProduct = currentUser?.role === 'ADMIN';

  // Filter by product name
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
    if (oversoldOnly) result = result.filter((p) => p.totalStock < 0);
    return result;
  }, [products, search, oversoldOnly]);

  // Column sorting — applied to the full filtered set, before pagination,
  // so sorting reorders across all pages rather than just the visible one.
  // Shared by both views: List sorts via clickable column headers, Grid
  // sorts via the dropdown next to the view toggle below.
  const { sorted: sortedProducts, sort, toggleSort } = useSortableData<ProductSummary, SortKey>(
    filteredProducts,
    {
      sku: (p) => p.sku ?? '',
      name: (p) => p.name,
      sellingPrice: (p) => p.sellingPrice,
      costPrice: (p) => p.costPrice,
      totalStock: (p) => p.totalStock,
    },
  );

  // Reset to page 1 whenever the search term or sort changes — but not on
  // the very first run, or a `page` restored from the URL (e.g. via the
  // browser's Back button) would get clobbered back to 1 on mount.
  const isFirstSearchResetRef = useRef(true);
  useEffect(() => {
    if (isFirstSearchResetRef.current) {
      isFirstSearchResetRef.current = false;
      return;
    }
    setPage(1);
  }, [search, oversoldOnly]);

  const isFirstSortResetRef = useRef(true);
  useEffect(() => {
    if (isFirstSortResetRef.current) {
      isFirstSortResetRef.current = false;
      return;
    }
    setPage(1);
  }, [sort]);

  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / pageSize));

  // Clamp page if filtering shrinks the result set below the current page
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedProducts.slice(start, start + pageSize);
  }, [sortedProducts, page, pageSize]);

  // Small helper so the active sorted column's cells get the same subtle
  // highlight as its header, making it easy to visually track down a
  // column while scanning rows.
  function cellHighlight(key: SortKey) {
    return sort?.key === key ? 'bg-blue-50/70' : '';
  }

  const gridSortOptions: { key: SortKey; label: string }[] = [
    { key: 'name', label: t('inventory.stockPage.colProduct') },
    { key: 'sku', label: t('inventory.stockPage.colSku') },
    { key: 'sellingPrice', label: t('common.price') },
    ...(showCostPrice ? [{ key: 'costPrice' as SortKey, label: t('inventory.stockPage.colCostPrice') }] : []),
    { key: 'totalStock', label: t('inventory.stockPage.colTotalStock') },
  ];

  // --- New Product form logic ---

  function parsePriceInput(raw: string): number | undefined | null {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    if (Number.isNaN(n) || n < 0) return null;
    return n;
  }

  function parseStockInput(raw: string): number | undefined | null {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) return null;
    return n;
  }

  const duplicateSku = useMemo(() => {
    const trimmed = sku.trim().toLowerCase();
    if (!trimmed) return false;
    return products.some((p) => (p.sku ?? '').trim().toLowerCase() === trimmed);
  }, [sku, products]);

  // Margin preview only makes sense (and is only shown) where cost price
  // itself is visible — i.e. admins with the invoicing module enabled.
  const marginPreview = useMemo(() => {
    if (!showCostPrice) return null;
    const sell = parsePriceInput(sellingPriceInput);
    const cost = parsePriceInput(costPriceInput);
    if (typeof sell !== 'number' || typeof cost !== 'number' || sell <= 0) return null;
    const profit = sell - cost;
    const pct = (profit / sell) * 100;
    return { profit, pct };
  }, [sellingPriceInput, costPriceInput, showCostPrice]);

  function resetCreateForm() {
    setName('');
    setSku('');
    setOem('');
    setCategoryInput('');
    setBrandInput('');
    setSellingPriceInput('');
    setCostPriceInput('');
    setStockInput('');
    setFieldErrors({});
  }

  function validateCreateForm(): FieldErrors | null {
    const errs: FieldErrors = {};

    if (!name.trim()) errs.name = t('common.required');
    if (!sku.trim()) errs.sku = t('common.required');
    if (!categoryInput.trim()) errs.category = t('common.required');

    const sellingPrice = parsePriceInput(sellingPriceInput);
    if (sellingPrice === null) errs.sellingPrice = t('inventory.stockPage.mustBeNonNegativeNumber');

    if (showCostPrice) {
      const costPrice = parsePriceInput(costPriceInput);
      if (costPrice === null) errs.costPrice = t('inventory.stockPage.mustBeNonNegativeNumber');
    }

    const stock = parseStockInput(stockInput);
    if (stock === null) errs.stock = t('inventory.stockPage.mustBeWholeNumber');

    return Object.keys(errs).length > 0 ? errs : null;
  }

  async function createProduct() {
    setCreateError('');
    setCreateSuccessMsg('');

    const errs = validateCreateForm();
    setFieldErrors(errs ?? {});
    if (errs) return;

    const sellingPrice = parsePriceInput(sellingPriceInput) as number | undefined;
    // Non-admins never see (or set) cost price — omit it entirely rather
    // than send an empty value the user never had a chance to view.
    const costPrice = showCostPrice ? (parsePriceInput(costPriceInput) as number | undefined) : undefined;
    const stock = parseStockInput(stockInput) as number | undefined;

    setCreating(true);

    try {
      const res = await apiFetch('/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim(),
          oem: oem.trim() || undefined,
          category: categoryInput.trim(),
          brand: brandInput.trim() || undefined,
          sellingPrice,
          costPrice,
          stock,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || t('inventory.stockPage.createProductFailed'));
      }

      setCreateSuccessMsg(t('inventory.stockPage.createSuccess', { name: name.trim() }));
      resetCreateForm();
      setPage(1);

      await Promise.all([loadProducts(), loadCategories(), loadBrands()]);
    } catch (err: any) {
      console.error(err);
      setCreateError(err.message || t('inventory.stockPage.createProductFailed'));
    } finally {
      setCreating(false);
    }
  }

  function handleCreateFormKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      createProduct();
    }
  }

  // Mouse drag-to-scroll handlers (desktop equivalent of a touch swipe)
  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el) return;
    dragState.current = {
      isDown: true,
      startX: e.pageX - el.offsetLeft,
      startScrollLeft: el.scrollLeft,
    };
    el.classList.add('cursor-grabbing');
    el.classList.remove('cursor-grab');
  }

  function onMouseLeaveOrUp() {
    const el = scrollRef.current;
    dragState.current.isDown = false;
    el?.classList.remove('cursor-grabbing');
    el?.classList.add('cursor-grab');
  }

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el || !dragState.current.isDown) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = x - dragState.current.startX;
    el.scrollLeft = dragState.current.startScrollLeft - walk;
  }

  // Let a plain vertical mouse wheel scroll the table horizontally too,
  // since a normal mouse has no horizontal scroll input.
  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el) return;
    const canScrollHorizontally = el.scrollWidth > el.clientWidth;
    if (canScrollHorizontally && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Header — sticky, blue-outline + backdrop-blur treatment matching
          /vehicles/search and /labels. Search bar now lives here too. */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <LayoutDashboard size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('inventory.stockPage.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">
                {t('inventory.stockPage.subtitle')}
              </p>
            </div>
          </div>

          {/* Search + view toggle */}
          <div className="flex items-center gap-2">
            <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35 flex-1">
              <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('inventory.stockPage.searchPlaceholder')}
                className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
              />
            </div>

            <button
              type="button"
              onClick={() => setOversoldOnly((v) => !v)}
              aria-pressed={oversoldOnly}
              title={t('inventory.stockPage.oversoldFilterTitle')}
              className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-3.5 text-sm font-semibold shadow-sm shrink-0 transition-colors ${
                oversoldOnly
                  ? 'bg-red-600 border-red-600 text-white'
                  : 'bg-white border-blue-500/20 text-gray-600 hover:border-red-300 hover:text-red-700'
              }`}
            >
              <AlertTriangle size={16} strokeWidth={2} />
              {t('inventory.stockPage.oversoldFilterLabel')}
            </button>

            {/* List/Grid toggle. Pure display preference — same data, same
                filter/sort/pagination, just a different row renderer. */}
            <div
              role="group"
              aria-label={t('inventory.stockPage.viewModeGroupLabel')}
              className="flex items-center gap-0.5 rounded-xl border border-blue-500/20 bg-white p-1 shadow-sm shrink-0"
            >
              <button
                type="button"
                onClick={() => changeViewMode('list')}
                aria-pressed={viewMode === 'list'}
                title={t('inventory.stockPage.listView')}
                className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                  viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-blue-700 hover:bg-blue-50'
                }`}
              >
                <List size={17} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => changeViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
                title={t('inventory.stockPage.gridView')}
                className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                  viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-blue-700 hover:bg-blue-50'
                }`}
              >
                <LayoutGrid size={17} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">

        {/* New Product dropdown (admins only) */}
        {canCreateProduct && (
          <div className="border-2 border-gray-300 rounded-md overflow-hidden bg-white">
            <button
              onClick={() => setFormOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-blue-50/60 hover:bg-blue-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Plus size={16} strokeWidth={2.5} className="text-blue-700" />
                {t('inventory.stockPage.newProduct')}
              </span>
              {formOpen ? (
                <ChevronUp size={16} strokeWidth={2} className="text-blue-700" />
              ) : (
                <ChevronDown size={16} strokeWidth={2} className="text-blue-700" />
              )}
            </button>

            {formOpen && (
              <div className="p-4 space-y-5" onKeyDown={handleCreateFormKeyDown}>
                {createError && (
                  <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
                    <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                    {createError}
                  </div>
                )}

                {createSuccessMsg && (
                  <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
                    <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
                    {createSuccessMsg}
                  </div>
                )}

                {/* Section: Identity */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700/80 uppercase tracking-wide">
                    <Tag size={12} strokeWidth={2.5} />
                    {t('inventory.stockPage.sectionIdentity')}
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <input
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }));
                        }}
                        placeholder={t('inventory.stockPage.namePlaceholder')}
                        className={fieldClass(fieldErrors.name)}
                      />
                      {fieldErrors.name && <p className="text-xs text-red-600 mt-1">{fieldErrors.name}</p>}
                    </div>
                    <div>
                      <input
                        value={oem}
                        onChange={(e) => setOem(e.target.value)}
                        placeholder={t('inventory.stockPage.oemPlaceholder')}
                        className={fieldClass()}
                      />
                    </div>
                  </div>
                </div>

                {/* Section: Catalog identifiers */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700/80 uppercase tracking-wide">
                    <Hash size={12} strokeWidth={2.5} />
                    {t('inventory.stockPage.sectionCatalog')}
                  </div>
                  <div className="grid md:grid-cols-3 gap-3">
                    <div>
                      <input
                        value={sku}
                        onChange={(e) => {
                          setSku(e.target.value);
                          if (fieldErrors.sku) setFieldErrors((f) => ({ ...f, sku: undefined }));
                        }}
                        placeholder={t('inventory.stockPage.skuPlaceholder')}
                        className={fieldClass(fieldErrors.sku)}
                      />
                      {fieldErrors.sku && <p className="text-xs text-red-600 mt-1">{fieldErrors.sku}</p>}
                      {!fieldErrors.sku && duplicateSku && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                          <AlertTriangle size={11} strokeWidth={2.5} />
                          {t('inventory.stockPage.skuDuplicate')}
                        </p>
                      )}
                    </div>
                    <div>
                      <ComboBox
                        value={categoryInput}
                        onChange={(v) => {
                          setCategoryInput(v);
                          if (fieldErrors.category) setFieldErrors((f) => ({ ...f, category: undefined }));
                        }}
                        options={categories}
                        placeholder={t('inventory.stockPage.categoryPlaceholder')}
                        className={fieldClass(fieldErrors.category)}
                      />
                      {fieldErrors.category ? (
                        <p className="text-xs text-red-600 mt-1">{fieldErrors.category}</p>
                      ) : (
                        <p className="text-xs text-gray-400 mt-1">{t('inventory.stockPage.categoryHint')}</p>
                      )}
                    </div>
                    <div>
                      <ComboBox
                        value={brandInput}
                        onChange={setBrandInput}
                        options={brands}
                        placeholder={t('inventory.stockPage.brandPlaceholder')}
                        className={fieldClass()}
                      />
                      <p className="text-xs text-gray-400 mt-1">{t('inventory.stockPage.brandHint')}</p>
                    </div>
                  </div>
                </div>

                {/* Section: Pricing & Inventory */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700/80 uppercase tracking-wide">
                    <Wallet size={12} strokeWidth={2.5} />
                    {t('inventory.stockPage.sectionPricingInventory')}
                  </div>
                  <div className={`grid gap-3 ${showCostPrice ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('inventory.stockPage.sellingPriceLabel')}</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                          Rp
                        </span>
                        <input
                          type="number"
                          min="0"
                          inputMode="decimal"
                          value={sellingPriceInput}
                          onChange={(e) => {
                            setSellingPriceInput(e.target.value);
                            if (fieldErrors.sellingPrice) setFieldErrors((f) => ({ ...f, sellingPrice: undefined }));
                          }}
                          placeholder="150000"
                          className={`${fieldClass(fieldErrors.sellingPrice)} pl-8`}
                        />
                      </div>
                      {fieldErrors.sellingPrice && (
                        <p className="text-xs text-red-600 mt-1">{fieldErrors.sellingPrice}</p>
                      )}
                    </div>

                    {/* Cost price is invoicing/margin data — only rendered for admins with
                        the invoicing module on, matching the same gate as the table column. */}
                    {showCostPrice && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t('inventory.stockPage.costPriceLabel')}</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                            Rp
                          </span>
                          <input
                            type="number"
                            min="0"
                            inputMode="decimal"
                            value={costPriceInput}
                            onChange={(e) => {
                              setCostPriceInput(e.target.value);
                              if (fieldErrors.costPrice) setFieldErrors((f) => ({ ...f, costPrice: undefined }));
                            }}
                            placeholder="100000"
                            className={`${fieldClass(fieldErrors.costPrice)} pl-8`}
                          />
                        </div>
                        {fieldErrors.costPrice && (
                          <p className="text-xs text-red-600 mt-1">{fieldErrors.costPrice}</p>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                        <Boxes size={12} strokeWidth={2.5} />
                        {t('inventory.stockPage.stockOnHandLabel')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={stockInput}
                        onChange={(e) => {
                          setStockInput(e.target.value);
                          if (fieldErrors.stock) setFieldErrors((f) => ({ ...f, stock: undefined }));
                        }}
                        placeholder="0"
                        className={fieldClass(fieldErrors.stock)}
                      />
                      {fieldErrors.stock && <p className="text-xs text-red-600 mt-1">{fieldErrors.stock}</p>}
                    </div>
                  </div>

                  {marginPreview && (
                    <div
                      className={`text-xs rounded-md px-3 py-2 border-2 inline-flex items-center gap-1.5 ${
                        marginPreview.profit >= 0
                          ? 'bg-green-50 border-green-200 text-green-800'
                          : 'bg-red-50 border-red-200 text-red-800'
                      }`}
                    >
                      {t('inventory.stockPage.marginPreview', {
                        profit: formatIDR(marginPreview.profit),
                        pct: marginPreview.pct.toFixed(1),
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={createProduct}
                    disabled={creating}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {creating ? t('common.creating') : t('inventory.stockPage.createProductButton')}
                  </button>
                  <button
                    onClick={resetCreateForm}
                    disabled={creating}
                    className="px-4 py-2 text-gray-500 text-sm hover:text-blue-700 disabled:opacity-40 transition-colors"
                  >
                    {t('common.clear')}
                  </button>
                  <span className="text-xs text-gray-400 ml-auto hidden md:inline">{t('inventory.stockPage.submitHint')}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {oversoldOnly && (
          <div className="border-2 border-red-200 rounded-md overflow-hidden bg-white mb-4">
            <div className="p-4 border-b-2 border-red-100 bg-red-50/50 flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
              <div>
                <h2 className="font-bold text-sm text-red-800">{t('inventory.stockPage.oversoldSalesHeading')}</h2>
                <p className="text-xs text-gray-600">{t('inventory.stockPage.oversoldSalesDescription')}</p>
              </div>
              <DateRangePicker
                from={oversoldFrom}
                to={oversoldTo}
                onChange={(f, tt) => {
                  setOversoldFrom(f ?? oversoldFrom);
                  setOversoldTo(tt ?? oversoldTo);
                }}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-red-50/40 border-b border-red-100 text-left">
                  <tr>
                    <th className="px-4 py-2 font-semibold">{t('inventory.stockPage.colProduct')}</th>
                    <th className="px-4 py-2 font-semibold">{t('inventory.stockPage.oversoldColQty')}</th>
                    <th className="px-4 py-2 font-semibold">{t('inventory.stockPage.oversoldColInvoice')}</th>
                    <th className="px-4 py-2 font-semibold">{t('inventory.stockPage.oversoldColUser')}</th>
                    <th className="px-4 py-2 font-semibold">{t('inventory.stockPage.oversoldColDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {oversoldSalesLoading ? (
                    <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-500">{t('common.loading')}</td></tr>
                  ) : !oversoldSales || oversoldSales.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-500">{t('inventory.stockPage.oversoldSalesEmpty')}</td></tr>
                  ) : (
                    oversoldSales.map((s) => (
                      <tr key={s.id} className="border-b border-gray-100">
                        <td className="px-4 py-2">{s.productName ?? s.sku ?? s.productId}</td>
                        <td className="px-4 py-2 font-bold text-red-700">{s.quantity}</td>
                        <td className="px-4 py-2">{s.invoiceNumber ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600">{s.userEmail ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600">{new Date(s.createdAt).toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {viewMode === 'list' ? (
          <div className="border-2 border-gray-300 rounded-md overflow-hidden bg-white">
            <div
              ref={scrollRef}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseLeaveOrUp}
              onMouseLeave={onMouseLeaveOrUp}
              onWheel={onWheel}
              className="overflow-x-auto cursor-grab select-none"
              style={{ scrollbarWidth: 'thin' }}
            >
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-blue-50/60 border-b-2 border-gray-300">
                  <tr>
                    <SortableTh<SortKey>
                      label={t('inventory.stockPage.colSku')}
                      columnKey="sku"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    <SortableTh<SortKey>
                      label={t('inventory.stockPage.colProduct')}
                      columnKey="name"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    <SortableTh<SortKey>
                      label={t('common.price')}
                      columnKey="sellingPrice"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    {showCostPrice && (
                      <SortableTh<SortKey>
                        label={t('inventory.stockPage.colCostPrice')}
                        columnKey="costPrice"
                        activeKey={sort?.key ?? null}
                        direction={sort?.direction ?? null}
                        onSort={toggleSort}
                      />
                    )}
                    <SortableTh<SortKey>
                      label={t('inventory.stockPage.colTotalStock')}
                      columnKey="totalStock"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    {/* Locations is per-location detail, not a single sortable
                        value — and only meaningful for orgs actually running
                        multiple locations via the warehouse module. */}
                    {showLocations && (
                      <th className="text-left px-4 py-3 font-semibold">{t('inventory.stockPage.colLocations')}</th>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {paginatedProducts.map((product, idx) => (
                    <tr
                      key={product.productId}
                      className={`
                        border-t border-gray-300
                        cursor-pointer
                        hover:bg-blue-50
                        ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}
                      `}
                      onClick={() => router.push(`/inventory/stock/${product.productId}`)}
                    >
                      <td className={`px-4 py-3 text-gray-500 font-mono whitespace-nowrap ${cellHighlight('sku')}`}>
                        {product.sku ?? '-'}
                      </td>
                      <td className={`px-4 py-3 font-medium ${cellHighlight('name')}`}>{product.name}</td>
                      <td className={`px-4 py-3 whitespace-nowrap ${cellHighlight('sellingPrice')}`}>
                        {product.sellingPrice != null ? (
                          formatIDR(product.sellingPrice)
                        ) : (
                          <span className="text-gray-400">{t('inventory.stockPage.noPrice')}</span>
                        )}
                      </td>
                      {showCostPrice && (
                        <td className={`px-4 py-3 whitespace-nowrap ${cellHighlight('costPrice')}`}>
                          {product.costPrice != null ? (
                            formatIDR(product.costPrice)
                          ) : (
                            <span className="text-gray-400">{t('inventory.stockPage.noPrice')}</span>
                          )}
                        </td>
                      )}
                      <td
                        className={`px-4 py-3 font-bold whitespace-nowrap ${cellHighlight('totalStock')} ${
                          product.totalStock < 0 ? 'text-red-700' : ''
                        }`}
                      >
                        {product.totalStock}
                      </td>
                      {showLocations && (
                        <td className="px-4 py-3 text-xs text-gray-700">
                          {product.locations.length === 0 ? (
                            <span className="text-gray-500">{t('inventory.stockPage.noStock')}</span>
                          ) : (
                            product.locations.map((location, index) => (
                              <div key={index} className="whitespace-nowrap">
                                {location.location}: {location.qty}
                              </div>
                            ))
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredProducts.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">
                {search ? t('inventory.stockPage.noProductsMatch') : t('inventory.stockPage.noProductsFound')}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Grid View has no column headers to sort by, so the same sort
                state gets a small explicit control instead. */}
            {filteredProducts.length > 0 && (
              <div className="flex items-center gap-2 justify-end">
                <ArrowUpDown size={14} strokeWidth={2} className="text-gray-400" />
                <label className="text-xs text-gray-500">{t('inventory.stockPage.sortBy')}</label>
                <select
                  value={sort?.key ?? ''}
                  onChange={(e) => {
                    if (e.target.value) toggleSort(e.target.value as SortKey);
                  }}
                  className="text-xs border-2 border-gray-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500 bg-white"
                >
                  <option value="" disabled>
                    {t('inventory.stockPage.chooseColumn')}
                  </option>
                  {gridSortOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {sort?.key && (
                  <button
                    type="button"
                    onClick={() => toggleSort(sort.key)}
                    title={t('inventory.stockPage.reverseSortDirection')}
                    className="text-xs px-2 py-1.5 rounded-md border-2 border-gray-300 hover:bg-blue-50 font-semibold text-gray-600"
                  >
                    {sort.direction === 'asc' ? t('inventory.stockPage.sortAsc') : t('inventory.stockPage.sortDesc')}
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {paginatedProducts.map((product) => (
                <button
                  key={product.productId}
                  onClick={() => router.push(`/inventory/stock/${product.productId}`)}
                  className="text-left border-2 border-gray-300 rounded-md bg-white p-2.5 hover:border-blue-400 hover:shadow-sm transition-all flex flex-col gap-2"
                >
                  <ProductThumb src={product.image} alt={product.name} />

                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{product.name}</p>
                    <p className="text-xs text-gray-500 font-mono truncate">{product.sku ?? '-'}</p>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-blue-800">
                      {product.sellingPrice != null ? formatIDR(product.sellingPrice) : '—'}
                    </span>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-md border ${
                        product.totalStock > 0
                          ? 'bg-green-50 text-green-800 border-green-200'
                          : 'bg-red-50 text-red-800 border-red-200'
                      }`}
                    >
                      {product.totalStock} {t('inventory.stockPage.pcsSuffix')}
                    </span>
                  </div>

                  {showLocations && product.locations.length > 0 && (
                    <div className="text-[11px] text-gray-500 border-t border-gray-100 pt-1.5 space-y-0.5">
                      {product.locations.map((location, index) => (
                        <div key={index} className="flex justify-between gap-2 truncate">
                          <span className="truncate">{location.location}</span>
                          <span className="font-semibold shrink-0">{location.qty}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {filteredProducts.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500 border-2 border-gray-300 rounded-md bg-white">
                {search ? t('inventory.stockPage.noProductsMatch') : t('inventory.stockPage.noProductsFound')}
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        {filteredProducts.length > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            totalItems={filteredProducts.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>
    </main>
  );
}