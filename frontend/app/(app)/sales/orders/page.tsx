'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileSpreadsheet, Plus, RotateCcw, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import Pagination from '@/app/components/Pagination';

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
  { value: 'ALL' as const, label: 'All' },
  { value: 'DRAFT' as const, label: 'Drafts' },
  { value: 'CONFIRMED' as const, label: 'Confirmed' },
  { value: 'PARTIALLY_DELIVERED' as const, label: 'Partially delivered' },
  { value: 'FULLY_DELIVERED' as const, label: 'Fully delivered' },
  { value: 'CANCELLED' as const, label: 'Cancelled' },
];

export default function SalesOrdersPage() {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState<'ALL' | SalesOrderStatus>('ALL');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const [orders, setOrders] = useState<SalesOrderListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [totalOrders, setTotalOrders] = useState(0);

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
        setError(body?.message ?? `Request failed (${res.status})`);
        setOrders([]);
        setTotalOrders(0);
        return;
      }

      const body = await res.json();
      setOrders(body.data);
      setTotalOrders(body.total);
    } catch {
      setError('Could not reach the server.');
      setOrders([]);
      setTotalOrders(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, page, pageSize]);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, debouncedSearch, pageSize]);

  const visibleOrders = debouncedSearch
    ? orders.filter(
        (o) =>
          o.orderNumber?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          o.customerName?.toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : orders;

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

          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet size={20} strokeWidth={2} className="text-gray-700 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold truncate">Sales Orders</h1>
                <p className="text-xs text-gray-500 truncate">Confirmed and in-progress orders</p>
              </div>
            </div>

            <button
              onClick={() => router.push(`/sales/orders/new?new=${Date.now()}`)}
              className="flex items-center justify-center gap-1.5 text-sm px-3 py-2.5 sm:py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 active:bg-gray-900 w-full sm:w-auto"
            >
              <Plus size={16} strokeWidth={2} />
              New Sales Order
            </button>
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
              placeholder="Search by order number or customer name"
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

        {!loading && !error && visibleOrders.length === 0 && (
          <p className="text-sm text-gray-400">No sales orders match these filters.</p>
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
              className="border-2 border-gray-300 rounded-md p-3 cursor-pointer transition-colors hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="font-semibold truncate">
                      {o.orderNumber ?? 'Unissued draft'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(o.status)}`}>
                      {o.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {o.location?.name ?? '—'} · {o.items.length} item{o.items.length === 1 ? '' : 's'}
                    {o.customerName ? ` · ${o.customerName}` : ''} ·{' '}
                    {new Date(o.confirmedAt ?? o.createdAt).toLocaleDateString('id-ID')}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <span className="font-semibold">{formatIDR(Number(o.total))}</span>

                  {o.status === 'DRAFT' && (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => router.push(`/sales/orders/new?draftId=${o.id}`)}
                        className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-gray-300 hover:bg-gray-100 active:bg-gray-200"
                      >
                        <RotateCcw size={13} strokeWidth={2} />
                        Resume
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