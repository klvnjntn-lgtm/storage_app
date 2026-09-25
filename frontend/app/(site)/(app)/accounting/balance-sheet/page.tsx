// app/accounting/balance-sheet/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Scale, Calendar, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';


type BSLine = { accountId: string; code: string; name: string; amount: number };
type BalanceSheetReport = {
  asOf: string;
  assets: BSLine[];
  totalAssets: number;
  liabilities: BSLine[];
  totalLiabilities: number;
  statedEquity: BSLine[];
  totalStatedEquity: number;
  accumulatedEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}
// FIX — see trial-balance/page.tsx's identical fix: .toISOString() rolls
// the date back one day in a timezone ahead of UTC. "Month-end" always
// landed a day early, silently omitting the last day's postings.
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

export default function BalanceSheetPage() {
    const { t } = useLanguage();
    const [asOf, setAsOf] = useState(todayISO());
  const [report, setReport] = useState<BalanceSheetReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/accounting/reports/balance-sheet?asOf=${asOf}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.balanceSheet.requestFailed', { status: res.status }));
        setReport(null);
        return;
      }
      setReport(await res.json());
    } catch {
      setError(t('accounting.balanceSheet.couldNotReachServer'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf]);

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
              <Scale size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>{t('nav.items.balanceSheet')}</h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.balanceSheet.subtitle')}</p>
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
                  ? t('accounting.balanceSheet.balancedMessage', { amount: formatIDR(report.totalAssets) })
                  : t('accounting.balanceSheet.notBalancedMessage', { assets: formatIDR(report.totalAssets), liabEquity: formatIDR(report.totalLiabilitiesAndEquity) })}
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {/* Assets */}
              <Section title={t('accounting.balanceSheet.assets')}>
                {report.assets.length === 0 ? (
                  <EmptyRow t={t} />
                ) : (
                  report.assets.map((a) => <Row key={a.accountId} code={a.code} name={a.name} amount={a.amount} />)
                )}
                <TotalRow label={t('accounting.balanceSheet.totalAssets')} amount={report.totalAssets} />
              </Section>

              {/* Liabilities */}
              <Section title={t('accounting.balanceSheet.liabilities')}>
                {report.liabilities.length === 0 ? (
                  <EmptyRow t={t} />
                ) : (
                  report.liabilities.map((l) => <Row key={l.accountId} code={l.code} name={l.name} amount={l.amount} />)
                )}
                <TotalRow label={t('accounting.balanceSheet.totalLiabilities')} amount={report.totalLiabilities} />
              </Section>

              {/* Equity */}
              <Section title={t('accounting.balanceSheet.equity')}>
                {report.statedEquity.length === 0 ? (
                  <p className="px-4 py-2 text-xs text-gray-400">{t('accounting.balanceSheet.noStatedEquity')}</p>
                ) : (
                  report.statedEquity.map((e) => <Row key={e.accountId} code={e.code} name={e.name} amount={e.amount} />)
                )}
                <Row code="" name={t('accounting.balanceSheet.accumulatedEarnings')} amount={report.accumulatedEarnings} muted />
                <TotalRow label={t('accounting.balanceSheet.totalEquity')} amount={report.totalEquity} />
              </Section>

              <div className="border-2 border-black rounded-md bg-black text-white px-4 py-4 flex items-baseline justify-between">
                <span className={`${display.className} font-bold text-sm sm:text-base`}>{t('accounting.balanceSheet.totalLiabilitiesAndEquity')}</span>
                <span className={`${display.className} font-bold text-base sm:text-lg`}>{formatIDR(report.totalLiabilitiesAndEquity)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
      <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</div>
      {children}
    </div>
  );
}

function Row({ code, name, amount, muted = false }: { code: string; name: string; amount: number; muted?: boolean }) {
  return (
    <div className="px-4 py-2 flex items-baseline justify-between gap-3">
      <span className={`text-sm truncate ${muted ? 'text-gray-500 italic' : 'text-gray-700'}`}>
        {code && <span className="text-gray-400 font-mono text-xs mr-2">{code}</span>}
        {name}
      </span>
      <span className={`text-sm shrink-0 tabular-nums ${muted ? 'text-gray-500' : 'text-gray-700'}`}>{formatIDR(amount)}</span>
    </div>
  );
}

function TotalRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 border-t border-gray-200 bg-gray-50/60">
      <span className="text-sm font-bold">{label}</span>
      <span className="text-sm font-bold tabular-nums">{formatIDR(amount)}</span>
    </div>
  );
}

function EmptyRow({ t }: { t: (key: string) => string }) {
  return <p className="px-4 py-2 text-xs text-gray-400">{t('accounting.balanceSheet.noAccountsWithActivity')}</p>;
}