// app/(app)/sales/delivery-orders/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Truck, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import Pagination from '@/app/components/shared/Pagination';
import type { DeliveryOrderListItem, DeliveryOrderStatus } from '@/app/components/delivery-orders/types';
import { mapDeliveryOrderToListItem } from '@/lib/mappers/delivery-orders-mapper';
import { useLanguage } from '@/app/context/LanguageContext';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type DateField = 'shipped' | 'created';

function statusStyle(status: DeliveryOrderStatus) {
  switch (status) {
    case 'PACKED':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    case 'SHIPPED':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
}

const PAGE_SIZE_DEFAULT = 20;

const STATUS_OPTIONS = [
  { value: 'ALL' as const, labelKey: 'sales.deliveryOrders.statusAll' },
  { value: 'PACKED' as const, labelKey: 'sales.deliveryOrders.statusPacked' },
  { value: 'SHIPPED' as const, labelKey: 'sales.deliveryOrders.statusShipped' },
  { value: 'CANCELLED' as const, labelKey: 'sales.deliveryOrders.statusCancelled' },
];

export default function DeliveryOrdersPage() {
  const router = useRouter();
  const { t, language } = useLanguage();

  // Seeded from the URL so pressing the browser's Back button from a
  // delivery order's detail page restores the same filters/search/page
  // instead of resetting to page 1 with no filters.
  const [from, setFrom] = useState<string | null>(() => getInitialParam('from', '') || null);
  const [to, setTo] = useState<string | null>(() => getInitialParam('to', '') || null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | DeliveryOrderStatus>(() =>
    getInitialParam('status', 'ALL')
  );
  const [dateField, setDateField] = useState<DateField>(() => getInitialParam('dateField', 'created'));

  const [search, setSearch] = useState<string>(() => getInitialParam('search', ''));
  const [debouncedSearch, setDebouncedSearch] = useState<string>(() => getInitialParam('search', ''));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const [orders, setOrders] = useState<DeliveryOrderListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', PAGE_SIZE_DEFAULT));
  const [total, setTotal] = useState(0);

  useSyncQueryParams({
    search: debouncedSearch,
    status: statusFilter !== 'ALL' ? statusFilter : null,
    from,
    to,
    dateField: from && to ? dateField : null,
    page: page !== 1 ? page : null,
    pageSize: pageSize !== PAGE_SIZE_DEFAULT ? pageSize : null,
  });

  const hasDateRange = Boolean(from && to);
  const activeFilterCount =
    (hasDateRange ? 1 : 0) + (statusFilter !== 'ALL' ? 1 : 0) + (debouncedSearch ? 1 : 0);

  function clearFilters() {
    setFrom(null);
    setTo(null);
    setStatusFilter('ALL');
    setSearch('');
  }

  async function loadOrders() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from && to) {
        params.set('from', from);
        params.set('to', to);
        params.set('dateField', dateField);
      }
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await apiFetch(`/delivery-orders?${params}`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('sales.deliveryOrders.requestFailed', { status: res.status }));
        setOrders([]);
        setTotal(0);
        return;
      }

      const body = await res.json();
      // FIX — was a bare `body.data` assignment trusting the raw fetch
      // response's shape at face value. mapDeliveryOrderToListItem was
      // defined for exactly this and had zero callers anywhere.
      setOrders(body.data.map(mapDeliveryOrderToListItem));
      setTotal(body.total);
    } catch {
      setError(t('sales.deliveryOrders.couldNotReachServer'));
      setOrders([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  // Merged with the reset-page-on-filter-change effect (was two separate
  // effects) so a filter change fires exactly one request instead of two,
  // and so a `page` restored from the URL (e.g. via the browser's Back
  // button) doesn't get reset to 1 on mount — the ref starts equal to the
  // initial filtersKey, so the reset branch only fires on an actual change.
  const filtersKey = `${from}|${to}|${statusFilter}|${dateField}|${debouncedSearch}`;
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
  }, [filtersKey, page, pageSize]);

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
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Truck size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('sales.deliveryOrders.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">
                {t('sales.deliveryOrders.subtitle')}
              </p>
            </div>
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
              placeholder={t('sales.deliveryOrders.searchPlaceholder')}
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-gray-400 hover:text-blue-700 p-0.5 shrink-0"
                aria-label={t('sales.deliveryOrders.clearSearch')}
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div className="grid sm:grid-cols-[auto_1fr] gap-x-6 gap-y-3">
            <div>
              <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">
                {t('sales.deliveryOrders.dateRange')}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <DateRangePicker from={from} to={to} onChange={(f, tv) => { setFrom(f); setTo(tv); }} />
                {hasDateRange && (
                  <div className="flex gap-1.5">
                    {(
                      [
                        { value: 'created' as const, labelKey: 'sales.deliveryOrders.dateFieldCreated' },
                        { value: 'shipped' as const, labelKey: 'sales.deliveryOrders.dateFieldShipped' },
                      ]
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setDateField(opt.value)}
                        className={`text-xs px-2.5 py-1.5 rounded-md border font-semibold whitespace-nowrap transition-colors ${
                          dateField === opt.value
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-blue-500/20 text-gray-600 bg-white hover:bg-blue-50 hover:border-blue-500/35'
                        }`}
                      >
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
          </div>

          {activeFilterCount > 0 && (
            <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-blue-500/10">
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-blue-700 shrink-0 transition-colors"
              >
                <X size={12} strokeWidth={2.5} />
                {t('sales.deliveryOrders.clearFilters')}
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

        {!loading && !error && orders.length === 0 && (
          <p className="text-sm text-gray-400">{t('sales.deliveryOrders.noMatch')}</p>
        )}

        <div className="flex flex-col gap-2">
          {orders.map((o) => (
            <div
              key={o.id}
              onClick={() => router.push(`/sales/delivery-orders/${o.id}`)}
              className="border border-blue-500/15 rounded-xl p-3 bg-white cursor-pointer transition-colors shadow-sm hover:border-blue-500/35 hover:bg-blue-50/40 active:bg-blue-50"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="font-semibold truncate">{o.doNumber ?? o.id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(o.status)}`}>
                      {t(`sales.deliveryOrders.badge.${o.status}`)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {o.salesOrder?.orderNumber ? `SO ${o.salesOrder.orderNumber} · ` : ''}
                    {o.items.length} {t(o.items.length === 1 ? 'sales.deliveryOrders.itemSingular' : 'sales.deliveryOrders.itemPlural')}
                    {o.customerName ? ` · ${o.customerName}` : ''} ·{' '}
                    {new Date(o.shippedAt ?? o.createdAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US')}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Pagination
          page={page}
          pageSize={pageSize}
          totalItems={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </main>
  );
}