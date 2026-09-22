// app/(app)/sales/search/page.tsx
'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { FileText, ClipboardList, Receipt, Truck, Search, Loader2, CornerDownLeft } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';

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

// Kept in sync with TYPE_META in /sales/page.tsx. Labels are resolved via
// t() inside the component since they're locale-dependent.
const TYPE_META: Record<
  SalesSearchResultType,
  {
    labelKey: string;
    icon: typeof FileText;
    path: string;
    accent: string;
  }
> = {
  QUOTATION: {
    labelKey: 'sales.search.typeQuotation',
    icon: FileText,
    path: '/sales/quotations',
    accent: 'text-sky-600 bg-sky-50',
  },
  ORDER: {
    labelKey: 'sales.search.typeOrder',
    icon: ClipboardList,
    path: '/sales/orders',
    accent: 'text-violet-600 bg-violet-50',
  },
  INVOICE: {
    labelKey: 'sales.search.typeInvoice',
    icon: Receipt,
    path: '/sales/invoices',
    accent: 'text-fuchsia-600 bg-fuchsia-50',
  },
  DELIVERY_ORDER: {
    labelKey: 'sales.search.typeDelivery',
    icon: Truck,
    path: '/sales/delivery-orders',
    accent: 'text-emerald-600 bg-emerald-50',
  },
};

const TYPE_FILTERS: Array<{ key: 'ALL' | SalesSearchResultType; labelKey: string }> = [
  { key: 'ALL', labelKey: 'sales.search.filterAll' },
  { key: 'QUOTATION', labelKey: 'sales.search.filterQuotations' },
  { key: 'ORDER', labelKey: 'sales.search.filterOrders' },
  { key: 'INVOICE', labelKey: 'sales.search.filterInvoices' },
  { key: 'DELIVERY_ORDER', labelKey: 'sales.search.filterDeliveries' },
];

const DEBOUNCE_MS = 350;
const RESULTS_LIMIT = 20; // same as HISTORY_LIMIT on /vehicles/search

// FIX — useSearchParams() requires a Suspense boundary for static
// prerendering, or `next build` fails outright. See login/page.tsx.
export default function SalesSearchPage() {
  return (
    <Suspense fallback={null}>
      <SalesSearchPageInner />
    </Suspense>
  );
}

function SalesSearchPageInner() {
  const router = useRouter();
  const { t, language } = useLanguage();

  // Seeded from the URL so pressing the browser's Back button from a
  // result's detail page restores the same query/filter/page instead of
  // resetting to an empty search. Also still serves the deep-link-from-
  // /sales case (?q=...), just via the same param the round-trip uses.
  const [query, setQuery] = useState<string>(() => getInitialParam('q', ''));
  const [typeFilter, setTypeFilter] = useState<'ALL' | SalesSearchResultType>(() =>
    getInitialParam('type', 'ALL')
  );

  const [results, setResults] = useState<SalesSearchPage | null>(null);
  const [resultsPage, setResultsPage] = useState(() => getInitialNumberParam('page', 1));
  const [searching, setSearching] = useState(false);

  useSyncQueryParams({
    q: query.trim(),
    type: typeFilter !== 'ALL' ? typeFilter : null,
    page: resultsPage !== 1 ? resultsPage : null,
  });

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

  // ── Initial load — covers both a deep link from /sales (?q=...) and a
  // query/filter/page restored from the URL via the browser's Back
  // button, using whatever `query`/`typeFilter`/`resultsPage` were seeded
  // to above. Marks the debounce/type-filter effects below to skip their
  // own first run so this doesn't fire a redundant second request (and
  // doesn't reset `resultsPage` back to 1).
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    skipNextSearchRef.current = true;
    loadResults(trimmed, resultsPage, typeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // filter change resetting page on a paginated list. Skips its own first
  // run too — the initial-load effect above already covers mount.
  const isFirstTypeFilterRef = useRef(true);
  useEffect(() => {
    if (isFirstTypeFilterRef.current) {
      isFirstTypeFilterRef.current = false;
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    loadResults(trimmed, 1, typeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

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
          <div className="flex items-center gap-2.5 mb-4">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Search size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('sales.search.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">
                {t('sales.search.subtitle')}
              </p>
            </div>
          </div>

          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('sales.search.searchPlaceholder')}
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
                {t('sales.search.enter')}
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
                  {t(f.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        {results && !searching && results.items.length === 0 && (
          <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-4 text-center">
            {t('sales.search.notFoundFor', { query: query.trim() })}
          </p>
        )}

        {!results && !searching && (
          <div className="flex flex-col items-center justify-center text-center py-16 text-gray-400">
            <Search size={32} strokeWidth={1.5} className="mb-3" />
            <p className="text-sm">{t('sales.search.startTyping')}</p>
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
                        <span className="text-sm font-semibold truncate">{r.number ?? t('sales.search.unnumbered')}</span>
                        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide shrink-0">
                          {t(meta.labelKey)}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 shrink-0">
                          {r.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {r.customerName ?? t('sales.search.noCustomer')} ·{' '}
                        {new Date(r.createdAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US')}
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
                  {t('sales.search.pageOf', { page: results.page, totalPages: results.totalPages, total: results.total })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadResults(query.trim(), resultsPage - 1, typeFilter)}
                    disabled={resultsPage <= 1 || searching}
                    className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    {t('common.previous')}
                  </button>
                  <button
                    onClick={() => loadResults(query.trim(), resultsPage + 1, typeFilter)}
                    disabled={resultsPage >= totalPages || searching}
                    className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    {t('common.next')}
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