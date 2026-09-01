// app/(app)/sales/invoices/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Receipt,
  Plus,
  RotateCcw,
  Trash2,
  FileText,
  AlertCircle,
  Search,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { parseCalendarDate } from '@/lib/dates';
import DateRangePicker from '@/app/components/DateRangePicker';
import Pagination from '@/app/components/Pagination';

type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

// Which date field the From/To range filters by. Only meaningful once a
// range is actually set — see the toggle rendered next to the date picker.
type DateField = 'issued' | 'invoice';

type InvoiceListItem = {
  id: string;
  invoiceNumber: string | null;
  // Nullable — a draft can have its invoiceDate cleared. Only an ISSUED
  // invoice is guaranteed to have one (see editIssuedInvoice's invariant).
  invoiceDate: string | Date | null;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  customerName: string | null;
  total: string | number;
  amountPaid: string | number;
  paymentStatus: PaymentStatus;
  dueDate: string | null;
  createdAt: string;
  issuedAt: string | null;
  location: { name: string } | null;
  items: { id: number }[];
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function statusStyle(status: string) {
  switch (status) {
    case 'DRAFT':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    case 'ISSUED':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'VOID':
      return 'bg-gray-100 text-gray-600 border-gray-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
}

function paymentStatusStyle(status: PaymentStatus) {
  switch (status) {
    case 'PAID':
      return 'bg-green-50 text-green-700 border-green-300';
    case 'PARTIAL':
      return 'bg-amber-50 text-amber-700 border-amber-300';
    case 'UNPAID':
      return 'bg-red-50 text-red-700 border-red-300';
  }
}

// An invoice is overdue only once it's actually ISSUED (a draft has no
// binding due date yet), still owes money, and has a due date that's
// already passed. Compares by local calendar day, not exact time, so an
// invoice due "today" isn't flagged overdue until tomorrow.
function isOverdue(inv: InvoiceListItem): boolean {
  if (inv.status !== 'ISSUED') return false;
  if (inv.paymentStatus === 'PAID') return false;
  if (!inv.dueDate) return false;

  const due = parseCalendarDate(inv.dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// The date shown on each row. Prefers invoiceDate (the business date —
// what a shop owner recognizes from the paper copy) and falls back to
// issuedAt/createdAt only when invoiceDate isn't set, same fallback
// pattern as A5Template's displayDate.
function displayDateFor(inv: InvoiceListItem): Date {
  if (inv.invoiceDate) return parseCalendarDate(inv.invoiceDate);
  return new Date(inv.issuedAt ?? inv.createdAt);
}

const PAGE_SIZE_DEFAULT = 20;

const STATUS_OPTIONS = [
  { value: 'ALL' as const, label: 'All' },
  { value: 'DRAFT' as const, label: 'Active drafts' },
  { value: 'ISSUED' as const, label: 'Issued' },
];

const PAYMENT_OPTIONS = [
  { value: 'ALL' as const, label: 'Any' },
  { value: 'UNPAID' as const, label: 'Unpaid' },
  { value: 'PARTIAL' as const, label: 'Partial' },
  { value: 'PAID' as const, label: 'Paid' },
  { value: 'OVERDUE' as const, label: 'Overdue' },
];

export default function InvoicesPage() {
  const router = useRouter();

  // No default range — the page shows every invoice until the person
  // opts into a date filter via the picker.
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'ISSUED'>('ALL');
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | PaymentStatus | 'OVERDUE'>('ALL');

  // Search by invoice number or customer name. `search` is what the input
  // shows immediately; `debouncedSearch` is what actually drives the
  // fetch, updated 350ms after the person stops typing so each keystroke
  // doesn't fire a request.
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Which date the range applies to. Only surfaced in the UI once a range
  // is set — irrelevant otherwise.
  const [dateField, setDateField] = useState<DateField>('issued');

  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Separate, date-range-independent count of ALL overdue invoices —
  // decoupled from `invoices` so the badge doesn't hide/shrink just
  // because the visible list's from/to filter happens to exclude an
  // older overdue invoice.
  const [overdueCount, setOverdueCount] = useState<number>(0);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);

  // Total row count for the *current filters*, as reported by the server —
  // drives Pagination's page-count math. Distinct from invoices.length,
  // which is only the current page.
  const [totalInvoices, setTotalInvoices] = useState(0);

  const hasDateRange = Boolean(from && to);
  const activeFilterCount =
    (hasDateRange ? 1 : 0) +
    (statusFilter !== 'ALL' ? 1 : 0) +
    (paymentFilter !== 'ALL' ? 1 : 0) +
    (debouncedSearch ? 1 : 0);

  function clearFilters() {
    setFrom(null);
    setTo(null);
    setStatusFilter('ALL');
    setPaymentFilter('ALL');
    setSearch('');
  }

  async function loadInvoices() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      // Only send a date range when one is actually set — an unfiltered
      // request returns everything.
      if (from && to) {
        params.set('from', from);
        params.set('to', to);
        params.set('dateField', dateField);
      }
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (paymentFilter === 'OVERDUE') {
        params.set('overdue', 'true');
      } else if (paymentFilter !== 'ALL') {
        params.set('paymentStatus', paymentFilter);
      }
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await apiFetch(`/invoices?${params}`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        setInvoices([]);
        setTotalInvoices(0);
        return;
      }

      const body = await res.json();
      setInvoices(body.data);
      setTotalInvoices(body.total);
    } catch (e) {
      setError('Could not reach the server.');
      setInvoices([]);
      setTotalInvoices(0);
    } finally {
      setLoading(false);
    }
  }

  async function loadOverdueCount() {
    try {
      const res = await apiFetch('/invoices/overdue-count');
      if (!res.ok) return; // non-fatal — badge just stays at its last known value
      const { count } = await res.json();
      setOverdueCount(count);
    } catch {
      // non-fatal — leave the badge as-is rather than surfacing a second error banner
    }
  }

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statusFilter, dateField, paymentFilter, debouncedSearch, page, pageSize]);

  useEffect(() => {
    loadOverdueCount();
  }, []);

  // Any filter change invalidates the current page — land back on page 1
  // instead of requesting a stale, possibly out-of-range page from the
  // server. (Deliberately excludes `page` itself, or this would never let
  // page actually change.)
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statusFilter, dateField, paymentFilter, debouncedSearch, pageSize]);

  // The server now applies every filter (including payment/overdue) and
  // returns exactly one page — no client-side slicing needed.
  const paginatedInvoices = invoices;

  async function discardDraft(id: string) {
    const res = await apiFetch(`/invoices/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setInvoices((prev) => prev.filter((inv) => inv.id !== id));
      loadOverdueCount();
    }
  }

  return (
    <main className="min-h-screen bg-white text-black">
      {/* Header — now matches the Statement page's header style */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/sales')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Receipt size={20} strokeWidth={2} className="text-gray-700" />
              <div>
                <h1 className="text-2xl font-bold">Invoices</h1>
                <p className="text-xs text-gray-500">History and active drafts</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => router.push('/sales/statement/new')}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-black font-semibold hover:bg-gray-100"
              >
                <FileText size={16} strokeWidth={2} />
                Generate Statement
              </button>

              <button
                onClick={() => router.push(`/sales/invoices/new?new=${Date.now()}`)}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800"
              >
                <Plus size={16} strokeWidth={2} />
                New Invoice
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Filters — grouped into one bordered bar with labeled sections
            instead of three stacked, independently-scrolling pill rows.
            Each group gets a small caption so it reads as "Date / Status /
            Payment" rather than one undifferentiated wall of buttons. */}
        <div className="border-2 border-gray-200 rounded-lg p-3 sm:p-4 mb-4 bg-gray-50/60">
          {/* Search — invoice number or customer name. Its own row since
              it's the most-reached-for filter and free text doesn't pair
              well visually with the pill groups below it. */}
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
              placeholder="Search by invoice number or customer name"
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

          <div className="grid sm:grid-cols-[auto_1fr_1fr] gap-x-6 gap-y-3">
            {/* Date range */}
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Date range
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />

                {/* Only relevant once a range is actually applied. */}
                {hasDateRange && (
                  <div className="flex gap-1.5">
                    {(
                      [
                        { value: 'issued' as const, label: 'Issued' },
                        { value: 'invoice' as const, label: 'Invoice date' },
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

            {/* Status */}
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

            {/* Payment */}
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Payment
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PAYMENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPaymentFilter(opt.value)}
                    className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border font-semibold whitespace-nowrap ${
                      paymentFilter === opt.value
                        ? opt.value === 'OVERDUE'
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-black text-white border-black'
                        : opt.value === 'OVERDUE'
                        ? 'border-red-300 text-red-700 bg-white hover:bg-red-50'
                        : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
                    }`}
                  >
                    {opt.value === 'OVERDUE' && <AlertCircle size={12} strokeWidth={2} />}
                    {opt.label}
                    {opt.value === 'OVERDUE' && overdueCount > 0 ? ` (${overdueCount})` : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Contextual note + clear-all, only shown when relevant so the
              bar stays quiet by default. */}
          {(hasDateRange && dateField === 'invoice') || activeFilterCount > 0 ? (
            <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-400">
                {hasDateRange && dateField === 'invoice'
                  ? 'Showing invoices by the date printed on the document — this can differ from when an invoice was actually issued if it was backdated.'
                  : ''}
              </p>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-black shrink-0"
                >
                  <X size={12} strokeWidth={2.5} />
                  Clear filters
                </button>
              )}
            </div>
          ) : null}
        </div>

        {/* Error / loading / empty states */}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-gray-500">Loading...</p>}

        {!loading && !error && invoices.length === 0 && (
          <p className="text-sm text-gray-400">No invoices match these filters.</p>
        )}

        {/* List — each row stacks into: title/badges, meta line, then amount + actions
            full-width on mobile, instead of one row squeezing everything to the right */}
        <div className="flex flex-col gap-2">
          {paginatedInvoices.map((inv) => {
            const overdue = isOverdue(inv);
            return (
              <div
                key={inv.id}
                onClick={() => {
                  if (inv.status === 'DRAFT') {
                    router.push(`/sales/invoices/new?draftId=${inv.id}`);
                  } else {
                    router.push(`/sales/invoices/${inv.id}`);
                  }
                }}
                className={`border-2 rounded-md p-3 cursor-pointer transition-colors ${
                  overdue
                    ? 'border-red-300 bg-red-50/40 hover:border-red-400 hover:bg-red-50 active:bg-red-100'
                    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span className="font-semibold truncate">
                        {inv.invoiceNumber ?? 'Unissued draft'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(inv.status)}`}>
                        {inv.status}
                      </span>
                      {inv.status !== 'DRAFT' && (
                        <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${paymentStatusStyle(inv.paymentStatus)}`}>
                          {inv.paymentStatus}
                        </span>
                      )}
                      {overdue && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border font-medium bg-red-100 text-red-800 border-red-400">
                          <AlertCircle size={11} strokeWidth={2} />
                          OVERDUE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {inv.location?.name ?? '—'} · {inv.items.length} item{inv.items.length === 1 ? '' : 's'}
                      {inv.customerName ? ` · ${inv.customerName}` : ''} ·{' '}
                      {displayDateFor(inv).toLocaleDateString('id-ID')}
                      {inv.dueDate && (
                        <span className={overdue ? 'text-red-600 font-medium' : ''}>
                          {' '}
                          · Due {parseCalendarDate(inv.dueDate).toLocaleDateString('id-ID')}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <span className="font-semibold">{formatIDR(Number(inv.total))}</span>

                    {inv.status === 'DRAFT' && (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => router.push(`/sales/invoices/new?draftId=${inv.id}`)}
                          className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-gray-300 hover:bg-gray-100 active:bg-gray-200"
                        >
                          <RotateCcw size={13} strokeWidth={2} />
                          Resume
                        </button>
                        <button
                          onClick={() => discardDraft(inv.id)}
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
          totalItems={totalInvoices}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </main>
  );
}