'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  LayoutDashboard,
  Search,
  Plus,
  ChevronDown,
  ChevronUp,
  Tag,
  Hash,
  Wallet,
  Boxes,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

type ProductSummary = {
  productId: string;
  sku: string | null;
  name: string;
  sellingPrice: number | null;
  costPrice: number | null;
  totalStock: number;
  locations: {
    location: string;
    qty: number;
  }[];
};

type CurrentUser = {
  role: 'ADMIN' | 'USER';
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

const PAGE_SIZE = 20;

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const inputBase =
  'w-full border-2 rounded-md px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 bg-white';
const inputOk = 'border-gray-300 focus:border-black';
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
                className={`w-full text-left px-3 py-2 ${i === highlight ? 'bg-gray-100' : ''}`}
              >
                {opt.name}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-gray-400">No matches</div>
          )}
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(filtered.length)}
              onClick={() => selectOption(value.trim())}
              className={`w-full text-left px-3 py-2 border-t border-gray-200 text-gray-600 ${
                highlight === filtered.length ? 'bg-gray-100' : ''
              }`}
            >
              + Create &quot;{value.trim()}&quot;
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function StockPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const router = useRouter();

  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);

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

  // Only admins get the ability to create products from this page at all —
  // everyone else is here to look up stock, not manage the catalog.
  const canCreateProduct = currentUser?.role === 'ADMIN';

  // Filter by product name
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  // Reset to page 1 whenever the search term changes
  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));

  // Clamp page if filtering shrinks the result set below the current page
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, page]);

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

    if (!name.trim()) errs.name = 'Required';
    if (!sku.trim()) errs.sku = 'Required';
    if (!categoryInput.trim()) errs.category = 'Required';

    const sellingPrice = parsePriceInput(sellingPriceInput);
    if (sellingPrice === null) errs.sellingPrice = 'Must be a non-negative number';

    if (showCostPrice) {
      const costPrice = parsePriceInput(costPriceInput);
      if (costPrice === null) errs.costPrice = 'Must be a non-negative number';
    }

    const stock = parseStockInput(stockInput);
    if (stock === null) errs.stock = 'Must be a whole number, 0 or more';

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
        throw new Error(data?.message || 'Failed to create product');
      }

      setCreateSuccessMsg(`"${name.trim()}" created.`);
      resetCreateForm();
      setPage(1);

      await Promise.all([loadProducts(), loadCategories(), loadBrands()]);
    } catch (err: any) {
      console.error(err);
      setCreateError(err.message || 'Failed to create product');
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
    <main className="min-h-screen bg-white text-black">
      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Hub
          </button>
          <div className="flex items-center gap-2">
            <LayoutDashboard size={22} strokeWidth={2} className="text-gray-700" />
            <div>
              <h1 className="text-2xl font-bold">Stock</h1>
              <p className="text-xs text-gray-500">Current stock across all locations — sorted by SKU</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto space-y-4">

        {/* New Product dropdown (admins only) */}
        {canCreateProduct && (
          <div className="border-2 border-gray-300 rounded-md overflow-hidden">
            <button
              onClick={() => setFormOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Plus size={16} strokeWidth={2.5} className="text-gray-600" />
                New Product
              </span>
              {formOpen ? (
                <ChevronUp size={16} strokeWidth={2} className="text-gray-500" />
              ) : (
                <ChevronDown size={16} strokeWidth={2} className="text-gray-500" />
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
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <Tag size={12} strokeWidth={2.5} />
                    Identity
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <input
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }));
                        }}
                        placeholder="Product name *"
                        className={fieldClass(fieldErrors.name)}
                      />
                      {fieldErrors.name && <p className="text-xs text-red-600 mt-1">{fieldErrors.name}</p>}
                    </div>
                    <div>
                      <input
                        value={oem}
                        onChange={(e) => setOem(e.target.value)}
                        placeholder="OEM number (optional)"
                        className={fieldClass()}
                      />
                    </div>
                  </div>
                </div>

                {/* Section: Catalog identifiers */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <Hash size={12} strokeWidth={2.5} />
                    Catalog
                  </div>
                  <div className="grid md:grid-cols-3 gap-3">
                    <div>
                      <input
                        value={sku}
                        onChange={(e) => {
                          setSku(e.target.value);
                          if (fieldErrors.sku) setFieldErrors((f) => ({ ...f, sku: undefined }));
                        }}
                        placeholder="SKU *"
                        className={fieldClass(fieldErrors.sku)}
                      />
                      {fieldErrors.sku && <p className="text-xs text-red-600 mt-1">{fieldErrors.sku}</p>}
                      {!fieldErrors.sku && duplicateSku && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                          <AlertTriangle size={11} strokeWidth={2.5} />
                          SKU already exists in catalog
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
                        placeholder="Category * — search or add new"
                        className={fieldClass(fieldErrors.category)}
                      />
                      {fieldErrors.category ? (
                        <p className="text-xs text-red-600 mt-1">{fieldErrors.category}</p>
                      ) : (
                        <p className="text-xs text-gray-400 mt-1">Type to search, or enter a new category</p>
                      )}
                    </div>
                    <div>
                      <ComboBox
                        value={brandInput}
                        onChange={setBrandInput}
                        options={brands}
                        placeholder="Brand (optional) — search or add new"
                        className={fieldClass()}
                      />
                      <p className="text-xs text-gray-400 mt-1">Type to search, or enter a new brand</p>
                    </div>
                  </div>
                </div>

                {/* Section: Pricing & Inventory */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <Wallet size={12} strokeWidth={2.5} />
                    Pricing &amp; Inventory
                  </div>
                  <div className={`grid gap-3 ${showCostPrice ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Selling Price (optional)</label>
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
                        <label className="block text-xs text-gray-500 mb-1">Cost Price (optional)</label>
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
                        Stock on hand (optional)
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
                      Margin: {formatIDR(marginPreview.profit)} ({marginPreview.pct.toFixed(1)}%)
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={createProduct}
                    disabled={creating}
                    className="px-4 py-2 bg-black text-white rounded-md text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {creating ? 'Creating...' : 'Create Product'}
                  </button>
                  <button
                    onClick={resetCreateForm}
                    disabled={creating}
                    className="px-4 py-2 text-gray-500 text-sm hover:text-black disabled:opacity-40"
                  >
                    Clear
                  </button>
                  <span className="text-xs text-gray-400 ml-auto hidden md:inline">⌘/Ctrl + Enter to submit</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative sm:max-w-sm">
          <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product name..."
            className="w-full border-2 border-gray-300 rounded-md pl-9 pr-3 py-2.5 sm:py-2 text-sm outline-none focus:border-black"
          />
        </div>

        <div className="border-2 border-gray-300 rounded-md overflow-hidden">
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
              <thead className="bg-gray-100 border-b-2 border-gray-300">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">SKU</th>
                  <th className="text-left px-4 py-3 font-semibold">Product</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Price</th>
                  {showCostPrice && (
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Cost Price</th>
                  )}
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Total Stock</th>
                  <th className="text-left px-4 py-3 font-semibold">Locations</th>
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
                    onClick={() => router.push(`/inventory/products/${product.productId}`)}
                  >
                    <td className="px-4 py-3 text-gray-500 font-mono whitespace-nowrap">
                      {product.sku ?? '-'}
                    </td>
                    <td className="px-4 py-3 font-medium">{product.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {product.sellingPrice != null ? (
                        formatIDR(product.sellingPrice)
                      ) : (
                        <span className="text-gray-400">No price</span>
                      )}
                    </td>
                    {showCostPrice && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        {product.costPrice != null ? (
                          formatIDR(product.costPrice)
                        ) : (
                          <span className="text-gray-400">No price</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 font-bold whitespace-nowrap">{product.totalStock}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      {product.locations.length === 0 ? (
                        <span className="text-gray-500">No stock</span>
                      ) : (
                        product.locations.map((location, index) => (
                          <div key={index} className="whitespace-nowrap">
                            {location.location}: {location.qty}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredProducts.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">
              {search ? 'No products match your search' : 'No products found'}
            </div>
          )}
        </div>

        {/* Pagination */}
        {filteredProducts.length > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, filteredProducts.length)} of {filteredProducts.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Prev
              </button>
              <span className="text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}