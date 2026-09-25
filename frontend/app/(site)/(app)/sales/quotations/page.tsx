'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { FileSpreadsheet, Plus, RotateCcw, Trash2, Search, X, Clock } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { parseCalendarDate } from '@/lib/dates';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import Pagination from '@/app/components/shared/Pagination';
import { useLanguage } from '@/app/context/LanguageContext';


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
  { value: 'ALL' as const, labelKey: 'sales.quotations.filterAll' },
  { value: 'DRAFT' as const, labelKey: 'sales.quotations.filterDrafts' },
  { value: 'SENT' as const, labelKey: 'sales.quotations.filterSent' },
  { value: 'ACCEPTED' as const, labelKey: 'sales.quotations.filterAccepted' },
  { value: 'REJECTED' as const, labelKey: 'sales.quotations.filterRejected' },
  { value: 'CONVERTED' as const, labelKey: 'sales.quotations.filterConverted' },
];

function quotationStatusLabel(t: (key: string) => string, status: QuotationStatus): string {
  switch (status) {
    case 'DRAFT':
      return t('sales.quotations.statusDraft');
    case 'SENT':
      return t('sales.quotations.statusSent');
    case 'ACCEPTED':
      return t('sales.quotations.statusAccepted');
    case 'REJECTED':
      return t('sales.quotations.statusRejected');
    case 'CONVERTED':
      return t('sales.quotations.statusConverted');
    default:
      return status;
  }
}

export default function QuotationsPage() {
  const router = useRouter();
  const { t, language } = useLanguage();

  // Seeded from the URL so pressing the browser's Back button from a
  // quotation's detail page restores the same filters/search/page instead
  // of resetting to page 1 with no filters.
  const [from, setFrom] = useState<string | null>(() => getInitialParam('from', '') || null);
  const [to, setTo] = useState<string | null>(() => getInitialParam('to', '') || null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | QuotationStatus>(() =>
    getInitialParam('status', 'ALL')
  );
  const [dateField, setDateField] = useState<DateField>(() => getInitialParam('dateField', 'sent'));

  const [search, setSearch] = useState<string>(() => getInitialParam('search', ''));
  const [debouncedSearch, setDebouncedSearch] = useState<string>(() => getInitialParam('search', ''));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const [quotations, setQuotations] = useState<QuotationListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', PAGE_SIZE_DEFAULT));
  const [totalQuotations, setTotalQuotations] = useState(0);

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
        setError(body?.message ?? t('sales.quotations.requestFailed', { status: res.status }));
        setQuotations([]);
        setTotalQuotations(0);
        return;
      }

      const body = await res.json();
      setQuotations(body.data);
      setTotalQuotations(body.total);
    } catch {
      setError(t('sales.quotations.serverUnreachable'));
      setQuotations([]);
      setTotalQuotations(0);
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
    loadQuotations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page, pageSize]);

  async function discardDraft(id: string) {
    const res = await apiFetch(`/sales-quotations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setQuotations((prev) => prev.filter((q) => q.id !== id));
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
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <FileSpreadsheet size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  {t('sales.quotations.title')}
                </h1>
                <p className="text-xs text-gray-500 truncate">{t('sales.quotations.subtitle')}</p>
              </div>
            </div>

            <button
              onClick={() => router.push(`/sales/quotations/new?new=${Date.now()}`)}
              className="flex items-center justify-center gap-1.5 text-sm px-3.5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 active:bg-blue-800 shadow-sm w-full sm:w-auto transition-colors"
            >
              <Plus size={16} strokeWidth={2} />
              {t('sales.quotations.newQuotation')}
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
              placeholder={t('sales.quotations.searchPlaceholder')}
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-gray-400 hover:text-blue-700 p-0.5 shrink-0"
                aria-label={t('sales.quotations.clearSearch')}
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div className="grid sm:grid-cols-[auto_1fr] gap-x-6 gap-y-3">
            <div>
              <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">
                {t('sales.quotations.dateRange')}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                {hasDateRange && (
                  <div className="flex gap-1.5">
                    {(
                      [
                        { value: 'sent' as const, labelKey: 'sales.quotations.dateFieldSent' },
                        { value: 'created' as const, labelKey: 'sales.quotations.dateFieldCreated' },
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
                {t('sales.quotations.clearFilters')}
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

        {!loading && !error && quotations.length === 0 && (
          <p className="text-sm text-gray-400">{t('sales.quotations.noResults')}</p>
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
                className={`border rounded-xl p-3 cursor-pointer transition-colors shadow-sm ${
                  expiry === 'expired'
                    ? 'border-red-300 bg-red-50/40 hover:border-red-400 hover:bg-red-50 active:bg-red-100'
                    : expiry === 'soon'
                    ? 'border-amber-300 bg-amber-50/40 hover:border-amber-400 hover:bg-amber-50 active:bg-amber-100'
                    : 'border-blue-500/15 bg-white hover:border-blue-500/35 hover:bg-blue-50/40 active:bg-blue-50'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span className="font-semibold truncate">
                        {q.quotationNumber ?? t('sales.quotations.unissuedDraft')}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(q.status)}`}>
                        {quotationStatusLabel(t, q.status)}
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
                          {expiry === 'expired' ? t('sales.quotations.expired') : t('sales.quotations.expiringSoon')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {q.location?.name ?? '—'} · {q.items.length}{' '}
                      {t(q.items.length === 1 ? 'sales.quotations.item' : 'sales.quotations.items')}
                      {q.customerName ? ` · ${q.customerName}` : ''} ·{' '}
                      {new Date(q.sentAt ?? q.createdAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US')}
                      {q.validUntil && (
                        <span className={expiry === 'expired' ? 'text-red-600 font-medium' : ''}>
                          {' '}
                          · {t('sales.quotations.validUntil')}{' '}
                          {parseCalendarDate(q.validUntil).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US')}
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
                          className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-blue-500/20 hover:bg-blue-50 active:bg-blue-100 transition-colors"
                        >
                          <RotateCcw size={13} strokeWidth={2} />
                          {t('sales.quotations.resume')}
                        </button>
                        <button
                          onClick={() => discardDraft(q.id)}
                          className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-blue-500/20 hover:bg-red-50 active:bg-red-100 hover:border-red-300 text-red-600 transition-colors"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                          {t('sales.quotations.discard')}
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