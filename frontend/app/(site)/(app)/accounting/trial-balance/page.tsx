// app/accounting/trial-balance/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Rows3, Calendar, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type TrialBalanceLine = { accountId: string; code: string; name: string; type: string; debit: number; credit: number };
type TrialBalanceReport = {
  asOf: string;
  accounts: TrialBalanceLine[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
};

const TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const TYPE_LABEL_KEY: Record<string, string> = {
  ASSET: 'accounting.setup.typeAssets',
  LIABILITY: 'accounting.setup.typeLiabilities',
  EQUITY: 'accounting.setup.typeEquity',
  REVENUE: 'accounting.setup.typeRevenue',
  EXPENSE: 'accounting.setup.typeExpenses',
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}
// FIX — these all used to build a local-midnight Date then call
// .toISOString().slice(0,10), which converts to UTC first. In a timezone
// ahead of UTC (this app is Indonesian/id-ID) that deterministically
// rolls the date back one day — "Month-end" always landed on the day
// BEFORE the actual month end, silently omitting the last day's postings
// while isBalanced still reported "Balanced" (self-consistent for the
// wrong date). toCalendarDateString formats using local getters instead.
function todayISO() {
  return toCalendarDateString(new Date());
}
function monthEndISO() {
  const d = new Date();
  return toCalendarDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
function yearEndISO() {
  const d = new Date();
  return toCalendarDateString(new Date(d.getFullYear(), 11, 31));
}

export default function TrialBalancePage() {
    const { t } = useLanguage();
    const [asOf, setAsOf] = useState(todayISO());
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/accounting/reports/trial-balance?asOf=${asOf}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.trialBalance.requestFailed', { status: res.status }));
        setReport(null);
        return;
      }
      setReport(await res.json());
    } catch {
      setError(t('accounting.trialBalance.couldNotReachServer'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf]);

  const grouped = useMemo(() => {
    if (!report) return null;
    const map = new Map<string, TrialBalanceLine[]>();
    for (const type of TYPE_ORDER) map.set(type, []);
    for (const acc of report.accounts) map.get(acc.type)?.push(acc);
    return map;
  }, [report]);

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
              <Rows3 size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>{t('nav.items.trialBalance')}</h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.trialBalance.subtitle')}</p>
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
          <div className="flex gap-1.5">
            <button onClick={() => setAsOf(todayISO())} className="text-xs px-3 py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-blue-50 hover:border-blue-500/40 hover:text-blue-700 transition-colors">
              {t('accounting.balanceSheet.today')}
            </button>
            <button onClick={() => setAsOf(monthEndISO())} className="text-xs px-3 py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-blue-50 hover:border-blue-500/40 hover:text-blue-700 transition-colors">
              {t('accounting.balanceSheet.monthEnd')}
            </button>
            <button onClick={() => setAsOf(yearEndISO())} className="text-xs px-3 py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-blue-50 hover:border-blue-500/40 hover:text-blue-700 transition-colors">
              {t('accounting.balanceSheet.yearEnd')}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}
        {loading && <p className="text-sm text-gray-500 mb-4">{t('common.loading')}</p>}

        {!loading && report && (
          <>
            <div
              className={`flex items-center gap-2 text-sm rounded-md p-3 mb-5 border ${
                report.isBalanced ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'
              }`}
            >
              {report.isBalanced ? <CheckCircle2 size={16} strokeWidth={2} className="shrink-0" /> : <AlertTriangle size={16} strokeWidth={2} className="shrink-0" />}
              <span>
                {report.isBalanced
                  ? t('accounting.trialBalance.balancedMessage', { amount: formatIDR(report.totalDebits) })
                  : t('accounting.trialBalance.notBalancedMessage', { debits: formatIDR(report.totalDebits), credits: formatIDR(report.totalCredits) })}
              </span>
            </div>

            <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200 bg-gray-50">
                <span>{t('accounting.journal.accountColumn')}</span>
                <span className="text-right w-28">{t('accounting.journal.debit')}</span>
                <span className="text-right w-28">{t('accounting.journal.credit')}</span>
              </div>

              {TYPE_ORDER.map((type) => {
                const list = grouped?.get(type) ?? [];
                if (list.length === 0) return null;
                return (
                  <div key={type}>
                    <div className="px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/50">
                      {t(TYPE_LABEL_KEY[type])}
                    </div>
                    {list.map((acc) => (
                      <div key={acc.accountId} className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-sm border-b border-gray-50 last:border-b-0">
                        <span className="truncate text-gray-700">
                          <span className="text-gray-400 font-mono text-xs mr-2">{acc.code}</span>
                          {acc.name}
                        </span>
                        <span className="text-right w-28 tabular-nums">{acc.debit > 0 ? formatIDR(acc.debit) : ''}</span>
                        <span className="text-right w-28 tabular-nums">{acc.credit > 0 ? formatIDR(acc.credit) : ''}</span>
                      </div>
                    ))}
                  </div>
                );
              })}

              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 text-sm font-bold border-t-2 border-gray-300 bg-gray-50">
                <span>{t('common.total')}</span>
                <span className="text-right w-28 tabular-nums">{formatIDR(report.totalDebits)}</span>
                <span className="text-right w-28 tabular-nums">{formatIDR(report.totalCredits)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}