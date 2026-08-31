// app/(app)/purchasing/purchase-orders/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardList, Plus, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { parseCalendarDate } from '@/lib/dates';
import DateRangePicker from '@/app/components/DateRangePicker';
import Pagination from '@/app/components/Pagination';
import { PurchaseOrderListItem, PurchaseOrderStatus } from '@/app/components/purchase-orders/types';

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
    <main className="min-h-screen bg-white text-black">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/purchasing')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <ClipboardList size={20} strokeWidth={2} className="text-gray-700 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold truncate">Purchase Orders</h1>
                <p className="text-xs text-gray-500 truncate">Orders placed with suppliers</p>
              </div>
            </div>

            <button
              onClick={() => router.push('/purchasing/purchase-orders/new')}
              className="flex items-center justify-center gap-1.5 text-sm px-3 py-2.5 sm:py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 active:bg-gray-900 w-full sm:w-auto"
            >
              <Plus size={16} strokeWidth={2} />
              New PO
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
              placeholder="Search by PO number or supplier name"
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
              <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
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
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500 py-8 text-center">Loading...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No purchase orders match these filters.</p>
        ) : (
          <div className="border-2 border-gray-200 rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b-2 border-gray-200">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2.5">PO Number</th>
                    <th className="text-left font-semibold px-4 py-2.5">Supplier</th>
                    <th className="text-left font-semibold px-4 py-2.5 hidden md:table-cell">
                      Receiving Location
                    </th>
                    <th className="text-left font-semibold px-4 py-2.5 hidden sm:table-cell">Date</th>
                    <th className="text-left font-semibold px-4 py-2.5">Status</th>
                    <th className="text-right font-semibold px-4 py-2.5">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((po) => (
                    <tr
                      key={po.id}
                      onClick={() => router.push(`/purchasing/purchase-orders/${po.id}`)}
                      className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50"
                    >
                      <td className="px-4 py-2.5 font-medium">{po.poNumber ?? 'Unissued draft'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{po.supplier?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600 hidden md:table-cell">
                        {po.location?.name ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 hidden sm:table-cell">
                        {parseCalendarDate(po.createdAt).toLocaleDateString('id-ID')}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-md border whitespace-nowrap ${statusStyle(
                            po.status,
                          )}`}
                        >
                          {statusLabel(po.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">{formatIDR(Number(po.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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