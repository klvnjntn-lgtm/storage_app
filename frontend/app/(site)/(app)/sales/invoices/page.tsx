// app/(app)/sales/invoices/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Receipt, Plus, RotateCcw, Trash2, FileText, AlertCircle, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { parseCalendarDate } from '@/lib/dates';
import { formatIDR, paymentStatusStyle, type PaymentStatus } from '@/lib/format';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import Pagination from '@/app/components/shared/Pagination';
import { useLanguage } from '@/app/context/LanguageContext';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

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

const STATUS_OPTIONS = ['ALL', 'DRAFT', 'ISSUED'] as const;

const PAYMENT_OPTIONS = ['ALL', 'UNPAID', 'PARTIAL', 'PAID', 'OVERDUE'] as const;

export default function InvoicesPage() {
  const router = useRouter();
  const { t } = useLanguage();

  function statusOptionLabel(value: (typeof STATUS_OPTIONS)[number]): string {
    switch (value) {
      case 'ALL':
        return t('common.all');
      case 'DRAFT':
        return t('sales.invoicesList.statusActiveDrafts');
      case 'ISSUED':
        return t('sales.invoicesList.statusIssued');
    }
  }

  function paymentOptionLabel(value: (typeof PAYMENT_OPTIONS)[number]): string {
    switch (value) {
      case 'ALL':
        return t('sales.invoicesList.paymentAny');
      case 'UNPAID':
        return t('sales.invoicesList.paymentUnpaid');
      case 'PARTIAL':
        return t('sales.invoicesList.paymentPartial');
      case 'PAID':
        return t('sales.invoicesList.paymentPaid');
      case 'OVERDUE':
        return t('sales.invoicesList.paymentOverdue');
    }
  }

  function statusBadgeLabel(status: string): string {
    switch (status) {
      case 'DRAFT':
        return t('sales.invoicesList.statusDraftBadge');
      case 'ISSUED':
        return t('sales.invoicesList.statusIssuedBadge');
      case 'VOID':
        return t('sales.invoicesList.statusVoidBadge');
      default:
        return status;
    }
  }

  function paymentBadgeLabel(status: string): string {
    switch (status) {
      case 'PAID':
        return t('sales.invoicesList.paymentStatusPaidBadge');
      case 'UNPAID':
        return t('sales.invoicesList.paymentStatusUnpaidBadge');
      case 'PARTIAL':
        return t('sales.invoicesList.paymentStatusPartialBadge');
      default:
        return status;
    }
  }

  // No default range — the page shows every invoice until the person
  // opts into a date filter via the picker. Seeded from the URL so
  // returning via the browser's Back button (e.g. from an invoice detail
  // page) lands back on the same filtered/searched/paged view instead of
  // resetting to page 1 with no filters.
  const [from, setFrom] = useState<string | null>(() => getInitialParam('from', '') || null);
  const [to, setTo] = useState<string | null>(() => getInitialParam('to', '') || null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'ISSUED'>(() =>
    getInitialParam('status', 'ALL')
  );
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | PaymentStatus | 'OVERDUE'>(() =>
    getInitialParam('payment', 'ALL')
  );

  // Search by invoice number or customer name. `search` is what the input
  // shows immediately; `debouncedSearch` is what actually drives the
  // fetch, updated 350ms after the person stops typing so each keystroke
  // doesn't fire a request.
  const [search, setSearch] = useState<string>(() => getInitialParam('search', ''));
  const [debouncedSearch, setDebouncedSearch] = useState<string>(() => getInitialParam('search', ''));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Which date the range applies to. Only surfaced in the UI once a range
  // is set — irrelevant otherwise.
  const [dateField, setDateField] = useState<DateField>(() => getInitialParam('dateField', 'issued'));

  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Separate, date-range-independent count of ALL overdue invoices —
  // decoupled from `invoices` so the badge doesn't hide/shrink just
  // because the visible list's from/to filter happens to exclude an
  // older overdue invoice.
  const [overdueCount, setOverdueCount] = useState<number>(0);

  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', PAGE_SIZE_DEFAULT));

  // Total row count for the *current filters*, as reported by the server —
  // drives Pagination's page-count math. Distinct from invoices.length,
  // which is only the current page.
  const [totalInvoices, setTotalInvoices] = useState(0);

  useSyncQueryParams({
    search: debouncedSearch,
    status: statusFilter !== 'ALL' ? statusFilter : null,
    payment: paymentFilter !== 'ALL' ? paymentFilter : null,
    from,
    to,
    dateField: from && to ? dateField : null,
    page: page !== 1 ? page : null,
    pageSize: pageSize !== PAGE_SIZE_DEFAULT ? pageSize : null,
  });

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
        setError(body?.message ?? t('sales.invoicesList.requestFailed', { status: res.status }));
        setInvoices([]);
        setTotalInvoices(0);
        return;
      }

      const body = await res.json();
      setInvoices(body.data);
      setTotalInvoices(body.total);
    } catch (e) {
      setError(t('sales.invoicesList.serverUnreachable'));
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
    loadOverdueCount();
  }, []);

  // Any filter change invalidates the current page — land back on page 1
  // instead of requesting a stale, possibly out-of-range page from the
  // server. Merged with the load-on-every-dep effect (was two separate
  // effects) so a filter change fires exactly one request instead of two,
  // and — importantly — so this doesn't reset a `page` restored from the
  // URL (e.g. via the browser's Back button) back to 1 on mount: the ref
  // starts equal to the initial filtersKey, so the reset branch only ever
  // fires on an actual change, never on the first render.
  const filtersKey = `${from}|${to}|${statusFilter}|${dateField}|${paymentFilter}|${debouncedSearch}`;
  const prevFiltersKeyRef = useRef(filtersKey);
  useEffect(() => {
    if (prevFiltersKeyRef.current !== filtersKey) {
      prevFiltersKeyRef.current = filtersKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page, pageSize]);

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
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Header — matches Vehicle History Lookup's blue-outline + backdrop-blur treatment */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Receipt size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  {t('sales.invoicesList.title')}
                </h1>
                <p className="text-xs text-gray-500 truncate">{t('sales.invoicesList.subtitle')}</p>
              </div>
            </div>

            {/* Actions stack full-width below the title on mobile so long
                labels never overflow or get clipped on narrow phones;
                side-by-side, auto-width from sm up. */}
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <button
                onClick={() => router.push('/sales/statement/new')}
                className="flex items-center justify-center gap-1.5 text-sm px-3.5 py-2.5 rounded-lg border border-blue-500/25 text-blue-700 font-semibold hover:bg-blue-50 active:bg-blue-100 transition-colors w-full sm:w-auto"
              >
                <FileText size={16} strokeWidth={2} />
                {t('sales.invoicesList.generateStatement')}
              </button>

              <button
                onClick={() => router.push(`/sales/invoices/new?new=${Date.now()}`)}
                className="flex items-center justify-center gap-1.5 text-sm px-3.5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 active:bg-blue-800 shadow-sm transition-colors w-full sm:w-auto"
              >
                <Plus size={16} strokeWidth={2} />
                {t('sales.invoicesList.newInvoice')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6">
        {/* Filters — grouped into one bordered bar with labeled sections
            instead of three stacked, independently-scrolling pill rows.
            Each group gets a small caption so it reads as "Date / Status /
            Payment" rather than one undifferentiated wall of buttons. */}
        <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 mb-4 bg-white shadow-sm">
          {/* Search — invoice number or customer name. Its own row since
              it's the most-reached-for filter and free text doesn't pair
              well visually with the pill groups below it. */}
          <div className="group relative flex items-center gap-2 mb-3 rounded-lg border border-blue-500/20 bg-white px-3 py-2.5 sm:py-2 transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={15} strokeWidth={2} className="text-blue-600/60 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('sales.invoicesList.searchPlaceholder')}
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-gray-400 hover:text-blue-700 p-1 shrink-0"
                aria-label={t('sales.invoicesList.clearSearch')}
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>

          {/* Filter groups stack full-width on mobile (single column),
              then move into a 3-column row from sm up. */}
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr] gap-x-6 gap-y-3">
            {/* Date range */}
            <div>
              <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">
                {t('sales.invoicesList.dateRangeLabel')}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <DateRangePicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />

                {/* Only relevant once a range is actually applied. */}
                {hasDateRange && (
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { value: 'issued' as const, label: t('sales.invoicesList.dateFieldIssued') },
                        { value: 'invoice' as const, label: t('sales.invoicesList.dateFieldInvoiceDate') },
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
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Status */}
            <div>
              <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">
                {t('sales.invoicesList.statusLabel')}
              </p>
              {/* Horizontal scroll on narrow screens instead of wrapping —
                  keeps each pill a comfortable tap target without the row
                  height jumping around. */}
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-0.5 px-0.5 sm:flex-wrap sm:overflow-visible">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setStatusFilter(opt)}
                    className={`text-xs px-3 py-1.5 rounded-md border font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      statusFilter === opt
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-blue-500/20 text-gray-600 bg-white hover:bg-blue-50 hover:border-blue-500/35'
                    }`}
                  >
                    {statusOptionLabel(opt)}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment */}
            <div>
              <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">
                {t('sales.invoicesList.paymentLabel')}
              </p>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-0.5 px-0.5 sm:flex-wrap sm:overflow-visible">
                {PAYMENT_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setPaymentFilter(opt)}
                    className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      paymentFilter === opt
                        ? opt === 'OVERDUE'
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-blue-600 text-white border-blue-600'
                        : opt === 'OVERDUE'
                        ? 'border-red-300 text-red-700 bg-white hover:bg-red-50'
                        : 'border-blue-500/20 text-gray-600 bg-white hover:bg-blue-50 hover:border-blue-500/35'
                    }`}
                  >
                    {opt === 'OVERDUE' && <AlertCircle size={12} strokeWidth={2} />}
                    {paymentOptionLabel(opt)}
                    {opt === 'OVERDUE' && overdueCount > 0 ? ` (${overdueCount})` : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Contextual note + clear-all, only shown when relevant so the
              bar stays quiet by default. Wraps to its own line on mobile
              instead of squeezing against the clear-filters button. */}
          {(hasDateRange && dateField === 'invoice') || activeFilterCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-blue-500/10">
              {hasDateRange && dateField === 'invoice' && (
                <p className="text-xs text-gray-400">
                  {t('sales.invoicesList.invoiceDateFilterNote')}
                </p>
              )}
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-blue-700 shrink-0 transition-colors py-1"
                >
                  <X size={12} strokeWidth={2.5} />
                  {t('sales.invoicesList.clearFilters')}
                </button>
              )}
            </div>
          ) : null}
        </div>

        {/* Error / loading / empty states */}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}

        {!loading && !error && invoices.length === 0 && (
          <p className="text-sm text-gray-400">{t('sales.invoicesList.noInvoicesMatch')}</p>
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
                className={`border rounded-xl p-3 cursor-pointer transition-colors shadow-sm ${
                  overdue
                    ? 'border-red-300 bg-red-50/40 hover:border-red-400 hover:bg-red-50 active:bg-red-100'
                    : 'border-blue-500/15 bg-white hover:border-blue-500/35 hover:bg-blue-50/40 active:bg-blue-50'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span className="font-semibold truncate">
                        {inv.invoiceNumber ?? t('sales.invoicesList.unissuedDraft')}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(inv.status)}`}>
                        {statusBadgeLabel(inv.status)}
                      </span>
                      {inv.status !== 'DRAFT' && (
                        <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${paymentStatusStyle(inv.paymentStatus)}`}>
                          {paymentBadgeLabel(inv.paymentStatus)}
                        </span>
                      )}
                      {overdue && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border font-medium bg-red-100 text-red-800 border-red-400">
                          <AlertCircle size={11} strokeWidth={2} />
                          {t('sales.invoicesList.overdueBadge')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {inv.location?.name ?? '—'} · {inv.items.length}{' '}
                      {t(inv.items.length === 1 ? 'sales.invoicesList.itemCountOne' : 'sales.invoicesList.itemCountOther')}
                      {inv.customerName ? ` · ${inv.customerName}` : ''} ·{' '}
                      {displayDateFor(inv).toLocaleDateString('id-ID')}
                      {inv.dueDate && (
                        <span className={overdue ? 'text-red-600 font-medium' : ''}>
                          {' '}
                          · {t('sales.invoicesList.dueSeparator')} {parseCalendarDate(inv.dueDate).toLocaleDateString('id-ID')}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Amount + actions wrap onto their own line rather than
                      overflowing when both are present on a narrow screen. */}
                  <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0">
                    <span className="font-semibold">{formatIDR(Number(inv.total))}</span>

                    {inv.status === 'DRAFT' && (
                      <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => router.push(`/sales/invoices/new?draftId=${inv.id}`)}
                          className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-blue-500/20 hover:bg-blue-50 active:bg-blue-100 transition-colors"
                        >
                          <RotateCcw size={13} strokeWidth={2} />
                          {t('sales.invoicesList.resume')}
                        </button>
                        <button
                          onClick={() => discardDraft(inv.id)}
                          className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-blue-500/20 hover:bg-red-50 active:bg-red-100 hover:border-red-300 text-red-600 transition-colors"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                          {t('sales.invoicesList.discard')}
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