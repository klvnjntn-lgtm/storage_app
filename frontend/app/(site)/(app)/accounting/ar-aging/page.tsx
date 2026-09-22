// app/accounting/ar-aging/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Wallet, Calendar, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type ARLine = {
  invoiceId: string;
  invoiceNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  dueDate: string | null;
  total: number;
  amountPaid: number;
  outstanding: number;
  daysOverdue: number;
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
};
type ByCustomer = {
  customerId: string | null;
  customerName: string | null;
  current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number;
};
type ARAgingReport = {
  asOf: string;
  lines: ARLine[];
  byCustomer: ByCustomer[];
  totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number };
  reconciliation: { arLedgerBalance: number; sumOfOutstandingInvoices: number; matches: boolean };
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}
// FIX — was dividing the raw signed `amount` (not `abs`) for the two
// smaller-magnitude branches, so a negative value would have rendered as
// "Rp -1.5jt" instead of "-Rp 1.5jt". Not currently reachable (aging
// outstanding amounts are always >= 0) but inconsistent with the
// correctly-signed version of this same helper in cash-flow/profit-loss.
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

const BUCKETS: { key: keyof ARAgingReport['totals']; labelKey: string; color: string }[] = [
  { key: 'current', labelKey: 'accounting.arAging.bucketCurrent', color: 'text-gray-700 bg-white border-gray-300' },
  { key: 'd1_30', labelKey: 'accounting.arAging.bucket1_30', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  { key: 'd31_60', labelKey: 'accounting.arAging.bucket31_60', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  { key: 'd61_90', labelKey: 'accounting.arAging.bucket61_90', color: 'text-red-700 bg-red-50 border-red-200' },
  { key: 'd90plus', labelKey: 'accounting.arAging.bucket90plus', color: 'text-red-800 bg-red-100 border-red-300' },
];

export default function ARAgingPage() {
    const { t } = useLanguage();
    const [asOf, setAsOf] = useState(todayISO());
  const [report, setReport] = useState<ARAgingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/accounting/reports/ar-aging?asOf=${asOf}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.arAging.requestFailed', { status: res.status }));
        setReport(null);
        return;
      }
      setReport(await res.json());
    } catch {
      setError(t('accounting.arAging.couldNotReachServer'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf]);

  const linesByCustomer = useMemo(() => {
    const map = new Map<string, ARLine[]>();
    for (const line of report?.lines ?? []) {
      // FIX — was falling back to `line.invoiceId`, which is unique per
      // line, while customerKey() below (used for the summary/totals
      // rows) falls back to a shared '' for the same "no customer, no
      // name" case. The two never matched, so expanding the "No
      // customer on file" summary row always showed an empty list
      // despite a nonzero total. Match customerKey()'s fallback exactly
      // so every unlinked invoice buckets into the same group.
      const key = line.customerId ?? `unlinked:${line.customerName ?? ''}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(line);
    }
    return map;
  }, [report]);

  function customerKey(c: ByCustomer) {
    return c.customerId ?? `unlinked:${c.customerName ?? ''}`;
  }

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
              <Wallet size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>{t('nav.items.arAging')}</h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.arAging.subtitle')}</p>
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
              className={`flex items-center gap-2 text-sm rounded-md p-3 mb-5 border ${
                report.reconciliation.matches ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'
              }`}
            >
              {report.reconciliation.matches ? <CheckCircle2 size={16} strokeWidth={2} className="shrink-0" /> : <AlertTriangle size={16} strokeWidth={2} className="shrink-0" />}
              <span>
                {report.reconciliation.matches
                  ? t('accounting.arAging.reconciledMessage', { amount: formatIDR(report.reconciliation.arLedgerBalance) })
                  : t('accounting.arAging.notReconciledMessage', { ledger: formatIDR(report.reconciliation.arLedgerBalance), sum: formatIDR(report.reconciliation.sumOfOutstandingInvoices) })}
              </span>
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

            {report.byCustomer.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">{t('accounting.arAging.noOutstandingInvoices')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {report.byCustomer.map((c) => {
                  const key = customerKey(c);
                  const isExpanded = expandedCustomer === key;
                  const invoices = linesByCustomer.get(key) ?? [];
                  return (
                    <div key={key} className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
                      <button
                        onClick={() => setExpandedCustomer(isExpanded ? null : key)}
                        className="w-full flex items-center justify-between gap-3 p-3 hover:bg-gray-50 transition-colors"
                      >
                        <span className="text-sm font-semibold truncate">{c.customerName ?? t('accounting.arAging.noCustomerOnFile')}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-bold">{formatIDR(c.total)}</span>
                          {isExpanded ? <ChevronUp size={15} strokeWidth={2} className="text-gray-400" /> : <ChevronDown size={15} strokeWidth={2} className="text-gray-400" />}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-gray-100">
                          {invoices.map((line) => (
                            <div key={line.invoiceId} className="px-3 py-2 flex items-center justify-between gap-3 text-xs border-b border-gray-50 last:border-b-0">
                              <div className="min-w-0">
                                <span className="font-medium">{line.invoiceNumber ?? line.invoiceId}</span>
                                <span className="text-gray-400 ml-2">
                                  {line.daysOverdue > 0 ? t('accounting.arAging.daysOverdue', { days: line.daysOverdue }) : t('accounting.arAging.notYetDue')}
                                </span>
                              </div>
                              <span className="font-semibold shrink-0">{formatIDR(line.outstanding)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}