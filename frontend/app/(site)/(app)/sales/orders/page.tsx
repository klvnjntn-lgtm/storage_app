'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { FileSpreadsheet, Plus, RotateCcw, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import Pagination from '@/app/components/shared/Pagination';
import { useLanguage } from '@/app/context/LanguageContext';


type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_DELIVERED' | 'FULLY_DELIVERED' | 'CANCELLED';

type SalesOrderListItem = {
  id: string;
  orderNumber: string | null;
  status: SalesOrderStatus;
  customerName: string | null;
  total: string | number;
  createdAt: string;
  confirmedAt: string | null;
  location: { name: string } | null;
  items: { id: string }[];
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function statusStyle(status: SalesOrderStatus) {
  switch (status) {
    case 'DRAFT':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    case 'CONFIRMED':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'PARTIALLY_DELIVERED':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'FULLY_DELIVERED':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
}

const PAGE_SIZE_DEFAULT = 20;

const STATUS_OPTIONS = [
  { value: 'ALL' as const, labelKey: 'sales.orders.statusAll' },
  { value: 'DRAFT' as const, labelKey: 'sales.orders.statusDrafts' },
  { value: 'CONFIRMED' as const, labelKey: 'sales.orders.statusConfirmed' },
  { value: 'PARTIALLY_DELIVERED' as const, labelKey: 'sales.orders.statusPartiallyDelivered' },
  { value: 'FULLY_DELIVERED' as const, labelKey: 'sales.orders.statusFullyDelivered' },
  { value: 'CANCELLED' as const, labelKey: 'sales.orders.statusCancelled' },
];

export default function SalesOrdersPage() {
  const router = useRouter();
  const { t, language } = useLanguage();

  // Seeded from the URL so pressing the browser's Back button from an
  // order's detail page restores the same filters/search/page instead of
  // resetting to page 1 with no filters.
  const [statusFilter, setStatusFilter] = useState<'ALL' | SalesOrderStatus>(() =>
    getInitialParam('status', 'ALL')
  );

  const [search, setSearch] = useState<string>(() => getInitialParam('search', ''));
  const [debouncedSearch, setDebouncedSearch] = useState<string>(() => getInitialParam('search', ''));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const [orders, setOrders] = useState<SalesOrderListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', PAGE_SIZE_DEFAULT));
  const [totalOrders, setTotalOrders] = useState(0);

  useSyncQueryParams({
    status: statusFilter !== 'ALL' ? statusFilter : null,
    search: debouncedSearch,
    page: page !== 1 ? page : null,
    pageSize: pageSize !== PAGE_SIZE_DEFAULT ? pageSize : null,
  });

  const activeFilterCount = (statusFilter !== 'ALL' ? 1 : 0) + (debouncedSearch ? 1 : 0);

  function clearFilters() {
    setStatusFilter('ALL');
    setSearch('');
  }

  async function loadOrders() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      // NOTE: SalesOrderService.list() currently only accepts status/page/
      // pageSize — search filtering happens client-side below until the
      // backend supports a `search` param the way quotations do.
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await apiFetch(`/sales-orders?${params}`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('sales.orders.requestFailed', { status: res.status }));
        setOrders([]);
        setTotalOrders(0);
        return;
      }

      const body = await res.json();
      setOrders(body.data);
      setTotalOrders(body.total);
    } catch {
      setError(t('sales.orders.couldNotReachServer'));
      setOrders([]);
      setTotalOrders(0);
    } finally {
      setLoading(false);
    }
  }

  // FIX — was two separate effects (load-on-every-dep + reset-page-on-
  // filter-change), firing two requests whenever statusFilter/pageSize
  // changed. See accounting/ledger/page.tsx's identical fix. Only
  // statusFilter/pageSize are in the merge key — debouncedSearch isn't,
  // since it never changes what's fetched (it only filters the
  // already-fetched page client-side; see loadOrders()'s comment), so it
  // doesn't need to participate in the fetch-vs-reset ordering at all.
  const filtersKey = `${statusFilter}|${pageSize}`;
  const prevFiltersKeyRef = useRef(filtersKey);
  useEffect(() => {
    if (prevFiltersKeyRef.current !== filtersKey) {
      prevFiltersKeyRef.current = filtersKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page]);

  // A new search term starts the (client-side-only) filtered view back
  // at page 1, same as the original behavior. Skips the very first run,
  // or a `page` restored from the URL (e.g. via the browser's Back
  // button) would get reset to 1 on mount.
  const isFirstSearchResetRef = useRef(true);
  useEffect(() => {
    if (isFirstSearchResetRef.current) {
      isFirstSearchResetRef.current = false;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const visibleOrders = debouncedSearch
    ? orders.filter(
        (o) =>
          o.orderNumber?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          o.customerName?.toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : orders;

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
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <FileSpreadsheet size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  {t('sales.orders.title')}
                </h1>
                <p className="text-xs text-gray-500 truncate">{t('sales.orders.subtitle')}</p>
              </div>
            </div>

            <button
              onClick={() => router.push(`/sales/orders/new?new=${Date.now()}`)}
              className="flex items-center justify-center gap-1.5 text-sm px-3.5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 active:bg-blue-800 shadow-sm w-full sm:w-auto transition-colors"
            >
              <Plus size={16} strokeWidth={2} />
              {t('sales.orders.newOrder')}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 mb-4 bg-white shadow-sm">
          <div className="group relative flex items-center gap-2 mb-3 rounded-lg border border-blue-500/20 bg-white px-3 py-2 transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={15} strokeWidth={2} className="text-blue-600/60 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('sales.orders.searchPlaceholder')}
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-gray-400 hover:text-blue-700 p-0.5 shrink-0"
                aria-label={t('sales.orders.clearSearch')}
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">
              {t('common.status')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={`text-xs px-3 py-1.5 rounded-md border font-semibold whitespace-nowrap transition-colors ${
                    statusFilter === opt.value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-blue-500/20 text-gray-600 bg-white hover:bg-blue-50 hover:border-blue-500/35'
                  }`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-blue-500/10">
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-blue-700 shrink-0 transition-colors"
              >
                <X size={12} strokeWidth={2.5} />
                {t('sales.orders.clearFilters')}
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}

        {!loading && !error && visibleOrders.length === 0 && (
          <p className="text-sm text-gray-400">{t('sales.orders.noMatch')}</p>
        )}

        {/* FIX — search only filters the current page client-side (the
            backend doesn't support a search param here yet, unlike
            quotations/invoices — see loadOrders()'s own comment), so a
            matching order sitting on another page never shows and the
            pagination control below (driven by the server's unfiltered
            total) doesn't reflect what's actually visible. Surfacing
            that explicitly rather than silently showing a misleading
            page count. */}
        {!loading && !error && debouncedSearch && (
          <p className="text-xs text-amber-700 -mt-1">
            {t('sales.orders.searchOnlyPage', {
              count: visibleOrders.length,
              matchWord: t(visibleOrders.length === 1 ? 'sales.orders.matchSingular' : 'sales.orders.matchPlural'),
            })}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {visibleOrders.map((o) => (
            <div
              key={o.id}
              onClick={() => {
                if (o.status === 'DRAFT') {
                  router.push(`/sales/orders/new?draftId=${o.id}`);
                } else {
                  router.push(`/sales/orders/${o.id}`);
                }
              }}
              className="border border-blue-500/15 rounded-xl p-3 bg-white cursor-pointer transition-colors shadow-sm hover:border-blue-500/35 hover:bg-blue-50/40 active:bg-blue-50"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="font-semibold truncate">
                      {o.orderNumber ?? t('sales.orders.unissuedDraft')}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(o.status)}`}>
                      {t(`sales.orders.badge.${o.status}`)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {o.location?.name ?? '—'} · {o.items.length}{' '}
                    {t(o.items.length === 1 ? 'sales.orders.itemSingular' : 'sales.orders.itemPlural')}
                    {o.customerName ? ` · ${o.customerName}` : ''} ·{' '}
                    {new Date(o.confirmedAt ?? o.createdAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US')}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <span className="font-semibold">{formatIDR(Number(o.total))}</span>

                  {o.status === 'DRAFT' && (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => router.push(`/sales/orders/new?draftId=${o.id}`)}
                        className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-blue-500/20 hover:bg-blue-50 active:bg-blue-100 transition-colors"
                      >
                        <RotateCcw size={13} strokeWidth={2} />
                        {t('sales.orders.resume')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <Pagination
          page={page}
          pageSize={pageSize}
          totalItems={totalOrders}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </main>
  );
}