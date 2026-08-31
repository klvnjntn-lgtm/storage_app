// app/(app)/sales/delivery-orders/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Truck, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import DateRangePicker from '@/app/components/DateRangePicker';
import Pagination from '@/app/components/Pagination';
import type { DeliveryOrderListItem, DeliveryOrderStatus } from '@/app/components/delivery-orders/types';

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
  { value: 'ALL' as const, label: 'All' },
  { value: 'PACKED' as const, label: 'Packed' },
  { value: 'SHIPPED' as const, label: 'Shipped' },
  { value: 'CANCELLED' as const, label: 'Cancelled' },
];

export default function DeliveryOrdersPage() {
  const router = useRouter();

  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | DeliveryOrderStatus>('ALL');
  const [dateField, setDateField] = useState<DateField>('created');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const [orders, setOrders] = useState<DeliveryOrderListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [total, setTotal] = useState(0);

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
        setError(body?.message ?? `Request failed (${res.status})`);
        setOrders([]);
        setTotal(0);
        return;
      }

      const body = await res.json();
      setOrders(body.data);
      setTotal(body.total);
    } catch {
      setError('Could not reach the server.');
      setOrders([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statusFilter, dateField, debouncedSearch, page, pageSize]);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statusFilter, dateField, debouncedSearch, pageSize]);

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/sales')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <Truck size={20} strokeWidth={2} className="text-gray-700 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold truncate">Delivery Orders</h1>
              <p className="text-xs text-gray-500 truncate">
                Created from sales orders — open an order to pack a new delivery.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="border-2 border-gray-200 rounded-lg p-3 sm:p-4 mb-4 bg-gray-50/60">
          <div className="relative mb-3">
            <Search
              size={15}
              strokeWidth={2}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by DO number or customer name"
              className="w-full text-sm pl-8 pr-8 py-2 rounded-md border-2 border-gray-300 bg-white placeholder:text-gray-400 focus:outline-none focus:border-black"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black p-0.5"
                aria-label="Clear search"
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div className="grid sm:grid-cols-[auto_1fr] gap-x-6 gap-y-3">
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Date range
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                {hasDateRange && (
                  <div className="flex gap-1.5">
                    {(
                      [
                        { value: 'created' as const, label: 'Created' },
                        { value: 'shipped' as const, label: 'Shipped' },
                      ]
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setDateField(opt.value)}
                        className={`text-xs px-2.5 py-1.5 rounded-md border font-semibold whitespace-nowrap ${
                          dateField === opt.value
                            ? 'bg-gray-800 text-white border-gray-800'
                            : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Status
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setStatusFilter(opt.value)}
                    className={`text-xs px-3 py-1.5 rounded-md border font-semibold whitespace-nowrap ${
                      statusFilter === opt.value
                        ? 'bg-black text-white border-black'
                        : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-gray-200">
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-black shrink-0"
              >
                <X size={12} strokeWidth={2.5} />
                Clear filters
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-gray-500">Loading...</p>}

        {!loading && !error && orders.length === 0 && (
          <p className="text-sm text-gray-400">No delivery orders match these filters.</p>
        )}

        <div className="flex flex-col gap-2">
          {orders.map((o) => (
            <div
              key={o.id}
              onClick={() => router.push(`/sales/delivery-orders/${o.id}`)}
              className="border-2 border-gray-300 rounded-md p-3 cursor-pointer transition-colors hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="font-semibold truncate">{o.doNumber ?? o.id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(o.status)}`}>
                      {o.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {o.salesOrder?.orderNumber ? `SO ${o.salesOrder.orderNumber} · ` : ''}
                    {o.items.length} item{o.items.length === 1 ? '' : 's'}
                    {o.customerName ? ` · ${o.customerName}` : ''} ·{' '}
                    {new Date(o.shippedAt ?? o.createdAt).toLocaleDateString('id-ID')}
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