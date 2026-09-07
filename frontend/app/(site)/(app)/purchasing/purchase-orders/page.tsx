// app/(app)/purchasing/purchase-orders/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ArrowLeft, ClipboardList, Plus, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { parseCalendarDate } from '@/lib/dates';
import DateRangePicker from '@/app/components/DateRangePicker';
import Pagination from '@/app/components/Pagination';
import { PurchaseOrderListItem, PurchaseOrderStatus } from '@/app/components/purchase-orders/types';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type StatusFilter = PurchaseOrderStatus | 'ALL';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Sent' },
  { value: 'PARTIALLY_RECEIVED', label: 'Partially Received' },
  { value: 'FULLY_RECEIVED', label: 'Fully Received' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function statusLabel(status: PurchaseOrderStatus) {
  switch (status) {
    case 'PARTIALLY_RECEIVED':
      return 'Partially Received';
    case 'FULLY_RECEIVED':
      return 'Fully Received';
    default:
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
}

function statusStyle(status: PurchaseOrderStatus) {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-100 text-gray-700 border-gray-300';
    case 'SENT':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'PARTIALLY_RECEIVED':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    case 'FULLY_RECEIVED':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 border-red-300';
  }
}

const PAGE_SIZE_DEFAULT = 20;

export default function PurchaseOrdersListPage() {
  const router = useRouter();

  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const [orders, setOrders] = useState<PurchaseOrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);

  const hasDateRange = Boolean(from && to);
  const activeFilterCount =
    (hasDateRange ? 1 : 0) + (statusFilter !== 'ALL' ? 1 : 0) + (debouncedSearch ? 1 : 0);

  function clearFilters() {
    setFrom(null);
    setTo(null);
    setStatusFilter('ALL');
    setSearch('');
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (from && to) {
        params.set('from', from);
        params.set('to', to);
      }
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await apiFetch(`/purchase-orders?${params.toString()}`);
      if (!res.ok) {
        setError(`Request failed (${res.status})`);
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, from, to, debouncedSearch, page, pageSize]);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, from, to, debouncedSearch, pageSize]);

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
          <button
            onClick={() => router.push('/purchasing')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <ClipboardList size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  Purchase Orders
                </h1>
                <p className="text-xs text-gray-500 truncate">Orders placed with suppliers</p>
              </div>
            </div>

            <button
              onClick={() => router.push('/purchasing/purchase-orders/new')}
              className="flex items-center justify-center gap-1.5 text-sm px-3.5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 active:bg-blue-800 shadow-sm w-full sm:w-auto transition-colors"
            >
              <Plus size={16} strokeWidth={2} />
              New PO
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
              placeholder="Search by PO number or supplier name"
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-gray-400 hover:text-blue-700 p-0.5 shrink-0"
                aria-label="Clear search"
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div className="grid sm:grid-cols-[auto_1fr] gap-x-6 gap-y-3">
            <div>
              <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">
                Date range
              </p>
              <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
            </div>

            <div>
              <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">
                Status
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
                    {opt.label}
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
                Clear filters
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</p>
        )}

        {loading && <p className="text-sm text-gray-500 py-8 text-center">Loading...</p>}

        {!loading && !error && orders.length === 0 && (
          <p className="text-sm text-gray-400 py-8 text-center">No purchase orders match these filters.</p>
        )}

        {/* Card list — same treatment as Invoices/Quotations/Sales Orders:
            title + status badge on top, a meta line underneath, total and
            (where relevant) actions at the end. Replaces the previous
            sortable table since a card stack has no header row to sort
            from. */}
        <div className="flex flex-col gap-2">
          {orders.map((po) => (
            <div
              key={po.id}
              onClick={() => router.push(`/purchasing/purchase-orders/${po.id}`)}
              className="border border-blue-500/15 rounded-xl p-3 bg-white cursor-pointer transition-colors shadow-sm hover:border-blue-500/35 hover:bg-blue-50/40 active:bg-blue-50"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="font-semibold truncate">
                      {po.poNumber ?? 'Unissued draft'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(po.status)}`}>
                      {statusLabel(po.status)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {po.supplier?.name ?? '—'}
                    {po.location?.name ? ` · ${po.location.name}` : ''} ·{' '}
                    {parseCalendarDate(po.createdAt).toLocaleDateString('id-ID')}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <span className="font-semibold">{formatIDR(Number(po.total))}</span>
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