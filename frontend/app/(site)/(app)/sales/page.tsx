'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ClipboardList, Receipt, Truck, Search, Loader2, CornerDownLeft } from 'lucide-react';
import { HubCard, HubGrid, HubPage, HubSection } from '@/app/components/shared/Hub';
import Pagination from '@/app/components/shared/Pagination';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';
import { formatDMY } from '@/lib/dates';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import { isDesktopRoute, useIsDesktopApp } from '@/lib/desktop';


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

// GET /sales/search always answers with a page envelope, even when no
// page/limit is passed.
type SalesSearchPage = {
  items: SalesSearchResult[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Maps a result's type to its detail route and display chrome. Keep this
// in sync with SALES_ITEMS below if any of those hrefs change. Labels are
// resolved via t() inside the component since they're locale-dependent.
const TYPE_META: Record <
  SalesSearchResultType,
  {
    labelKey: string;
    icon: typeof FileText;
    path: string;
    accent: string;
  }
> = {
  QUOTATION: {
    labelKey: 'sales.overview.typeQuotation',
    icon: FileText,
    path: '/sales/quotations',
    accent: 'text-sky-600 bg-sky-50',
  },
  ORDER: {
    labelKey: 'sales.overview.typeOrder',
    icon: ClipboardList,
    path: '/sales/orders',
    accent: 'text-violet-600 bg-violet-50',
  },
  INVOICE: {
    labelKey: 'sales.overview.typeInvoice',
    icon: Receipt,
    path: '/sales/invoices',
    accent: 'text-fuchsia-600 bg-fuchsia-50',
  },
  DELIVERY_ORDER: {
    labelKey: 'sales.overview.typeDelivery',
    icon: Truck,
    path: '/sales/delivery-orders',
    accent: 'text-emerald-600 bg-emerald-50',
  },
};

const TYPE_FILTERS: Array<{ key: 'ALL' | SalesSearchResultType; labelKey: string }> = [
  { key: 'ALL', labelKey: 'sales.overview.filterAll' },
  { key: 'QUOTATION', labelKey: 'sales.overview.filterQuotations' },
  { key: 'ORDER', labelKey: 'sales.overview.filterOrders' },
  { key: 'INVOICE', labelKey: 'sales.overview.filterInvoices' },
  { key: 'DELIVERY_ORDER', labelKey: 'sales.overview.filterDeliveries' },
];

const DEBOUNCE_MS = 350;
const DROPDOWN_LIMIT = 8;

// "INV 0012" and "inv0012" are the same document number.
const normalizeNumber = (s: string) => s.replace(/\s+/g, '').toUpperCase();

// FIX — useSearchParams() requires a Suspense boundary for static
// prerendering, or `next build` fails outright. See login/page.tsx.
export default function SalesHome() {
  return (
    <Suspense fallback={null}>
      <SalesHomeInner />
    </Suspense>
  );
}

function SalesHomeInner() {
  const router = useRouter();
  const { t } = useLanguage();
  // The desktop app sells straight to invoices (lib/desktop.ts).
  const desktopApp = useIsDesktopApp();

  const SALES_ITEMS = [
    {
      title: t('sales.overview.cardQuotationTitle'),
      description: t('sales.overview.cardQuotationDesc'),
      href: '/sales/quotations',
      icon: FileText,
      gradient: 'from-sky-500 to-blue-700',
    },
    {
      title: t('sales.overview.cardOrderTitle'),
      description: t('sales.overview.cardOrderDesc'),
      href: '/sales/orders',
      icon: ClipboardList,
      gradient: 'from-violet-500 to-purple-700',
    },
    {
      title: t('sales.overview.cardInvoiceTitle'),
      description: t('sales.overview.cardInvoiceDesc'),
      href: '/sales/invoices',
      icon: Receipt,
      gradient: 'from-fuchsia-500 to-pink-700',
    },
    {
      title: t('sales.overview.cardDeliveryTitle'),
      description: t('sales.overview.cardDeliveryDesc'),
      href: '/sales/delivery-orders',
      icon: Truck,
      gradient: 'from-emerald-500 to-teal-700',
    },
  ].filter((item) => !desktopApp || isDesktopRoute(item.href));

  // `query` is the box; `committed` is the search whose full results are
  // listed below (set by Enter). Both, plus the filter and page, are seeded
  // from the URL so Back from a document lands on the same results.
  const [query, setQuery] = useState<string>(() => getInitialParam('q', ''));
  const [committed, setCommitted] = useState<string>(() => getInitialParam('q', '').trim());
  const [typeFilter, setTypeFilter] = useState<'ALL' | SalesSearchResultType>(() => getInitialParam('type', 'ALL'));
  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', 20));

  useSyncQueryParams({
    q: committed,
    type: committed && typeFilter !== 'ALL' ? typeFilter : null,
    page: committed && page !== 1 ? page : null,
    pageSize: committed && pageSize !== 20 ? pageSize : null,
  });

  const trimmed = query.trim();

  // ── Live dropdown while typing ─────────────────────────────────────
  const [dropdown, setDropdown] = useState<SalesSearchPage | null>(null);
  // The text `dropdown` was fetched for — Enter must not act on a stale
  // match list while a newer keystroke's search is still debouncing.
  const [dropdownFor, setDropdownFor] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nothing to suggest for an empty box or for the search already listed below.
  const suggestions = trimmed && trimmed !== committed ? (dropdown?.items ?? []) : [];

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!trimmed || trimmed === committed) return;

    let cancelled = false; // set when a newer keystroke supersedes this search
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(
          `/sales/search?q=${encodeURIComponent(trimmed)}&limit=${DROPDOWN_LIMIT}${desktopApp ? '&type=INVOICE' : ''}`,
        );
        if (cancelled) return;
        if (res.ok) {
          const data: SalesSearchPage = await res.json();
          if (cancelled) return;
          setDropdown(data);
          setDropdownFor(trimmed);
          setDropdownOpen(true);
          setHighlightIndex(0);
        }
      } catch {
        // Stay quiet on transient search errors — user can keep typing.
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [trimmed, committed, desktopApp]);

  // ── Full results for the committed search ──────────────────────────
  const [results, setResults] = useState<SalesSearchPage | null>(null);
  // `loadingResults` is derived: the list is stale until this exact request lands.
  const resultsKey = `${committed}|${typeFilter}|${page}|${pageSize}|${desktopApp}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loadingResults = !!committed && loadedKey !== resultsKey;

  useEffect(() => {
    if (!committed) return;
    let cancelled = false;
    (async () => {
      try {
        const effectiveType = desktopApp ? 'INVOICE' : typeFilter;
        const params = new URLSearchParams({ q: committed, page: String(page), limit: String(pageSize) });
        if (effectiveType !== 'ALL') params.set('type', effectiveType);
        const res = await apiFetch(`/sales/search?${params}`);
        if (cancelled) return;
        if (res.ok) {
          const data: SalesSearchPage = await res.json();
          // Past the end (e.g. a restored page after documents were deleted).
          if (data.total > 0 && page > data.totalPages) {
            setPage(data.totalPages);
            return;
          }
          setResults(data);
        }
      } catch {
        // Leave prior results visible on a transient error.
      } finally {
        if (!cancelled) setLoadedKey(resultsKey);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, typeFilter, page, pageSize, desktopApp]);

  function openResult(r: SalesSearchResult) {
    setDropdownOpen(false);
    router.push(`${TYPE_META[r.type].path}/${r.id}`);
  }

  // Enter with no dropdown showing (or the Enter badge): open the document
  // straight away when the text pins one down — an exact number match or
  // the only match — otherwise list every match below. Same as Workshop's
  // VehicleQuickSearch.
  function submit() {
    const current = dropdownFor === trimmed ? (dropdown?.items ?? []) : [];
    const exact = current.find((r) => r.number && normalizeNumber(r.number) === normalizeNumber(trimmed));
    const only = dropdownFor === trimmed && dropdown?.total === 1 ? current[0] : undefined;
    const match = exact ?? only;
    if (trimmed && trimmed !== committed && match) return openResult(match);
    setDropdownOpen(false);
    setCommitted(trimmed);
    setPage(1);
  }

  function handleChange(value: string) {
    setQuery(value);
    // Emptying the box clears the results and brings the menu back.
    if (!value.trim()) {
      setCommitted('');
      setResults(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (dropdownOpen) setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (dropdownOpen) setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Take the highlighted dropdown row if one's showing, otherwise
      // fall back to the raw typed text (see submit).
      if (dropdownOpen && suggestions[highlightIndex]) {
        openResult(suggestions[highlightIndex]);
      } else {
        submit();
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  }

  const showNotFound = dropdownOpen && dropdownFor === trimmed && trimmed !== committed && suggestions.length === 0;

  return (
    <HubPage path="~/sales" title={t('sales.overview.title')} subtitle={t('sales.overview.subtitle')}>
      {/* Cross-document search — quotation/order/invoice/DO number, or
          customer name, in one box. Behaves like Workshop's quick search:
          Enter (or a click) opens the highlighted dropdown row; the Enter
          badge, or Enter with no dropdown, opens an exact/only match or
          lists every match in place of the menu below. */}
      <HubSection index="01" label={t('common.hubSearch')}>
        <div data-tour="pos-search" className="relative">
          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={query}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => suggestions.length > 0 && setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              placeholder={t('sales.overview.searchPlaceholder')}
              className="flex-1 min-w-0 text-base sm:text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
            {searching ? (
              <Loader2 size={15} strokeWidth={2} className="text-blue-600/60 animate-spin shrink-0" />
            ) : (
              <button
                onClick={submit}
                className="flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-600/10 border border-blue-600/20 rounded-md px-2 py-1 shrink-0 hover:bg-blue-600/15 transition-colors"
              >
                {t('sales.overview.enter')}
                <CornerDownLeft size={11} strokeWidth={2} />
              </button>
            )}
          </div>

          {dropdownOpen && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 border border-blue-500/15 rounded-xl bg-white shadow-lg shadow-blue-900/5 overflow-hidden z-20 max-h-[70vh] overflow-y-auto">
              {suggestions.map((r, idx) => (
                <ResultRow
                  key={`${r.type}-${r.id}`}
                  r={r}
                  highlighted={idx === highlightIndex}
                  last={idx === suggestions.length - 1}
                  onMouseDown={() => openResult(r)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                />
              ))}
            </div>
          )}

          {showNotFound && (
            <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-3 mt-1.5 text-center">
              {t('sales.overview.notFoundFor', { query: trimmed })}
            </p>
          )}
        </div>
      </HubSection>

      {committed ? (
        <HubSection index="02" label={t('sales.overview.results')}>
          {!desktopApp && (
            <div className="flex gap-1.5 overflow-x-auto mb-3 -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    setTypeFilter(f.key);
                    setPage(1);
                  }}
                  className={`text-xs px-3 py-1.5 rounded-md border font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    typeFilter === f.key
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
                  }`}
                >
                  {t(f.labelKey)}
                </button>
              ))}
            </div>
          )}

          {loadingResults && !results && (
            <div className="flex justify-center py-10">
              <Loader2 size={20} strokeWidth={2} className="text-blue-600/60 animate-spin" />
            </div>
          )}

          {!loadingResults && results && results.items.length === 0 && (
            <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-4 text-center">
              {t('sales.overview.notFoundFor', { query: committed })}
            </p>
          )}

          {results && results.items.length > 0 && (
            <div className={`transition-opacity ${loadingResults ? 'opacity-60' : ''}`}>
              <div className="border border-blue-500/15 rounded-xl bg-white shadow-sm overflow-hidden">
                {results.items.map((r, idx) => (
                  <ResultRow
                    key={`${r.type}-${r.id}`}
                    r={r}
                    showStatus
                    last={idx === results.items.length - 1}
                    onClick={() => openResult(r)}
                  />
                ))}
              </div>
              <Pagination
                page={page}
                pageSize={pageSize}
                totalItems={results.total}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            </div>
          )}
        </HubSection>
      ) : (
        <HubSection index="02" label={t('common.hubMenu')}>
          <HubGrid>
            {SALES_ITEMS.map(({ href, ...item }) => (
              <HubCard
                key={href}
                {...item}
                dataTour={`pos-card-${href.split('/').pop()}`}
                onClick={() => router.push(href)}
              />
            ))}
          </HubGrid>
        </HubSection>
      )}
    </HubPage>
  );
}

// One document row — used by both the live dropdown and the full results list.
function ResultRow({
  r,
  highlighted = false,
  last,
  showStatus = false,
  onClick,
  onMouseDown,
  onMouseEnter,
}: {
  r: SalesSearchResult;
  highlighted?: boolean;
  last: boolean;
  showStatus?: boolean;
  onClick?: () => void;
  onMouseDown?: () => void;
  onMouseEnter?: () => void;
}) {
  const { t } = useLanguage();
  const meta = TYPE_META[r.type];
  const Icon = meta.icon;
  return (
    <button
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      className={`w-full text-left px-3.5 py-3 flex items-center gap-3 transition-colors hover:bg-blue-50/70 ${
        highlighted ? 'bg-blue-50/70' : 'bg-white'
      } ${last ? '' : 'border-b border-gray-100'}`}
    >
      <span className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${meta.accent}`}>
        <Icon size={15} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate">{r.number ?? t('sales.overview.unnumbered')}</span>
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide shrink-0">
            {t(meta.labelKey)}
          </span>
          {showStatus && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 shrink-0">
              {r.status}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate">
          {r.customerName ?? t('sales.overview.noCustomer')} · {formatDMY(new Date(r.createdAt))}
        </p>
      </div>
      {r.total != null && <span className="text-sm font-semibold shrink-0">{formatIDR(Number(r.total))}</span>}
    </button>
  );
}
