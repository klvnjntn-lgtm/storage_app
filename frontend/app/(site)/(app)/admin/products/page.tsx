// app/admin/products/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Package,
  AlertTriangle,
  CheckCircle2,
  Archive,
  Pencil,
  Check,
  X,
  Plus,
  ChevronDown,
  ChevronUp,
  Tag,
  Hash,
  Wallet,
  Boxes,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';

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
};

// Stock lives per-location (see the Stock page), not as a scalar on the
// product itself — this is a read-only summary keyed by productId.
type StockSummary = {
  totalStock: number;
  locations: { location: string; qty: number }[];
};

type Option = { id: string; name: string };

const PAGE_SIZE = 20;
const LOW_STOCK_THRESHOLD = 5;

function authHeaders(json = true) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

type FieldErrors = {
  name?: string;
  sku?: string;
  category?: string;
  sellingPrice?: string;
  costPrice?: string;
};

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

function StockBadge({ stock }: { stock: number | undefined }) {
  if (stock == null) return <span className="text-gray-400">-</span>;
  if (stock <= 0) {
    return (
      <span className="inline-block text-xs px-2 py-0.5 rounded-md border font-medium bg-red-100 text-red-800 border-red-300">
        Out of stock
      </span>
    );
  }
  if (stock <= LOW_STOCK_THRESHOLD) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border font-medium bg-amber-100 text-amber-800 border-amber-300">
        <AlertTriangle size={11} strokeWidth={2.5} />
        {stock} left
      </span>
    );
  }
  return <span>{stock}</span>;
}

export default function ProductsPage() {
  const router = useRouter();
  const { authorized, loading: authLoading } = useRequireAdmin();

  const [products, setProducts] = useState<Product[]>([]);
  const [stockByProduct, setStockByProduct] = useState<Record<string, StockSummary>>({});
  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [oem, setOem] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [brandInput, setBrandInput] = useState('');
  const [sellingPriceInput, setSellingPriceInput] = useState('');
  const [costPriceInput, setCostPriceInput] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [successMsg, setSuccessMsg] = useState('');
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

  // --- Create form open/collapsed state ---
  const [formOpen, setFormOpen] = useState(true);

  // --- Pagination ---
  const [page, setPage] = useState(1);

  // --- Inline row editing state (prices only — stock is per-location and
  // managed on the Stock page, not here) ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSellingPrice, setEditSellingPrice] = useState('');
  const [editCostPrice, setEditCostPrice] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  async function loadProducts() {
    const res = await apiFetch('/products', { headers: authHeaders(false) });
    const data = await res.json();
    setProducts(Array.isArray(data) ? data : []);
  }

  // Stock totals come from the same aggregated-by-location summary the
  // Stock page uses — this page only reads it, never writes to it.
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

  useEffect(() => {
    loadProducts();
    loadStockSummary();
    loadCategories();
    loadBrands();
  }, []);

  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return products.slice(start, start + PAGE_SIZE);
  }, [products, page]);

  // Parses a price input. Empty string -> undefined (omit field / leave
  // unset), invalid non-numeric -> null (caller should treat as error).
  function parsePriceInput(raw: string): number | undefined | null {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    if (Number.isNaN(n) || n < 0) return null;
    return n;
  }

  // Live duplicate-SKU check against what's already loaded, so the admin
  // gets a heads-up before hitting submit (server remains the source of truth).
  const duplicateSku = useMemo(() => {
    const trimmed = sku.trim().toLowerCase();
    if (!trimmed) return false;
    return products.some((p) => (p.sku ?? '').trim().toLowerCase() === trimmed);
  }, [sku, products]);

  // Live margin preview while creating a product.
  const marginPreview = useMemo(() => {
    const sell = parsePriceInput(sellingPriceInput);
    const cost = parsePriceInput(costPriceInput);
    if (typeof sell !== 'number' || typeof cost !== 'number' || sell <= 0) return null;
    const profit = sell - cost;
    const pct = (profit / sell) * 100;
    return { profit, pct };
  }, [sellingPriceInput, costPriceInput]);

  function resetCreateForm() {
    setName('');
    setSku('');
    setOem('');
    setCategoryInput('');
    setBrandInput('');
    setSellingPriceInput('');
    setCostPriceInput('');
    setFieldErrors({});
  }

  function validateCreateForm(): FieldErrors | null {
    const errs: FieldErrors = {};

    if (!name.trim()) errs.name = 'Required';
    if (!sku.trim()) errs.sku = 'Required';
    if (!categoryInput.trim()) errs.category = 'Required';

    const sellingPrice = parsePriceInput(sellingPriceInput);
    if (sellingPrice === null) errs.sellingPrice = 'Must be a non-negative number';

    const costPrice = parsePriceInput(costPriceInput);
    if (costPrice === null) errs.costPrice = 'Must be a non-negative number';

    return Object.keys(errs).length > 0 ? errs : null;
  }

  async function createProduct() {
    setError('');
    setSuccessMsg('');

    const errs = validateCreateForm();
    setFieldErrors(errs ?? {});
    if (errs) return;

    const sellingPrice = parsePriceInput(sellingPriceInput) as number | undefined;
    const costPrice = parsePriceInput(costPriceInput) as number | undefined;

    setLoading(true);

    try {
      const res = await apiFetch('/products', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim(),
          oem: oem.trim() || undefined,
          category: categoryInput.trim(),
          brand: brandInput.trim() || undefined,
          sellingPrice,
          costPrice,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to create product');
      }

      setSuccessMsg(`"${name.trim()}" created. Add its initial stock from the Stock page.`);
      resetCreateForm();
      setPage(1);

      await Promise.all([loadProducts(), loadStockSummary(), loadCategories(), loadBrands()]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to create product');
    } finally {
      setLoading(false);
    }
  }

  function handleCreateFormKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      createProduct();
    }
  }

  function requestArchive(id: string) {
    setError('');
    setSuccessMsg('');
    setPendingArchiveId(id);
  }

  function cancelArchive() {
    setPendingArchiveId(null);
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
        throw new Error(data?.message || 'Failed to archive product');
      }
      setSuccessMsg(`"${product?.name ?? 'Product'}" archived.`);
      await loadProducts();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to archive product');
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
        throw new Error(data?.message || 'Failed to restore product');
      }
      setSuccessMsg(`"${product?.name ?? 'Product'}" restored.`);
      await loadProducts();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to restore product');
    }
  }

  // --- Inline row editing (prices only) ---
  function startEditPrice(product: Product) {
    setError('');
    setSuccessMsg('');
    setEditingId(product.id);
    setEditSellingPrice(product.sellingPrice != null ? String(product.sellingPrice) : '');
    setEditCostPrice(product.costPrice != null ? String(product.costPrice) : '');
  }

  function cancelEditPrice() {
    setEditingId(null);
    setEditSellingPrice('');
    setEditCostPrice('');
  }

  async function saveEditPrice(id: string) {
    setError('');
    setSuccessMsg('');

    const sellingPrice = parsePriceInput(editSellingPrice);
    if (sellingPrice === null) return setError('Selling price must be a valid non-negative number');

    const costPrice = parsePriceInput(editCostPrice);
    if (costPrice === null) return setError('Cost price must be a valid non-negative number');

    const product = products.find((p) => p.id === id);
    setSavingEdit(true);

    try {
      const res = await apiFetch(`/products/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ sellingPrice, costPrice }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to update prices');
      }
      setSuccessMsg(`Prices updated for "${product?.name ?? 'product'}".`);
      setEditingId(null);
      await loadProducts();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update prices');
    } finally {
      setSavingEdit(false);
    }
  }

  const pendingProduct = products.find((p) => p.id === pendingArchiveId);
  if (authLoading || !authorized) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-400">Checking access...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-black">

      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Admin
          </button>
          <div className="flex items-center gap-2">
            <Package size={22} strokeWidth={2} className="text-gray-700" />
            <div>
              <h1 className="text-2xl font-bold">Products</h1>
              <p className="text-xs text-gray-500">Create and manage product catalog</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto space-y-6">

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
            {successMsg}
          </div>
        )}

        {pendingArchiveId && (
          <div className="flex items-center justify-between gap-3 bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-md p-3 text-sm">
            <div className="flex items-center gap-2">
              <Archive size={18} strokeWidth={2} className="shrink-0" />
              <span>
                Archive <strong>{pendingProduct?.name}</strong>? It stays in history but drops out of normal use.
              </span>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={cancelArchive}
                className="px-3 py-1.5 rounded-md border-2 border-amber-300 text-amber-900 text-xs font-semibold hover:bg-amber-100"
              >
                Cancel
              </button>
              <button
                onClick={confirmArchive}
                className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
              >
                Confirm Archive
              </button>
            </div>
          </div>
        )}

        {/* Create Product */}
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
                      autoFocus
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

              {/* Section: Pricing */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <Wallet size={12} strokeWidth={2.5} />
                  Pricing
                </div>
                <div className="grid md:grid-cols-2 gap-3">
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
                    {fieldErrors.costPrice && <p className="text-xs text-red-600 mt-1">{fieldErrors.costPrice}</p>}
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

                <p className="text-xs text-gray-400">
                  Stock isn&apos;t set here — new products start with no stock. Add inventory for a location from
                  the Stock page.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={createProduct}
                  disabled={loading}
                  className="px-4 py-2 bg-black text-white rounded-md text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating...' : 'Create Product'}
                </button>
                <button
                  onClick={resetCreateForm}
                  disabled={loading}
                  className="px-4 py-2 text-gray-500 text-sm hover:text-black disabled:opacity-40"
                >
                  Clear
                </button>
                <span className="text-xs text-gray-400 ml-auto hidden md:inline">⌘/Ctrl + Enter to submit</span>
              </div>
            </div>
          )}
        </div>

        {/* Product Table */}
        <div className="border-2 border-gray-300 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b-2 border-gray-300 bg-gray-100">
            <h2 className="text-sm font-semibold">Product Catalog</h2>
          </div>

          {products.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">No products found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead className="bg-gray-50 border-b-2 border-gray-300">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">SKU</th>
                    <th className="text-left px-4 py-3 font-semibold">Name</th>
                    <th className="text-left px-4 py-3 font-semibold">Category</th>
                    <th className="text-left px-4 py-3 font-semibold">Brand</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Selling Price</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Cost Price</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <Boxes size={12} strokeWidth={2.5} />
                        Total Stock
                      </span>
                    </th>
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                    <th className="text-right px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((product, idx) => {
                    const isEditing = editingId === product.id;
                    const stock = stockByProduct[product.id]?.totalStock;
                    return (
                      <tr
                        key={product.id}
                        className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                      >
                        <td className="px-4 py-3 text-gray-500">{product.sku ?? '-'}</td>
                        <td className="px-4 py-3">{product.name}</td>
                        <td className="px-4 py-3">{product.category ?? '-'}</td>
                        <td className="px-4 py-3">{product.brand ?? '-'}</td>

                        <td className="px-4 py-3 whitespace-nowrap">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              inputMode="decimal"
                              value={editSellingPrice}
                              onChange={(e) => setEditSellingPrice(e.target.value)}
                              className="w-28 border-2 border-gray-300 rounded-md px-2 py-1 text-sm outline-none focus:border-black"
                            />
                          ) : product.sellingPrice != null ? (
                            formatIDR(product.sellingPrice)
                          ) : (
                            <span className="text-gray-400">No price</span>
                          )}
                        </td>

                        <td className="px-4 py-3 whitespace-nowrap">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              inputMode="decimal"
                              value={editCostPrice}
                              onChange={(e) => setEditCostPrice(e.target.value)}
                              className="w-28 border-2 border-gray-300 rounded-md px-2 py-1 text-sm outline-none focus:border-black"
                            />
                          ) : product.costPrice != null ? (
                            formatIDR(product.costPrice)
                          ) : (
                            <span className="text-gray-400">No price</span>
                          )}
                        </td>

                        {/* Read-only: stock is per-location, edit it from the Stock page */}
                        <td className="px-4 py-3 whitespace-nowrap" title="Edit stock from the Stock page">
                          <StockBadge stock={stock} />
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={`inline-block text-xs px-2 py-0.5 rounded-md border font-medium ${
                              product.active
                                ? 'bg-green-100 text-green-800 border-green-300'
                                : 'bg-gray-100 text-gray-600 border-gray-300'
                            }`}
                          >
                            {product.active ? 'Active' : 'Archived'}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => saveEditPrice(product.id)}
                                disabled={savingEdit}
                                title="Save"
                                className="p-1.5 rounded-md border-2 border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-40"
                              >
                                <Check size={14} strokeWidth={2.5} />
                              </button>
                              <button
                                onClick={cancelEditPrice}
                                disabled={savingEdit}
                                title="Cancel"
                                className="p-1.5 rounded-md border-2 border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                              >
                                <X size={14} strokeWidth={2.5} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => startEditPrice(product)}
                                title="Edit prices"
                                className="p-1.5 rounded-md border-2 border-gray-300 text-gray-600 hover:bg-gray-100"
                              >
                                <Pencil size={14} strokeWidth={2} />
                              </button>
                              {product.active ? (
                                <button
                                  onClick={() => requestArchive(product.id)}
                                  className="px-3 py-1.5 rounded-md border-2 border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50"
                                >
                                  Archive
                                </button>
                              ) : (
                                <button
                                  onClick={() => restoreProduct(product.id)}
                                  className="px-3 py-1.5 rounded-md border-2 border-green-300 text-green-700 text-xs font-semibold hover:bg-green-50"
                                >
                                  Restore
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {products.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t-2 border-gray-300 text-sm">
              <span className="text-gray-500">
                Showing {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, products.length)} of {products.length}
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

      </div>
    </main>
  );
}