// app/accounting/profit-loss/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Scale, DollarSign, PackageSearch, Percent, Info, Receipt, MapPin } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import DateRangePicker from '@/app/components/shared/DateRangePicker';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type PnlLine = { accountId: string; code: string; name: string; amount: number };

type UnallocatedSection = {
  revenue: PnlLine[];
  operatingExpenses: PnlLine[];
  totalRevenue: number;
  totalOperatingExpenses: number;
  netAmount: number;
};

type ProfitAndLossReport = {
  from: string;
  to: string;
  revenue: PnlLine[];
  totalRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  operatingExpenses: PnlLine[];
  totalOperatingExpenses: number;
  netProfit: number;
  netMargin: number;
  // Only present when a location filter is applied — revenue/expense lines
  // (payroll, expenses with no location picked) that can't be attributed
  // to that location, surfaced separately instead of silently missing.
  unallocated?: UnallocatedSection;
};

type Location = { id: string; name: string };

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

// FIX — .toISOString() converts to UTC first: deterministically
// off-by-one for RANGE_PRESETS below, and time-of-day dependent for
// "today" here, in a timezone ahead of UTC.
function defaultFrom() {
  // Default to month-to-date — the natural default period for a P&L,
  // unlike the trailing-30-days default that fits a rolling sales report.
  const d = new Date();
  d.setDate(1);
  return toCalendarDateString(d);
}
function defaultTo() {
  return toCalendarDateString(new Date());
}

// What DateRangePicker's "All time" preset resolves to — the backend's
// from/to are required, not optional, so a null/null onChange gets
// translated to a fixed wide range rather than sent through as-is.
const ALL_TIME_FROM = '2000-01-01';

export default function ProfitAndLossPage() {
  const { t } = useLanguage();
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);

  const [report, setReport] = useState<ProfitAndLossReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadLocations() {
    try {
      const res = await apiFetch('/locations');
      if (!res.ok) return;
      const data = await res.json();
      setLocations(Array.isArray(data) ? data : []);
    } catch (e) {
      // Non-fatal — the location filter just won't have options.
    }
  }

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (locationId) params.set('locationId', locationId);
      const res = await apiFetch(`/accounting/reports/profit-loss?${params}`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.profitLoss.requestFailed', { status: res.status }));
        setReport(null);
        return;
      }

      setReport(await res.json());
    } catch (e) {
      setError(t('accounting.profitLoss.couldNotReachServer'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLocations();
  }, []);

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, locationId]);

  const hasExpenses = !!report && report.operatingExpenses.length > 0;
  const hasMultipleRevenueLines = !!report && report.revenue.length > 1;

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
              <Scale size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('nav.items.profitLoss')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.profitLoss.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-5 sm:mb-6">
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, t) => {
              setFrom(f ?? ALL_TIME_FROM);
              setTo(t ?? toCalendarDateString(new Date()));
            }}
          />

          <div className="flex flex-col gap-1 min-w-0">
            <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
              <MapPin size={12} strokeWidth={2} />
              {t('accounting.profitLoss.location')}
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm w-full min-w-0 sm:w-auto outline-none focus:border-blue-500 bg-white"
            >
              <option value="">{t('accounting.profitLoss.allLocations')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
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
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-5 sm:mb-6">
              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4 bg-white">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <DollarSign size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">{t('accounting.profitLoss.revenue')}</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.totalRevenue)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.totalRevenue)}</span>
                </p>
              </div>

              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4 bg-white">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <PackageSearch size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">{t('accounting.profitLoss.grossProfitPct', { pct: report.grossMargin.toFixed(1) })}</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.grossProfit)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.grossProfit)}</span>
                </p>
              </div>

              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4 bg-white">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <Receipt size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">{t('accounting.profitLoss.operatingExpenses')}</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.totalOperatingExpenses)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.totalOperatingExpenses)}</span>
                </p>
              </div>

              <div
                className={`border-2 rounded-md p-3 sm:p-4 ${
                  report.netProfit >= 0 ? 'border-black bg-black text-white' : 'border-red-600 bg-red-600 text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-300 mb-1">
                  <Percent size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">{t('accounting.profitLoss.netProfitPct', { pct: report.netMargin.toFixed(1) })}</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.netProfit)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.netProfit)}</span>
                </p>
              </div>
            </div>

            {!hasExpenses && (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3 mb-5 sm:mb-6">
                <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span>
                  {t('accounting.profitLoss.noExpensesWarning')}
                </span>
              </div>
            )}

            {/* Statement layout — a simple line-by-line statement reads better
                here than another card grid; this is the one place on this
                page where the numbers need to visually SUBTRACT from each
                other, not sit side by side. */}
            <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
              <StatementSection title={t('accounting.profitLoss.revenue')}>
                {hasMultipleRevenueLines ? (
                  report.revenue.map((line) => (
                    <StatementRow key={line.accountId} label={`${line.code} ${line.name}`} amount={line.amount} />
                  ))
                ) : (
                  <StatementRow label={t('accounting.profitLoss.salesRevenue')} amount={report.totalRevenue} />
                )}
                <StatementRow label={t('accounting.profitLoss.totalRevenue')} amount={report.totalRevenue} bold />
              </StatementSection>

              <StatementRow label={t('accounting.profitLoss.cogs')} amount={report.cogs} negative muted />
              <StatementRow label={t('accounting.profitLoss.grossProfit')} amount={report.grossProfit} bold divider />

              <StatementSection title={t('accounting.profitLoss.operatingExpenses')}>
                {report.operatingExpenses.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-gray-400">{t('accounting.profitLoss.noExpensesInPeriod')}</p>
                ) : (
                  report.operatingExpenses.map((line) => (
                    <StatementRow
                      key={line.accountId}
                      label={`${line.code} ${line.name}`}
                      amount={line.amount}
                      negative
                    />
                  ))
                )}
                <StatementRow label={t('accounting.profitLoss.totalOperatingExpenses')} amount={report.totalOperatingExpenses} bold negative />
              </StatementSection>

              <div className={`px-4 py-4 flex items-baseline justify-between ${report.netProfit >= 0 ? 'bg-black text-white' : 'bg-red-600 text-white'}`}>
                <span className={`${display.className} font-bold text-sm sm:text-base`}>{t('accounting.profitLoss.netProfit')}</span>
                <span className={`${display.className} font-bold text-base sm:text-lg`}>
                  {formatIDR(report.netProfit)}
                </span>
              </div>
            </div>

            {report.unallocated && (
              <UnallocatedCard section={report.unallocated} t={t} />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function UnallocatedCard({ section, t }: { section: UnallocatedSection; t: (key: string, vars?: Record<string, string | number>) => string }) {
  const hasLines = section.revenue.length > 0 || section.operatingExpenses.length > 0;

  return (
    <div className="border-2 border-dashed border-gray-300 rounded-md bg-gray-50 overflow-hidden mt-4">
      <div className="px-4 pt-3 pb-2 flex items-start gap-2">
        <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5 text-gray-400" />
        <p className="text-xs text-gray-500">
          {t('accounting.profitLoss.unallocatedDescription')}
        </p>
      </div>

      {!hasLines ? (
        <p className="px-4 pb-3 text-xs text-gray-400">{t('accounting.profitLoss.nothingUnallocated')}</p>
      ) : (
        <>
          {section.revenue.length > 0 && (
            <StatementSection title={t('accounting.profitLoss.unallocatedRevenue')}>
              {section.revenue.map((line) => (
                <StatementRow key={line.accountId} label={`${line.code} ${line.name}`} amount={line.amount} />
              ))}
            </StatementSection>
          )}

          {section.operatingExpenses.length > 0 && (
            <StatementSection title={t('accounting.profitLoss.unallocatedExpenses')}>
              {section.operatingExpenses.map((line) => (
                <StatementRow key={line.accountId} label={`${line.code} ${line.name}`} amount={line.amount} negative />
              ))}
            </StatementSection>
          )}

          <div className="px-4 py-3 flex items-baseline justify-between border-t border-gray-200">
            <span className="text-sm font-semibold text-gray-600">{t('accounting.profitLoss.unallocatedNet')}</span>
            <span className="text-sm font-bold text-gray-700">
              {section.netAmount < 0 ? '−' : ''}
              {formatIDR(Math.abs(section.netAmount))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function StatementSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-200 last:border-b-0">
      <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </div>
      {children}
    </div>
  );
}

function StatementRow({
  label,
  amount,
  bold = false,
  negative = false,
  muted = false,
  divider = false,
}: {
  label: string;
  amount: number;
  bold?: boolean;
  negative?: boolean;
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
      <span className={`text-sm shrink-0 ${bold ? 'font-bold' : muted ? 'text-gray-500' : 'text-gray-700'}`}>
        {negative && amount > 0 ? '−' : ''}
        {formatIDR(Math.abs(amount))}
      </span>
    </div>
  );
}