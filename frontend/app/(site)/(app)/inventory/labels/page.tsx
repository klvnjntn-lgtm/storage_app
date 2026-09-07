'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import Barcode from 'react-barcode';
import { ArrowLeft, Tag, Printer, Minus, Plus, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import PrintLabels from '@/app/components/PrintLabels';
import Pagination from '@/app/components/Pagination';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type Item = {
  sku: string;
  name: string;
};

// Memoized so bumping one item's quantity (or turning a page) doesn't force
// every other visible card to re-run react-barcode's SVG draw — that
// full-grid re-render was the source of the click stutter.
const LabelCard = memo(function LabelCard({
  item,
  quantity,
  onBump,
  onSetQty,
  onPrint,
}: {
  item: Item;
  quantity: number;
  onBump: (sku: string, delta: number) => void;
  onSetQty: (sku: string, qty: number) => void;
  onPrint: (item: Item) => void;
}) {
  return (
    <div className="border-2 border-gray-300 rounded-lg p-3 sm:p-4 flex flex-col items-center gap-2.5 sm:gap-3 bg-white hover:border-blue-500/40 hover:shadow-sm transition-colors">
      <div className="text-center w-full">
        <p className="font-bold text-sm truncate w-full">{item.sku}</p>
        <p className="text-xs text-gray-600 mb-2 truncate w-full">{item.name}</p>
        <div className="flex justify-center overflow-hidden">
          <Barcode value={item.sku} height={30} width={1.3} fontSize={10} margin={0} />
        </div>
      </div>

      {/* Stepper + print stack vertically on mobile so tap targets stay
          full-size instead of shrinking to fit one cramped row */}
      <div className="flex flex-col gap-2 w-full pt-1 border-t border-gray-100">
        <div className="flex items-center justify-center border border-gray-300 rounded-md overflow-hidden self-center">
          <button
            type="button"
            onClick={() => onBump(item.sku, -1)}
            aria-label={`Decrease quantity for ${item.sku}`}
            className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center text-gray-500 hover:bg-gray-100 active:bg-gray-200 hover:text-black disabled:opacity-30 disabled:hover:bg-transparent"
            disabled={quantity <= 1}
          >
            <Minus size={14} strokeWidth={2.5} />
          </button>
          <input
            type="number"
            min={1}
            max={1000}
            value={quantity}
            onChange={(e) => onSetQty(item.sku, parseInt(e.target.value, 10))}
            aria-label={`Quantity for ${item.sku}`}
            className="w-12 sm:w-11 h-9 sm:h-7 text-sm sm:text-xs text-center font-medium border-x border-gray-300 focus:outline-none focus:bg-gray-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => onBump(item.sku, 1)}
            aria-label={`Increase quantity for ${item.sku}`}
            className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center text-gray-500 hover:bg-gray-100 active:bg-gray-200 hover:text-black disabled:opacity-30 disabled:hover:bg-transparent"
            disabled={quantity >= 1000}
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        </div>

        <button
          onClick={() => onPrint(item)}
          className="w-full flex items-center justify-center gap-1.5 bg-blue-600 text-white px-2 py-2 sm:py-1.5 rounded-md text-xs font-semibold hover:bg-blue-700 active:scale-[0.98] transition-transform"
        >
          <Printer size={14} strokeWidth={2} />
          Print {quantity > 1 ? `×${quantity}` : ''}
        </button>
      </div>
    </div>
  );
});

export default function LabelsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [printTarget, setPrintTarget] = useState<Item[] | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  useEffect(() => {
    apiFetch('/products')
      .then((res) => res.json())
      .then((data: Item[]) => {
        setItems(data);
        setQuantities(Object.fromEntries(data.map((i) => [i.sku, 1])));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Reset the print target once the print dialog closes
  useEffect(() => {
    const handleAfterPrint = () => setPrintTarget(null);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  // Filters on every keystroke — no debounce, no submit step — so the grid
  // below updates the instant `query` changes.
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.sku.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)
    );
  }, [items, query]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  // Keep page in range whenever the filtered set (or page size) shrinks/grows
  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  // Jump back to page 1 whenever the search query changes
  useEffect(() => {
    setPage(1);
  }, [query]);

  const paginatedItems = useMemo(
    () => filteredItems.slice((page - 1) * pageSize, page * pageSize),
    [filteredItems, page, pageSize]
  );

  const setQty = useCallback((sku: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [sku]: Math.max(1, Math.min(1000, qty || 1)) }));
  }, []);

  const bumpQty = useCallback((sku: string, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [sku]: Math.max(1, Math.min(1000, (prev[sku] ?? 1) + delta)),
    }));
  }, []);

  const quantitiesRef = useRef(quantities);
  quantitiesRef.current = quantities;

  const buildPrintList = useCallback((source: Item[]) =>
    source.flatMap((item) =>
      Array.from({ length: quantitiesRef.current[item.sku] ?? 1 }, () => item)
    ), []);

  const triggerPrint = useCallback((list: Item[]) => {
    setPrintTarget(list);
    // wait for the print-only grid to render before opening the dialog
    setTimeout(() => window.print(), 50);
  }, []);

  const printOne = useCallback(
    (item: Item) => triggerPrint(buildPrintList([item])),
    [triggerPrint, buildPrintList]
  );
  const printAll = () => triggerPrint(buildPrintList(filteredItems));

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
      {/* Header — hidden on print, sticky so search/"Print All" stay reachable
          while scrolling the grid. Blue-outline + backdrop-blur treatment to
          match /vehicles/search. */}
      <div className="no-print sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Tag size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  Product Labels
                </h1>
                <p className="text-xs text-gray-500 truncate">
                  {filteredItems.length} label{filteredItems.length === 1 ? '' : 's'}
                  {query ? ` matching "${query}"` : ' ready to print'}
                </p>
              </div>
            </div>

            <button
              onClick={printAll}
              disabled={filteredItems.length === 0}
              className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 sm:py-2 rounded-md font-semibold hover:bg-blue-700 active:bg-blue-800 w-full sm:w-auto disabled:opacity-40 disabled:hover:bg-blue-600 transition-colors"
            >
              <Printer size={18} strokeWidth={2} />
              Print All{query ? ' Matches' : ''}
            </button>
          </div>

          {/* Search / filter — command-palette style matching
              /vehicles/search's search bar: outlined, focus glow. */}
          <div className="mt-3 sm:mt-4">
            <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
              <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by SKU or name..."
                aria-label="Search labels by SKU or name"
                className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="text-gray-400 hover:text-blue-700 p-1 shrink-0 transition-colors"
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content — screen view with per-item quantity + print */}
      <div className="no-print p-4 sm:p-6 pb-24 sm:pb-24 max-w-5xl mx-auto">
        {loading && (
          <p className="text-gray-500 text-sm">Loading labels...</p>
        )}

        {!loading && items.length === 0 && (
          <p className="text-gray-500 text-sm">No products found.</p>
        )}

        {!loading && items.length > 0 && filteredItems.length === 0 && (
          <p className="text-sm text-gray-500 bg-white border-2 border-gray-200 rounded-md p-4 text-center">
            No labels match &quot;{query}&quot;
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {paginatedItems.map((item) => (
            <LabelCard
              key={item.sku}
              item={item}
              quantity={quantities[item.sku] ?? 1}
              onBump={bumpQty}
              onSetQty={setQty}
              onPrint={printOne}
            />
          ))}
        </div>
      </div>

      {/* Sticky footer bar keeps pagination reachable and visible instead of
          trailing off at the bottom of a long/short grid */}
      {!loading && filteredItems.length > 0 && (
        <div className="no-print sticky bottom-0 z-10 bg-white/80 backdrop-blur-md border-t border-blue-500/15 px-4 sm:px-6 py-3">
          <div className="max-w-5xl mx-auto">
            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={filteredItems.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              pageSizeOptions={[9, 12, 24, 48]}
            />
          </div>
        </div>
      )}

      {/* Print-only layout — only renders the current print target */}
      <PrintLabels printTarget={printTarget} />
    </main>
  );
}