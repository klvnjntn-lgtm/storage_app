// app/accounting/cash-flow/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Banknote, Calendar, ArrowDownToLine, ArrowUpFromLine, Info, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type CashFlowItem = { key: string; label: string; inflow: number; outflow: number; net: number };
type CashFlowSectionTotals = { items: CashFlowItem[]; inflow: number; outflow: number; net: number };
type CashFlowAccountLine = { accountId: string; code: string; name: string; opening: number; netChange: number; closing: number };

type CashFlowReport = {
  from: string;
  to: string;
  openingCash: number;
  operating: CashFlowSectionTotals;
  investing: CashFlowSectionTotals;
  financing: CashFlowSectionTotals;
  netChange: number;
  closingCash: number;
  accounts: CashFlowAccountLine[];
  reconciliation: { ledgerClosingCash: number; computedClosingCash: number; matches: boolean };
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatIDRCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `${sign}Rp ${(abs / 1_000).toFixed(0)}rb`;
  return formatIDR(amount);
}

// FIX — .toISOString() converts to UTC first, which is both
// deterministically off-by-one (RANGE_PRESETS below) and time-of-day
// dependent for "today" (defaultTo/defaultFrom) in a timezone ahead of
// UTC. Worse than a display bug here: these are the actual default
// values that get submitted, not just shown.
function defaultFrom() {
  const d = new Date();
  d.setDate(1);
  return toCalendarDateString(d);
}
function defaultTo() {
  return toCalendarDateString(new Date());
}

const RANGE_PRESETS = [
  { labelKey: 'accounting.profitLoss.thisMonth', fn: () => {
    const d = new Date();
    return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: d };
  }},
  { labelKey: 'accounting.profitLoss.lastMonth', fn: () => {
    const d = new Date();
    return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1), to: new Date(d.getFullYear(), d.getMonth(), 0) };
  }},
  { labelKey: 'accounting.profitLoss.thisYear', fn: () => {
    const d = new Date();
    return { from: new Date(d.getFullYear(), 0, 1), to: d };
  }},
] as const;

function toISODate(d: Date) {
  return toCalendarDateString(d);
}

export default function CashFlowPage() {
  const { t } = useLanguage();
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());

  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await apiFetch(`/accounting/reports/cash-flow?${params}`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.cashFlow.requestFailed', { status: res.status }));
        setReport(null);
        return;
      }

      setReport(await res.json());
    } catch {
      setError(t('accounting.cashFlow.couldNotReachServer'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  function applyPreset(fn: () => { from: Date; to: Date }) {
    const { from: f, to: t } = fn();
    setFrom(toISODate(f));
    setTo(toISODate(t));
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
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Banknote size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('nav.items.cashFlow')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.cashFlow.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-5 sm:mb-6">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
            <div className="flex flex-col gap-1 min-w-0 sm:flex-none">
              <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                <Calendar size={12} strokeWidth={2} />
                {t('accounting.journal.from')}
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm w-full min-w-0 sm:w-auto outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-col gap-1 min-w-0 sm:flex-none">
              <label className="text-xs font-semibold text-gray-600">{t('accounting.journal.to')}</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm w-full min-w-0 sm:w-auto outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 sm:flex gap-1.5">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.labelKey}
                onClick={() => applyPreset(p.fn)}
                className="text-xs px-3 py-2.5 sm:py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-blue-50 hover:border-blue-500/40 hover:text-blue-700 active:bg-blue-100 transition-colors"
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-gray-500 mb-4">{t('accounting.profitLoss.crunchingNumbers')}</p>}

        {!loading && !error && report && (
          <>
            {!report.reconciliation.matches && (
              <div className="flex items-start gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md p-3 mb-5">
                <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span>
                  {t('accounting.cashFlow.reconciliationWarning', {
                    computed: formatIDR(report.reconciliation.computedClosingCash),
                    ledger: formatIDR(report.reconciliation.ledgerClosingCash),
                  })}
                </span>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-5 sm:mb-6">
              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4 bg-white">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <span className="truncate">{t('accounting.cashFlow.openingCash')}</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.openingCash)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.openingCash)}</span>
                </p>
              </div>

              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4 bg-white">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <ArrowDownToLine size={13} strokeWidth={2} className="shrink-0 text-green-600" />
                  <span className="truncate">{t('accounting.cashFlow.cashIn')}</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight text-green-700">
                  <span className="sm:hidden">{formatIDRCompact(report.operating.inflow + report.investing.inflow + report.financing.inflow)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.operating.inflow + report.investing.inflow + report.financing.inflow)}</span>
                </p>
              </div>

              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4 bg-white">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <ArrowUpFromLine size={13} strokeWidth={2} className="shrink-0 text-red-600" />
                  <span className="truncate">{t('accounting.cashFlow.cashOut')}</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight text-red-700">
                  <span className="sm:hidden">{formatIDRCompact(report.operating.outflow + report.investing.outflow + report.financing.outflow)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.operating.outflow + report.investing.outflow + report.financing.outflow)}</span>
                </p>
              </div>

              <div
                className={`border-2 rounded-md p-3 sm:p-4 ${
                  report.closingCash >= 0 ? 'border-black bg-black text-white' : 'border-red-600 bg-red-600 text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-300 mb-1">
                  <span className="truncate">{t('accounting.cashFlow.closingCash')}</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.closingCash)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.closingCash)}</span>
                </p>
              </div>
            </div>

            {/* Statement layout */}
            <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden mb-4">
              <StatementRow label={t('accounting.cashFlow.openingCash')} amount={report.openingCash} bold />

              <CashFlowSection title={t('accounting.cashFlow.operatingActivities')} section={report.operating} emptyNote={t('accounting.cashFlow.noOperatingActivity')} netLabel={t('accounting.cashFlow.netCashFrom', { title: t('accounting.cashFlow.operatingActivities') })} />
              <CashFlowSection title={t('accounting.cashFlow.investingActivities')} section={report.investing} emptyNote={t('accounting.cashFlow.noInvestingActivity')} netLabel={t('accounting.cashFlow.netCashFrom', { title: t('accounting.cashFlow.investingActivities') })} />
              <CashFlowSection title={t('accounting.cashFlow.financingActivities')} section={report.financing} emptyNote={t('accounting.cashFlow.noFinancingActivity')} netLabel={t('accounting.cashFlow.netCashFrom', { title: t('accounting.cashFlow.financingActivities') })} />

              <StatementRow label={t('accounting.cashFlow.netChangeInCash')} amount={report.netChange} bold divider />
              <div className="px-4 py-4 flex items-baseline justify-between bg-black text-white">
                <span className={`${display.className} font-bold text-sm sm:text-base`}>{t('accounting.cashFlow.closingCash')}</span>
                <span className={`${display.className} font-bold text-base sm:text-lg`}>
                  {formatIDR(report.closingCash)}
                </span>
              </div>
            </div>

            {/* Per-account breakdown */}
            {report.accounts.length > 0 && (
              <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden mb-4">
                <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {t('accounting.cashFlow.cashAndBankAccounts')}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-gray-400 uppercase tracking-wide">
                        <th className="text-left font-semibold px-4 py-2">{t('accounting.journal.accountColumn')}</th>
                        <th className="text-right font-semibold px-4 py-2">{t('accounting.cashFlow.opening')}</th>
                        <th className="text-right font-semibold px-4 py-2">{t('accounting.cashFlow.change')}</th>
                        <th className="text-right font-semibold px-4 py-2">{t('accounting.cashFlow.closing')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.accounts.map((a) => (
                        <tr key={a.accountId} className="border-t border-gray-100">
                          <td className="px-4 py-2 text-gray-700">{a.code} {a.name}</td>
                          <td className="px-4 py-2 text-right text-gray-500">{formatIDR(a.opening)}</td>
                          <td className={`px-4 py-2 text-right ${a.netChange < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                            {a.netChange < 0 ? '−' : ''}{formatIDR(Math.abs(a.netChange))}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-gray-800">{formatIDR(a.closing)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-3">
              <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
              <span>
                {t('accounting.cashFlow.footerNote')}
              </span>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function CashFlowSection({
  title,
  section,
  emptyNote,
  netLabel,
}: {
  title: string;
  section: CashFlowSectionTotals;
  emptyNote: string;
  netLabel: string;
}) {
  return (
    <div className="border-b border-gray-200">
      <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </div>
      {section.items.length === 0 ? (
        <p className="px-4 py-2.5 text-xs text-gray-400">{emptyNote}</p>
      ) : (
        section.items.map((item) => (
          <StatementRow key={item.key} label={item.label} amount={item.net} />
        ))
      )}
      <StatementRow label={netLabel} amount={section.net} bold muted />
    </div>
  );
}

function StatementRow({
  label,
  amount,
  bold = false,
  muted = false,
  divider = false,
}: {
  label: string;
  amount: number;
  bold?: boolean;
  muted?: boolean;
  divider?: boolean;
}) {
  return (
    <div
      className={`px-4 py-2.5 flex items-baseline justify-between gap-3 ${
        bold ? 'border-t border-gray-200' : ''
      } ${divider ? 'border-b border-gray-200' : ''}`}
    >
      <span className={`text-sm truncate ${bold ? 'font-semibold' : muted ? 'text-gray-500' : 'text-gray-700'}`}>
        {label}
      </span>
      <span className={`text-sm shrink-0 ${bold ? 'font-bold' : muted ? 'text-gray-500' : 'text-gray-700'} ${amount < 0 ? 'text-red-600' : ''}`}>
        {amount < 0 ? '−' : ''}
        {formatIDR(Math.abs(amount))}
      </span>
    </div>
  );
}
