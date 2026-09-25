'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { ClipboardList, Calendar, Package, Receipt, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import Pagination from '@/app/components/shared/Pagination';
import { useLanguage } from '@/app/context/LanguageContext';


type Session = {
  id: string;
  type: string;
  stage: string | null;
  status: string;
  totalItems: number;
  createdAt: string;
  invoice: { id: string; invoiceNumber: string | null } | null;
};

const PAGE_SIZE_DEFAULT = 20;

const statusStyle = (status: string) => {
  switch (status?.toUpperCase()) {
    case 'OPEN':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'COMPLETED':
      return 'bg-green-100 text-green-800 border-green-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
};

export default function SessionsPage() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const dateLocale = language === 'id' ? 'id-ID' : 'en-US';

  const typeLabel = (type: string) => t(`inventory.sessionTypeLabels.${type}`) || type;
  const statusLabel = (status: string) => t(`inventory.sessionStatusLabels.${status}`) || status;

  // Seeded from the URL so pressing the browser's Back button from a
  // session's detail page restores the same filters/page instead of
  // resetting to page 1 with no filters — same pattern as the purchase
  // orders list page.
  const [from, setFrom] = useState<string | null>(() => getInitialParam('from', '') || null);
  const [to, setTo] = useState<string | null>(() => getInitialParam('to', '') || null);
  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', PAGE_SIZE_DEFAULT));

  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useSyncQueryParams({
    from,
    to,
    page: page !== 1 ? page : null,
    pageSize: pageSize !== PAGE_SIZE_DEFAULT ? pageSize : null,
  });

  const hasDateRange = Boolean(from && to);

  function clearFilters() {
    setFrom(null);
    setTo(null);
    setPage(1);
  }

  const requestIdRef = useRef(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      const thisRequest = ++requestIdRef.current;
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (from && to) {
          params.set('from', from);
          params.set('to', to);
        }

        const res = await apiFetch(`/sessions?${params.toString()}`);
        if (thisRequest !== requestIdRef.current) return;
        if (!res.ok) {
          setError(t('inventory.sessionsPage.loadFailed', { status: res.status }));
          setSessions([]);
          setTotal(0);
          return;
        }
        const body = await res.json();
        setSessions(body.data);
        setTotal(body.total);
      } catch {
        if (thisRequest !== requestIdRef.current) return;
        setError(t('inventory.sessionsPage.loadFailed', { status: '—' }));
      } finally {
        if (thisRequest === requestIdRef.current) setLoading(false);
      }
    }

    load();
  }, [page, pageSize, from, to, t]);

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
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <ClipboardList size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div>
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight`}>{t('inventory.sessionsPage.title')}</h1>
              <p className="text-xs text-gray-500">{t('inventory.sessionsPage.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Filters */}
        <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 mb-4 bg-white shadow-sm">
          <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">
            {t('inventory.sessionsPage.dateRange')}
          </p>
          <DateRangePicker from={from} to={to} onChange={(f, t2) => { setFrom(f); setTo(t2); setPage(1); }} />

          {hasDateRange && (
            <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-blue-500/10">
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-blue-700 shrink-0 transition-colors"
              >
                <X size={12} strokeWidth={2.5} />
                {t('inventory.sessionsPage.clearFilters')}
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</p>
        )}

        {loading && (
          <p className="text-sm text-gray-500 py-8 text-center">{t('inventory.sessionsPage.loading')}</p>
        )}

        {!loading && !error && sessions.length === 0 && (
          <p className="text-sm text-gray-400 py-8 text-center">{t('inventory.sessionsPage.noSessions')}</p>
        )}

        <div className="flex flex-col gap-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => router.push(`/inventory/sessions/${session.id}`)}
              className="border border-blue-500/15 rounded-xl p-3 bg-white cursor-pointer transition-colors shadow-sm hover:border-blue-500/35 hover:bg-blue-50/40 active:bg-blue-50"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="font-semibold truncate">{typeLabel(session.type)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(session.status)}`}>
                      {statusLabel(session.status)}
                    </span>
                    {session.invoice && (
                      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border font-medium bg-purple-50 text-purple-700 border-purple-200">
                        <Receipt size={11} strokeWidth={2} />
                        {t('inventory.sessionsPage.fromInvoice', { number: session.invoice.invoiceNumber ?? session.invoice.id.slice(0, 8) })}
                      </span>
                    )}
                  </div>
                  <p className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                    <Calendar size={12} strokeWidth={2} />
                    {new Date(session.createdAt).toLocaleString(dateLocale)}
                  </p>
                </div>

                <div className="flex items-center justify-end gap-1 text-sm font-medium shrink-0">
                  <Package size={14} strokeWidth={2} className="text-gray-500" />
                  {t('inventory.sessionsPage.itemsCount', { count: session.totalItems })}
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
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        />
      </div>
    </main>
  );
}
