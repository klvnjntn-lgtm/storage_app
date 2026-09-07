// app/admin/products/page.tsx
'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
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
import Pagination from '@/app/components/Pagination';
import { useSortableData } from '@/lib/hooks/useSortableData';
import SortableTh from '@/app/components/SortableTh';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

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
type Location = { id: string; name: string };

// Columns the table can be sorted by, same as Stock's SortKey. Status is
// excluded (categorical badge, not a ranked value); OEM is excluded since
// it's an identifier people match against a document, not something
// they'd want ordered.
type SortKey = 'sku' | 'name' | 'category' | 'brand' | 'sellingPrice' | 'costPrice' | 'stock';

const PAGE_SIZE_DEFAULT = 20;
const LOW_STOCK_THRESHOLD = 5;
const DEFAULT_ADJUST_REASON = 'ADMIN ADJUSTMENT';

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
const inputOk = 'border-gray-300 focus:border-blue-500';
const inputBad = 'border-red-400 focus:border-red-500 bg-red-50/40';

function fieldClass(err?: string) {
  return `${inputBase} ${err ? inputBad : inputOk}`;
}

// Compact variant of fieldClass for the smaller inline table inputs.
// Always w-full: the table columns are fixed-width (see <colgroup> below),
// so inputs simply fill whatever space the column already has instead of
// carrying their own width and shifting the column when editing starts.
const rowInputBase =
  'w-full min-w-0 border-2 rounded-md px-2 py-1 text-sm outline-none transition-colors bg-white';
function rowFieldClass(err?: string) {
  return `${rowInputBase} ${err ? inputBad : inputOk}`;
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
    <div className="relative w-full min-w-0" ref={containerRef}>
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
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border-2 border-blue-500/20 rounded-md shadow-lg text-sm">
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
            <div className="px-3 py-2 text-gray-400">No matches</div>
          )}
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(filtered.length)}
              onClick={() => selectOption(value.trim())}
              className={`w-full text-left px-3 py-2 border-t border-blue-500/10 text-gray-600 ${
                highlight === filtered.length ? 'bg-blue-50' : ''
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

// Truncates long display text with an ellipsis instead of letting it force
// the (fixed-width) column wider and triggering horizontal scroll. Full
// text is still available on hover via the native title tooltip.
function CellText({ value, className = '' }: { value: string; className?: string }) {
  return (
    <span className={`block truncate ${className}`} title={value}>
      {value}
    </span>
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
  const [locations, setLocations] = useState<Location[]>([]);

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
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);

  // --- Inline row editing state ---
  // Every catalog field (name, sku, oem, category, brand, prices) is
  // editable inline. Stock is still per-location, so editing it here
  // applies a delta through the same /stock/adjust endpoint the Stock
  // page uses — it does not overwrite a scalar total.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSku, setEditSku] = useState('');
  const [editOem, setEditOem] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editSellingPrice, setEditSellingPrice] = useState('');
  const [editCostPrice, setEditCostPrice] = useState('');
  const [editFieldErrors, setEditFieldErrors] = useState<FieldErrors>({});

  // Stock adjustment fields, part of the same row-edit form.
  const [editStockLocationId, setEditStockLocationId] = useState('');
  const [editStockDelta, setEditStockDelta] = useState('');
  const [editStockReason, setEditStockReason] = useState(DEFAULT_ADJUST_REASON);

  const [savingEdit, setSavingEdit] = useState(false);

  async function loadProducts() {
    const res = await apiFetch('/products', { headers: authHeaders(false) });
    const data = await res.json();
    setProducts(Array.isArray(data) ? data : []);
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

  // NOTE: assumes a /locations endpoint exists (mirroring /categories and
  // /brands) that returns the same locations shown on the Stock page. If
  // your backend exposes this under a different path, update the URL below.
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
    loadProducts();
    loadStockSummary();
    loadCategories();
    loadBrands();
    loadLocations();
  }, []);

  // Sorting applies across the full catalog — the whole list is loaded
  // client-side already (same as Stock), so this reorders everything, not
  // just the current page. Stock's accessor reads the same stockByProduct
  // map the StockBadge cells render from, so it stays in sync once that
  // summary loads.
  const { sorted: sortedProducts, sort, toggleSort } = useSortableData<Product, SortKey>(
    products,
    {
      sku: (p) => p.sku ?? '',
      name: (p) => p.name,
      category: (p) => p.category ?? '',
      brand: (p) => p.brand ?? '',
      sellingPrice: (p) => p.sellingPrice,
      costPrice: (p) => p.costPrice,
      stock: (p) => stockByProduct[p.id]?.totalStock ?? -1,
    },
  );

  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedProducts.slice(start, start + pageSize);
  }, [sortedProducts, page, pageSize]);

  function cellHighlight(key: SortKey) {
    return sort?.key === key ? 'bg-blue-50/70' : '';
  }

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

  // Same check for the inline row editor — excludes the product being edited.
  const editDuplicateSku = useMemo(() => {
    if (!editingId) return false;
    const trimmed = editSku.trim().toLowerCase();
    if (!trimmed) return false;
    return products.some(
      (p) => p.id !== editingId && (p.sku ?? '').trim().toLowerCase() === trimmed
    );
  }, [editSku, products, editingId]);

  // Live margin preview while creating a product.
  const marginPreview = useMemo(() => {
    const sell = parsePriceInput(sellingPriceInput);
    const cost = parsePriceInput(costPriceInput);
    if (typeof sell !== 'number' || typeof cost !== 'number' || sell <= 0) return null;
    const profit = sell - cost;
    const pct = (profit / sell) * 100;
    return { profit, pct };
  }, [sellingPriceInput, costPriceInput]);

  // Live margin preview for the inline row editor.
  const editMarginPreview = useMemo(() => {
    const sell = parsePriceInput(editSellingPrice);
    const cost = parsePriceInput(editCostPrice);
    if (typeof sell !== 'number' || typeof cost !== 'number' || sell <= 0) return null;
    const profit = sell - cost;
    const pct = (profit / sell) * 100;
    return { profit, pct };
  }, [editSellingPrice, editCostPrice]);

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

  // --- Inline row editing (all catalog fields + optional stock delta) ---
  function startEditProduct(product: Product) {
    setError('');
    setSuccessMsg('');
    setEditingId(product.id);
    setEditName(product.name ?? '');
    setEditSku(product.sku ?? '');
    setEditOem(product.oem ?? '');
    setEditCategory(product.category ?? '');
    setEditBrand(product.brand ?? '');
    setEditSellingPrice(product.sellingPrice != null ? String(product.sellingPrice) : '');
    setEditCostPrice(product.costPrice != null ? String(product.costPrice) : '');
    setEditFieldErrors({});
    setEditStockLocationId('');
    setEditStockDelta('');
    setEditStockReason(DEFAULT_ADJUST_REASON);
  }

  function cancelEditProduct() {
    setEditingId(null);
    setEditFieldErrors({});
    setEditStockLocationId('');
    setEditStockDelta('');
    setEditStockReason(DEFAULT_ADJUST_REASON);
  }

  function validateEditForm(): FieldErrors | null {
    const errs: FieldErrors = {};

    if (!editName.trim()) errs.name = 'Required';
    if (!editSku.trim()) errs.sku = 'Required';
    if (!editCategory.trim()) errs.category = 'Required';

    const sellingPrice = parsePriceInput(editSellingPrice);
    if (sellingPrice === null) errs.sellingPrice = 'Must be a non-negative number';

    const costPrice = parsePriceInput(editCostPrice);
    if (costPrice === null) errs.costPrice = 'Must be a non-negative number';

    return Object.keys(errs).length > 0 ? errs : null;
  }

  async function saveEditProduct(id: string) {
    setError('');
    setSuccessMsg('');

    const errs = validateEditForm();
    setEditFieldErrors(errs ?? {});
    if (errs) return;

    const sellingPrice = parsePriceInput(editSellingPrice) as number | undefined;
    const costPrice = parsePriceInput(editCostPrice) as number | undefined;

    // Stock is only touched if the admin actually typed a non-zero delta.
    const trimmedDelta = editStockDelta.trim();
    const stockDeltaNum = trimmedDelta ? Number(trimmedDelta) : 0;
    const wantsStockAdjust = trimmedDelta !== '' && stockDeltaNum !== 0;

    if (trimmedDelta && Number.isNaN(stockDeltaNum)) {
      setError('Stock adjustment must be a number');
      return;
    }
    if (wantsStockAdjust && !editStockLocationId) {
      setError('Pick a location to apply the stock adjustment');
      return;
    }
    if (wantsStockAdjust && !editStockReason.trim()) {
      setError('A reason is required to adjust stock');
      return;
    }

    const product = products.find((p) => p.id === id);
    setSavingEdit(true);

    try {
      const res = await apiFetch(`/products/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          name: editName.trim(),
          sku: editSku.trim(),
          oem: editOem.trim() || undefined,
          category: editCategory.trim(),
          brand: editBrand.trim() || undefined,
          sellingPrice,
          costPrice,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to update product');
      }

      // Applied through the same endpoint the Stock page uses, so it shows
      // up on this product's Event History with whatever reason is given —
      // defaults to "ADMIN ADJUSTMENT" to make edits made from this page
      // easy to spot there.
      if (wantsStockAdjust) {
        const stockRes = await apiFetch('/stock/adjust', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            productId: id,
            locationId: editStockLocationId,
            qtyDelta: stockDeltaNum,
            reason: editStockReason.trim(),
          }),
        });
        if (!stockRes.ok) {
          const data = await stockRes.json().catch(() => null);
          throw new Error(data?.message || 'Product updated, but stock adjustment failed');
        }
      }

      setSuccessMsg(`"${editName.trim() || product?.name}" updated.`);
      setEditingId(null);
      await Promise.all([loadProducts(), loadStockSummary(), loadCategories(), loadBrands()]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update product');
    } finally {
      setSavingEdit(false);
    }
  }

  const pendingProduct = products.find((p) => p.id === pendingArchiveId);
  if (authLoading || !authorized) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{
          backgroundColor: '#f8fafc',
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      >
        <p className="text-sm text-gray-400">Checking access...</p>
      </main>
    );
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

      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Admin
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Package size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                Products
              </h1>
              <p className="text-xs text-gray-500 truncate">Create and manage product catalog</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4 sm:space-y-6">

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
            {successMsg}
          </div>
        )}

        {pendingArchiveId && (
          <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-sm">
            <div className="flex items-center gap-2">
              <Archive size={18} strokeWidth={2} className="shrink-0" />
              <span>
                Archive <strong>{pendingProduct?.name}</strong>? It stays in history but drops out of normal use.
              </span>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={cancelArchive}
                className="px-3 py-1.5 rounded-md border border-amber-300 text-amber-900 text-xs font-semibold hover:bg-amber-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmArchive}
                className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors"
              >
                Confirm Archive
              </button>
            </div>
          </div>
        )}

        {/* Create Product */}
        <div className="border border-blue-500/15 rounded-xl overflow-hidden bg-white shadow-sm">
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-blue-50/60 hover:bg-blue-50 transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Plus size={16} strokeWidth={2.5} className="text-blue-700" />
              New Product
            </span>
            {formOpen ? (
              <ChevronUp size={16} strokeWidth={2} className="text-blue-700" />
            ) : (
              <ChevronDown size={16} strokeWidth={2} className="text-blue-700" />
            )}
          </button>

          {formOpen && (
            <div className="p-4 space-y-5" onKeyDown={handleCreateFormKeyDown}>
              {/* Section: Identity */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700/80 uppercase tracking-wide">
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
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700/80 uppercase tracking-wide">
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
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700/80 uppercase tracking-wide">
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
                    className={`text-xs rounded-md px-3 py-2 border inline-flex items-center gap-1.5 ${
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
                  the Stock page, or edit the product below once it exists.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={createProduct}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Creating...' : 'Create Product'}
                </button>
                <button
                  onClick={resetCreateForm}
                  disabled={loading}
                  className="px-4 py-2 text-gray-500 text-sm hover:text-blue-700 disabled:opacity-40 transition-colors"
                >
                  Clear
                </button>
                <span className="text-xs text-gray-400 ml-auto hidden md:inline">⌘/Ctrl + Enter to submit</span>
              </div>
            </div>
          )}
        </div>

        {/* Product Table */}
        <div className="border border-blue-500/15 rounded-xl overflow-hidden bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-blue-500/15 bg-blue-50/60">
            <h2 className="text-sm font-semibold">Product Catalog</h2>
          </div>

          {products.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">No products found</div>
          ) : (
            <div className="overflow-x-auto">
              {/*
                table-fixed + an explicit <colgroup> pins every column to a
                set percentage width up front. Because the width no longer
                comes from the content, switching a cell between plain text
                and an input (which is always w-full) doesn't reflow the
                columns — only the cell's own content changes. Long text is
                truncated with an ellipsis (see CellText) instead of forcing
                the table wider and requiring a horizontal scroll.
              */}
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '11%' }} />
                </colgroup>
                <thead className="bg-blue-50/60 border-b border-blue-500/15">
                  <tr>
                    <SortableTh<SortKey>
                      label="SKU"
                      columnKey="sku"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    <SortableTh<SortKey>
                      label="Name"
                      columnKey="name"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    <SortableTh<SortKey>
                      label="Category"
                      columnKey="category"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    <SortableTh<SortKey>
                      label="Brand"
                      columnKey="brand"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                    />
                    <SortableTh<SortKey>
                      label="Selling Price"
                      columnKey="sellingPrice"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                      className="whitespace-nowrap"
                    />
                    <SortableTh<SortKey>
                      label="Cost Price"
                      columnKey="costPrice"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                      className="whitespace-nowrap"
                    />
                    {/* SortableTh's label prop is typed as a string, so the
                        Boxes icon that used to sit next to "Total Stock"
                        can't ride along here without changing that type —
                        dropped rather than forcing a cast. */}
                    <SortableTh<SortKey>
                      label="Total Stock"
                      columnKey="stock"
                      activeKey={sort?.key ?? null}
                      direction={sort?.direction ?? null}
                      onSort={toggleSort}
                      className="whitespace-nowrap"
                    />
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                    <th className="text-right px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((product, idx) => {
                    const isEditing = editingId === product.id;
                    const stock = stockByProduct[product.id]?.totalStock;
                    return (
                      <Fragment key={product.id}>
                        <tr
                          className={`border-t border-blue-500/10 ${
                            isEditing ? 'bg-blue-50/60' : idx % 2 === 1 ? 'bg-blue-50/10' : 'bg-white'
                          }`}
                        >
                          <td className={`px-4 py-3 text-gray-500 align-top ${cellHighlight('sku')}`}>
                            {isEditing ? (
                              <div>
                                <input
                                  value={editSku}
                                  onChange={(e) => {
                                    setEditSku(e.target.value);
                                    if (editFieldErrors.sku)
                                      setEditFieldErrors((f) => ({ ...f, sku: undefined }));
                                  }}
                                  className={rowFieldClass(editFieldErrors.sku)}
                                />
                                {editFieldErrors.sku && (
                                  <p className="text-xs text-red-600 mt-1">{editFieldErrors.sku}</p>
                                )}
                                {!editFieldErrors.sku && editDuplicateSku && (
                                  <p className="text-xs text-amber-600 mt-1">Duplicate SKU</p>
                                )}
                              </div>
                            ) : (
                              <CellText value={product.sku ?? '-'} />
                            )}
                          </td>

                          <td className={`px-4 py-3 align-top ${cellHighlight('name')}`}>
                            {isEditing ? (
                              <div>
                                <input
                                  value={editName}
                                  onChange={(e) => {
                                    setEditName(e.target.value);
                                    if (editFieldErrors.name)
                                      setEditFieldErrors((f) => ({ ...f, name: undefined }));
                                  }}
                                  className={rowFieldClass(editFieldErrors.name)}
                                />
                                {editFieldErrors.name && (
                                  <p className="text-xs text-red-600 mt-1">{editFieldErrors.name}</p>
                                )}
                              </div>
                            ) : (
                              <CellText value={product.name} />
                            )}
                          </td>

                          <td className={`px-4 py-3 align-top ${cellHighlight('category')}`}>
                            {isEditing ? (
                              <div>
                                <ComboBox
                                  value={editCategory}
                                  onChange={(v) => {
                                    setEditCategory(v);
                                    if (editFieldErrors.category)
                                      setEditFieldErrors((f) => ({ ...f, category: undefined }));
                                  }}
                                  options={categories}
                                  placeholder="Category"
                                  className={rowFieldClass(editFieldErrors.category)}
                                />
                                {editFieldErrors.category && (
                                  <p className="text-xs text-red-600 mt-1">{editFieldErrors.category}</p>
                                )}
                              </div>
                            ) : (
                              <CellText value={product.category ?? '-'} />
                            )}
                          </td>

                          <td className={`px-4 py-3 align-top ${cellHighlight('brand')}`}>
                            {isEditing ? (
                              <div>
                                <ComboBox
                                  value={editBrand}
                                  onChange={setEditBrand}
                                  options={brands}
                                  placeholder="Brand"
                                  className={rowFieldClass()}
                                />
                              </div>
                            ) : (
                              <CellText value={product.brand ?? '-'} />
                            )}
                          </td>

                          <td className={`px-4 py-3 align-top ${cellHighlight('sellingPrice')}`}>
                            {isEditing ? (
                              <div>
                                <input
                                  type="number"
                                  min="0"
                                  inputMode="decimal"
                                  value={editSellingPrice}
                                  onChange={(e) => {
                                    setEditSellingPrice(e.target.value);
                                    if (editFieldErrors.sellingPrice)
                                      setEditFieldErrors((f) => ({ ...f, sellingPrice: undefined }));
                                  }}
                                  className={rowFieldClass(editFieldErrors.sellingPrice)}
                                />
                                {editFieldErrors.sellingPrice && (
                                  <p className="text-xs text-red-600 mt-1">{editFieldErrors.sellingPrice}</p>
                                )}
                              </div>
                            ) : product.sellingPrice != null ? (
                              <CellText value={formatIDR(product.sellingPrice)} />
                            ) : (
                              <span className="text-gray-400">No price</span>
                            )}
                          </td>

                          <td className={`px-4 py-3 align-top ${cellHighlight('costPrice')}`}>
                            {isEditing ? (
                              <div>
                                <input
                                  type="number"
                                  min="0"
                                  inputMode="decimal"
                                  value={editCostPrice}
                                  onChange={(e) => {
                                    setEditCostPrice(e.target.value);
                                    if (editFieldErrors.costPrice)
                                      setEditFieldErrors((f) => ({ ...f, costPrice: undefined }));
                                  }}
                                  className={rowFieldClass(editFieldErrors.costPrice)}
                                />
                                {editFieldErrors.costPrice && (
                                  <p className="text-xs text-red-600 mt-1">{editFieldErrors.costPrice}</p>
                                )}
                              </div>
                            ) : product.costPrice != null ? (
                              <CellText value={formatIDR(product.costPrice)} />
                            ) : (
                              <span className="text-gray-400">No price</span>
                            )}
                          </td>

                          {/* Stock is per-location — shown read-only here; use
                              the panel below while editing to apply a delta. */}
                          <td
                            className={`px-4 py-3 align-top ${cellHighlight('stock')}`}
                            title={isEditing ? undefined : 'Edit to adjust stock'}
                          >
                            <StockBadge stock={stock} />
                          </td>

                          <td className="px-4 py-3 align-top">
                            <span
                              className={`inline-block max-w-full truncate text-xs px-2 py-0.5 rounded-md border font-medium ${
                                product.active
                                  ? 'bg-green-100 text-green-800 border-green-300'
                                  : 'bg-gray-100 text-gray-600 border-gray-300'
                              }`}
                            >
                              {product.active ? 'Active' : 'Archived'}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-right align-top">
                            {isEditing ? (
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  onClick={() => saveEditProduct(product.id)}
                                  disabled={savingEdit}
                                  title="Save"
                                  className="p-1.5 rounded-md border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-40 transition-colors"
                                >
                                  <Check size={14} strokeWidth={2.5} />
                                </button>
                                <button
                                  onClick={cancelEditProduct}
                                  disabled={savingEdit}
                                  title="Cancel"
                                  className="p-1.5 rounded-md border border-blue-500/20 text-gray-600 hover:bg-blue-50 disabled:opacity-40 transition-colors"
                                >
                                  <X size={14} strokeWidth={2.5} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  onClick={() => startEditProduct(product)}
                                  title="Edit product"
                                  className="p-1.5 rounded-md border border-blue-500/20 text-gray-600 hover:bg-blue-50 transition-colors"
                                >
                                  <Pencil size={14} strokeWidth={2} />
                                </button>
                                {product.active ? (
                                  <button
                                    onClick={() => requestArchive(product.id)}
                                    className="px-3 py-1.5 rounded-md border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50 transition-colors"
                                  >
                                    Archive
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => restoreProduct(product.id)}
                                    className="px-3 py-1.5 rounded-md border border-green-300 text-green-700 text-xs font-semibold hover:bg-green-50 transition-colors"
                                  >
                                    Restore
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>

                        {/* Expanded edit panel: OEM + stock adjustment.
                            Kept out of the narrow columns above so the
                            location/qty/reason controls have room. */}
                        {isEditing && (
                          <tr className="border-t border-blue-500/10 bg-blue-50/40">
                            <td colSpan={9} className="px-4 py-3">
                              <div className="flex flex-wrap items-end gap-3">
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-semibold text-gray-500">OEM number</label>
                                  <input
                                    value={editOem}
                                    onChange={(e) => setEditOem(e.target.value)}
                                    placeholder="optional"
                                    className={`${rowFieldClass()} w-40`}
                                  />
                                </div>

                                <div className="w-px self-stretch bg-blue-500/15 hidden md:block" />

                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-semibold text-gray-500">
                                    Adjust stock — Location
                                  </label>
                                  <select
                                    value={editStockLocationId}
                                    onChange={(e) => setEditStockLocationId(e.target.value)}
                                    className={`${rowFieldClass()} w-40`}
                                  >
                                    <option value="">Select location</option>
                                    {locations.map((l) => (
                                      <option key={l.id} value={l.id}>
                                        {l.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs font-semibold text-gray-500">
                                    Qty (+ in / − out)
                                  </label>
                                  <input
                                    type="number"
                                    value={editStockDelta}
                                    onChange={(e) => setEditStockDelta(e.target.value)}
                                    placeholder="0"
                                    className={`${rowFieldClass()} w-24`}
                                  />
                                </div>
                                <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                                  <label className="text-xs font-semibold text-gray-500">
                                    Reason (logged on the event)
                                  </label>
                                  <input
                                    value={editStockReason}
                                    onChange={(e) => setEditStockReason(e.target.value)}
                                    className={`${rowFieldClass()} w-full`}
                                  />
                                </div>
                              </div>
                              <p className="text-xs text-gray-400 mt-2">
                                Leave qty at 0 to skip a stock change. Adjustments made here go through the same
                                stock endpoint as the Stock page and show up on this product&apos;s Event History
                                — by default tagged &quot;{DEFAULT_ADJUST_REASON}&quot; so they&apos;re easy to
                                tell apart from warehouse-floor activity.
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination — shared component (same as Stock, Customers,
              Vehicles, Reference Data) instead of a hand-rolled Prev/Next
              row, now inside the card so it visually belongs to the table. */}
          {products.length > 0 && (
            <div className="px-4 py-3 border-t border-blue-500/15">
              <Pagination
                page={page}
                pageSize={pageSize}
                totalItems={sortedProducts.length}
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
    </main>
  );
}