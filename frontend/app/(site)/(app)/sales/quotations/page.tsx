'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  FileSpreadsheet,
  Plus,
  RotateCcw,
  Trash2,
  Search,
  X,
  Clock,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { parseCalendarDate } from '@/lib/dates';
import DateRangePicker from '@/app/components/DateRangePicker';
import Pagination from '@/app/components/Pagination';

type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'CONVERTED';
type DateField = 'sent' | 'created';

type QuotationListItem = {
  id: string;
  quotationNumber: string | null;
  status: QuotationStatus;
  customerName: string | null;
  total: string | number;
  validUntil: string | null;
  createdAt: string;
  sentAt: string | null;
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

function statusStyle(status: QuotationStatus) {
  switch (status) {
    case 'DRAFT':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    case 'SENT':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'ACCEPTED':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'REJECTED':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'CONVERTED':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
}

// Client-side only — the backend has no EXPIRED status, validUntil is
// just a date field. Only meaningful while a quotation is still SENT
// (a DRAFT hasn't been offered yet; ACCEPTED/CONVERTED/REJECTED are
// already resolved either way).
function expiryState(q: QuotationListItem): 'expired' | 'soon' | null {
  if (q.status !== 'SENT' || !q.validUntil) return null;
  const due = parseCalendarDate(q.validUntil);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return 'expired';
  if (diffDays <= 3) return 'soon';
  return null;
}

const PAGE_SIZE_DEFAULT = 20;

const STATUS_OPTIONS = [
  { value: 'ALL' as const, label: 'All' },
  { value: 'DRAFT' as const, label: 'Drafts' },
  { value: 'SENT' as const, label: 'Sent' },
  { value: 'ACCEPTED' as const, label: 'Accepted' },
  { value: 'REJECTED' as const, label: 'Rejected' },
  { value: 'CONVERTED' as const, label: 'Converted' },
];

export default function QuotationsPage() {
  const router = useRouter();

  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | QuotationStatus>('ALL');
  const [dateField, setDateField] = useState<DateField>('sent');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const [quotations, setQuotations] = useState<QuotationListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [totalQuotations, setTotalQuotations] = useState(0);

  const hasDateRange = Boolean(from && to);
  const activeFilterCount =
    (hasDateRange ? 1 : 0) + (statusFilter !== 'ALL' ? 1 : 0) + (debouncedSearch ? 1 : 0);

  function clearFilters() {
    setFrom(null);
    setTo(null);
    setStatusFilter('ALL');
    setSearch('');
  }

  async function loadQuotations() {
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
      const res = await apiFetch(`/sales-quotations?${params}`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        setQuotations([]);
        setTotalQuotations(0);
        return;
      }

      const body = await res.json();
      setQuotations(body.data);
      setTotalQuotations(body.total);
    } catch {
      setError('Could not reach the server.');
      setQuotations([]);
      setTotalQuotations(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQuotations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statusFilter, dateField, debouncedSearch, page, pageSize]);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statusFilter, dateField, debouncedSearch, pageSize]);

  async function discardDraft(id: string) {
    const res = await apiFetch(`/sales-quotations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setQuotations((prev) => prev.filter((q) => q.id !== id));
    }
  }

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
                <h1 className="text-xl sm:text-2xl font-bold truncate">Quotations</h1>
                <p className="text-xs text-gray-500 truncate">Proposals and active drafts</p>
              </div>
            </div>

            <button
              onClick={() => router.push(`/sales/quotations/new?new=${Date.now()}`)}
              className="flex items-center justify-center gap-1.5 text-sm px-3 py-2.5 sm:py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 active:bg-gray-900 w-full sm:w-auto"
            >
              <Plus size={16} strokeWidth={2} />
              New Quotation
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
              placeholder="Search by quotation number or customer name"
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
                        { value: 'sent' as const, label: 'Sent' },
                        { value: 'created' as const, label: 'Created' },
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

        {!loading && !error && quotations.length === 0 && (
          <p className="text-sm text-gray-400">No quotations match these filters.</p>
        )}

        <div className="flex flex-col gap-2">
          {quotations.map((q) => {
            const expiry = expiryState(q);
            return (
              <div
                key={q.id}
                onClick={() => {
                  if (q.status === 'DRAFT') {
                    router.push(`/sales/quotations/new?draftId=${q.id}`);
                  } else {
                    router.push(`/sales/quotations/${q.id}`);
                  }
                }}
                className={`border-2 rounded-md p-3 cursor-pointer transition-colors ${
                  expiry === 'expired'
                    ? 'border-red-300 bg-red-50/40 hover:border-red-400 hover:bg-red-50 active:bg-red-100'
                    : expiry === 'soon'
                    ? 'border-amber-300 bg-amber-50/40 hover:border-amber-400 hover:bg-amber-50 active:bg-amber-100'
                    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span className="font-semibold truncate">
                        {q.quotationNumber ?? 'Unissued draft'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(q.status)}`}>
                        {q.status}
                      </span>
                      {expiry && (
                        <span
                          className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border font-medium ${
                            expiry === 'expired'
                              ? 'bg-red-100 text-red-800 border-red-400'
                              : 'bg-amber-100 text-amber-800 border-amber-400'
                          }`}
                        >
                          <Clock size={11} strokeWidth={2} />
                          {expiry === 'expired' ? 'EXPIRED' : 'EXPIRING SOON'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {q.location?.name ?? '—'} · {q.items.length} item{q.items.length === 1 ? '' : 's'}
                      {q.customerName ? ` · ${q.customerName}` : ''} ·{' '}
                      {new Date(q.sentAt ?? q.createdAt).toLocaleDateString('id-ID')}
                      {q.validUntil && (
                        <span className={expiry === 'expired' ? 'text-red-600 font-medium' : ''}>
                          {' '}
                          · Valid until {parseCalendarDate(q.validUntil).toLocaleDateString('id-ID')}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <span className="font-semibold">{formatIDR(Number(q.total))}</span>

                    {q.status === 'DRAFT' && (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => router.push(`/sales/quotations/new?draftId=${q.id}`)}
                          className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-gray-300 hover:bg-gray-100 active:bg-gray-200"
                        >
                          <RotateCcw size={13} strokeWidth={2} />
                          Resume
                        </button>
                        <button
                          onClick={() => discardDraft(q.id)}
                          className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-gray-300 hover:bg-red-50 active:bg-red-100 hover:border-red-300 text-red-600"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                          Discard
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <Pagination
          page={page}
          pageSize={pageSize}
          totalItems={totalQuotations}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </main>
  );
}