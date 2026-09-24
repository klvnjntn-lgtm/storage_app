// app/accounting/ap-aging/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ShoppingCart, Calendar, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import { getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import Pagination from '@/app/components/shared/Pagination';
import { useLanguage } from '@/app/context/LanguageContext';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type APLine = {
  purchaseOrderId: string;
  poNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  dueDate: string | null;
  totalOwed: number;
  amountPaid: number;
  outstanding: number;
  daysOverdue: number;
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
};
type APAgingReport = {
  asOf: string;
  dueDateCaveat: string;
  lines: APLine[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number };
  reconciliation: { apLedgerBalance: number; sumOfOutstandingPOs: number; matches: boolean };
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}
// FIX — was dividing the raw signed `amount` (not `abs`) for the two
// smaller-magnitude branches — see ar-aging/page.tsx's identical fix.
function formatIDRCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `${sign}Rp ${(abs / 1_000).toFixed(0)}rb`;
  return formatIDR(amount);
}
// FIX — .toISOString() converts to UTC first, wrong for a ~7-hour window
// after local midnight in a timezone ahead of UTC.
function todayISO() {
  return toCalendarDateString(new Date());
}

const BUCKETS: { key: keyof APAgingReport['totals']; labelKey: string; color: string }[] = [
  { key: 'current', labelKey: 'accounting.arAging.bucketCurrent', color: 'text-gray-700 bg-white border-gray-300' },
  { key: 'd1_30', labelKey: 'accounting.arAging.bucket1_30', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  { key: 'd31_60', labelKey: 'accounting.arAging.bucket31_60', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  { key: 'd61_90', labelKey: 'accounting.arAging.bucket61_90', color: 'text-red-700 bg-red-50 border-red-200' },
  { key: 'd90plus', labelKey: 'accounting.arAging.bucket90plus', color: 'text-red-800 bg-red-100 border-red-300' },
];

const BUCKET_BADGE: Record<APLine['bucket'], string> = {
  current: 'text-gray-600 bg-gray-100 border-gray-200',
  '1-30': 'text-amber-700 bg-amber-50 border-amber-200',
  '31-60': 'text-orange-700 bg-orange-50 border-orange-200',
  '61-90': 'text-red-700 bg-red-50 border-red-200',
  '90+': 'text-red-800 bg-red-100 border-red-300',
};

export default function APAgingPage() {
    const { t, language } = useLanguage();
    const [asOf, setAsOf] = useState(todayISO());
  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', 20));
  const [report, setReport] = useState<APAgingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useSyncQueryParams({
    asOf,
    page: page !== 1 ? page : null,
    pageSize: pageSize !== 20 ? pageSize : null,
  });

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ asOf, page: String(page), pageSize: String(pageSize) });
      const res = await apiFetch(`/accounting/reports/ap-aging?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.apAging.requestFailed', { status: res.status }));
        setReport(null);
        return;
      }
      setReport(await res.json());
    } catch {
      setError(t('accounting.apAging.couldNotReachServer'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  // Merged into one effect (rather than a separate "reset page on asOf
  // change" effect) — see ledger/page.tsx's identical fix for why two
  // effects here means two requests per date change instead of one.
  const filtersKey = asOf;
  const prevFiltersKeyRef = useRef(filtersKey);
  useEffect(() => {
    if (prevFiltersKeyRef.current !== filtersKey) {
      prevFiltersKeyRef.current = filtersKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page, pageSize]);

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <ShoppingCart size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>{t('nav.items.apAging')}</h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.apAging.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-5">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
              <Calendar size={12} strokeWidth={2} />
              {t('accounting.balanceSheet.asOf')}
            </label>
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}
        {loading && <p className="text-sm text-gray-500 mb-4">{t('common.loading')}</p>}

        {!loading && report && (
          <>
            <div
              className={`flex items-center gap-2 text-sm rounded-md p-3 mb-3 border ${
                report.reconciliation.matches ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'
              }`}
            >
              {report.reconciliation.matches ? <CheckCircle2 size={16} strokeWidth={2} className="shrink-0" /> : <AlertTriangle size={16} strokeWidth={2} className="shrink-0" />}
              <span>
                {report.reconciliation.matches
                  ? t('accounting.apAging.reconciledMessage', { amount: formatIDR(report.reconciliation.apLedgerBalance) })
                  : t('accounting.apAging.notReconciledMessage', { ledger: formatIDR(report.reconciliation.apLedgerBalance), sum: formatIDR(report.reconciliation.sumOfOutstandingPOs) })}
              </span>
            </div>

            <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md p-3 mb-5">
              <Info size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
              <span>{report.dueDateCaveat}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
              {BUCKETS.map((b) => (
                <div key={b.key} className={`border rounded-md p-2.5 ${b.color}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{t(b.labelKey)}</p>
                  <p className="text-sm font-bold mt-0.5">
                    <span className="sm:hidden">{formatIDRCompact(report.totals[b.key])}</span>
                    <span className="hidden sm:inline">{formatIDR(report.totals[b.key])}</span>
                  </p>
                </div>
              ))}
            </div>

            {report.lines.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">{t('accounting.apAging.noOutstandingPOs')}</p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {report.lines.map((line) => (
                    <div key={line.purchaseOrderId} className="border-2 border-gray-300 rounded-md bg-white p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate">{line.poNumber ?? line.purchaseOrderId}</span>
                          <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${BUCKET_BADGE[line.bucket]}`}>
                            {line.bucket === 'current' ? t('accounting.arAging.bucketCurrent') : `${line.bucket}d`}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {line.supplierName ?? t('accounting.apAging.noSupplierOnFile')}
                          {line.dueDate && ` · ${t('accounting.expenses.dueOn', { date: new Date(line.dueDate).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' }) })}`}
                        </p>
                      </div>
                      <span className="text-sm font-bold shrink-0">{formatIDR(line.outstanding)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <Pagination
                    page={report.pagination.page}
                    pageSize={report.pagination.pageSize}
                    totalItems={report.pagination.total}
                    onPageChange={setPage}
                    onPageSizeChange={(size) => {
                      setPageSize(size);
                      setPage(1);
                    }}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}