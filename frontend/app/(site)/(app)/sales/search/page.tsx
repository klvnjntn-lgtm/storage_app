// app/(app)/sales/search/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import {
  ArrowLeft,
  FileText,
  ClipboardList,
  Receipt,
  Truck,
  Search,
  Loader2,
  CornerDownLeft,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type SalesSearchResultType = 'QUOTATION' | 'ORDER' | 'INVOICE' | 'DELIVERY_ORDER';

type SalesSearchResult = {
  id: string;
  type: SalesSearchResultType;
  number: string | null;
  customerName: string | null;
  status: string;
  total: string | null;
  createdAt: string;
};

// Same envelope shape as /vehicles/:id/history's HistoryPage.
type SalesSearchPage = {
  items: SalesSearchResult[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Kept in sync with TYPE_META in /sales/page.tsx.
const TYPE_META: Record<
  SalesSearchResultType,
  {
    label: string;
    icon: typeof FileText;
    path: string;
    accent: string;
  }
> = {
  QUOTATION: {
    label: 'Quotation',
    icon: FileText,
    path: '/sales/quotations',
    accent: 'text-sky-600 bg-sky-50',
  },
  ORDER: {
    label: 'Order',
    icon: ClipboardList,
    path: '/sales/orders',
    accent: 'text-violet-600 bg-violet-50',
  },
  INVOICE: {
    label: 'Invoice',
    icon: Receipt,
    path: '/sales/invoices',
    accent: 'text-fuchsia-600 bg-fuchsia-50',
  },
  DELIVERY_ORDER: {
    label: 'Delivery',
    icon: Truck,
    path: '/sales/delivery-orders',
    accent: 'text-emerald-600 bg-emerald-50',
  },
};

const TYPE_FILTERS: Array<{ key: 'ALL' | SalesSearchResultType; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'QUOTATION', label: 'Quotations' },
  { key: 'ORDER', label: 'Orders' },
  { key: 'INVOICE', label: 'Invoices' },
  { key: 'DELIVERY_ORDER', label: 'Deliveries' },
];

const DEBOUNCE_MS = 350;
const RESULTS_LIMIT = 20; // same as HISTORY_LIMIT on /vehicles/search

export default function SalesSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | SalesSearchResultType>('ALL');

  const [results, setResults] = useState<SalesSearchPage | null>(null);
  const [resultsPage, setResultsPage] = useState(1);
  const [searching, setSearching] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSearchRef = useRef(false); // set before a programmatic setQuery

  // ── Fetch a page of results — same role as loadHistory() on /vehicles/search ──
  async function loadResults(q: string, page: number, type: 'ALL' | SalesSearchResultType) {
    setSearching(true);
    try {
      const typeParam = type === 'ALL' ? '' : `&type=${type}`;
      const res = await apiFetch(
        `/sales/search?q=${encodeURIComponent(q)}&page=${page}&limit=${RESULTS_LIMIT}${typeParam}`,
      );
      if (res.ok) {
        const data: SalesSearchPage = await res.json();
        setResults(data);
        setResultsPage(page);
      }
    } catch {
      // Leave prior results visible on a transient error.
    } finally {
      setSearching(false);
    }
  }

  // ── Debounced live search as you type — resets to page 1, same as
  // selectVehicle() resetting historyPage to 1 on /vehicles/search ──────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      loadResults(trimmed, 1, typeFilter);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Changing the type filter re-queries from page 1, same idea as a
  // filter change resetting page on a paginated list.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    loadResults(trimmed, 1, typeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  // ── Deep link from /sales (?q=...) ──────────────────────────────────
  useEffect(() => {
    const initialQ = searchParams.get('q');
    if (!initialQ) return;
    skipNextSearchRef.current = true;
    setQuery(initialQ);
    loadResults(initialQ, 1, 'ALL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openResult(r: SalesSearchResult) {
    router.push(`${TYPE_META[r.type].path}/${r.id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = query.trim();
      if (trimmed) loadResults(trimmed, 1, typeFilter);
    }
  }

  const totalPages = results?.totalPages ?? 1;

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.07) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Header — same outlined/blurred treatment as Workshop + Sales */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-6 py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => router.push('/sales')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-3 transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Sales
          </button>

          <div className="flex items-center gap-2.5 mb-4">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Search size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                Sales Search
              </h1>
              <p className="text-xs text-gray-500 truncate">
                Search across quotations, orders, invoices, and deliveries
              </p>
            </div>
          </div>

          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search invoice #, order #, quotation #, DO #, or customer..."
              autoFocus
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
            {searching ? (
              <Loader2 size={15} strokeWidth={2} className="text-blue-600/60 animate-spin shrink-0" />
            ) : (
              <button
                onClick={() => query.trim() && loadResults(query.trim(), 1, typeFilter)}
                className="flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-600/10 border border-blue-600/20 rounded-md px-2 py-1 shrink-0 hover:bg-blue-600/15 transition-colors"
              >
                Enter
                <CornerDownLeft size={11} strokeWidth={2} />
              </button>
            )}
          </div>

          {results && results.items.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto mt-3 -mx-6 px-6 sm:mx-0 sm:px-0 sm:overflow-visible">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setTypeFilter(f.key)}
                  className={`text-xs px-3 py-1.5 rounded-md border font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    typeFilter === f.key
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        {results && !searching && results.items.length === 0 && (
          <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-4 text-center">
            No quotations, orders, invoices, or deliveries found for &quot;{query.trim()}&quot;
          </p>
        )}

        {!results && !searching && (
          <div className="flex flex-col items-center justify-center text-center py-16 text-gray-400">
            <Search size={32} strokeWidth={1.5} className="mb-3" />
            <p className="text-sm">Start typing above to search across all sales documents.</p>
          </div>
        )}

        {results && results.items.length > 0 && (
          <>
            <div className="flex flex-col gap-2">
              {results.items.map((r) => {
                const meta = TYPE_META[r.type];
                const Icon = meta.icon;
                return (
                  <button
                    key={`${r.type}-${r.id}`}
                    onClick={() => openResult(r)}
                    className="w-full text-left flex items-center gap-3 border-2 border-gray-300 rounded-md p-3 hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  >
                    <span className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${meta.accent}`}>
                      <Icon size={16} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold truncate">{r.number ?? 'Unnumbered'}</span>
                        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide shrink-0">
                          {meta.label}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 shrink-0">
                          {r.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {r.customerName ?? 'No customer'} · {new Date(r.createdAt).toLocaleDateString('id-ID')}
                      </p>
                    </div>
                    {r.total != null && (
                      <span className="text-sm font-semibold shrink-0">{formatIDR(Number(r.total))}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Pagination — identical shape/behavior to /vehicles/search's
                Previous/Next block, just pointed at loadResults(). */}
            {results.total > 0 && (
              <div className="flex items-center justify-between mt-4 text-sm">
                <span className="text-gray-500">
                  Page {results.page} of {results.totalPages} · {results.total} total
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadResults(query.trim(), resultsPage - 1, typeFilter)}
                    disabled={resultsPage <= 1 || searching}
                    className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => loadResults(query.trim(), resultsPage + 1, typeFilter)}
                    disabled={resultsPage >= totalPages || searching}
                    className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}