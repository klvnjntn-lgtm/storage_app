// app/accounting/profit-loss/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import {
  ArrowLeft,
  Scale,
  Calendar,
  DollarSign,
  PackageSearch,
  Percent,
  Info,
  Receipt,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type PnlLine = { accountId: string; code: string; name: string; amount: number };

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

function defaultFrom() {
  // Default to month-to-date — the natural default period for a P&L,
  // unlike the trailing-30-days default that fits a rolling sales report.
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

const RANGE_PRESETS = [
  { label: 'This month', fn: () => {
    const d = new Date();
    return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: d };
  }},
  { label: 'Last month', fn: () => {
    const d = new Date();
    return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1), to: new Date(d.getFullYear(), d.getMonth(), 0) };
  }},
  { label: 'This year', fn: () => {
    const d = new Date();
    return { from: new Date(d.getFullYear(), 0, 1), to: d };
  }},
] as const;

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function ProfitAndLossPage() {
  const router = useRouter();

  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());

  const [report, setReport] = useState<ProfitAndLossReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await apiFetch(`/accounting/reports/profit-loss?${params}`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        setReport(null);
        return;
      }

      setReport(await res.json());
    } catch (e) {
      setError('Could not reach the server.');
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
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Scale size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                Profit &amp; Loss
              </h1>
              <p className="text-xs text-gray-500 truncate">Revenue, cost, and every posted expense — from the ledger</p>
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
                From
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm w-full min-w-0 sm:w-auto outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-col gap-1 min-w-0 sm:flex-none">
              <label className="text-xs font-semibold text-gray-600">To</label>
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
                key={p.label}
                onClick={() => applyPreset(p.fn)}
                className="text-xs px-3 py-2.5 sm:py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-blue-50 hover:border-blue-500/40 hover:text-blue-700 active:bg-blue-100 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-gray-500 mb-4">Crunching numbers...</p>}

        {!loading && !error && report && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-5 sm:mb-6">
              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4 bg-white">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <DollarSign size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">Revenue</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.totalRevenue)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.totalRevenue)}</span>
                </p>
              </div>

              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4 bg-white">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <PackageSearch size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">Gross Profit ({report.grossMargin.toFixed(1)}%)</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.grossProfit)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.grossProfit)}</span>
                </p>
              </div>

              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4 bg-white">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <Receipt size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">Operating Expenses</span>
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
                  <span className="truncate">Net Profit ({report.netMargin.toFixed(1)}%)</span>
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
                  No operating expenses were posted to the ledger in this period — Net Profit currently
                  equals Gross Profit. If you've recorded rent, electricity, or payroll for this period,
                  check that those documents have actually been posted (e.g. an Expense stuck at "recorded"
                  but never marked paid still posts as a liability, so it should already show here — an
                  Expense never saved at all won't).
                </span>
              </div>
            )}

            {/* Statement layout — a simple line-by-line statement reads better
                here than another card grid; this is the one place on this
                page where the numbers need to visually SUBTRACT from each
                other, not sit side by side. */}
            <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
              <StatementSection title="Revenue">
                {hasMultipleRevenueLines ? (
                  report.revenue.map((line) => (
                    <StatementRow key={line.accountId} label={`${line.code} ${line.name}`} amount={line.amount} />
                  ))
                ) : (
                  <StatementRow label="Sales Revenue" amount={report.totalRevenue} />
                )}
                <StatementRow label="Total Revenue" amount={report.totalRevenue} bold />
              </StatementSection>

              <StatementRow label="Cost of Goods Sold" amount={report.cogs} negative muted />
              <StatementRow label="Gross Profit" amount={report.grossProfit} bold divider />

              <StatementSection title="Operating Expenses">
                {report.operatingExpenses.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-gray-400">No operating expenses posted in this period.</p>
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
                <StatementRow label="Total Operating Expenses" amount={report.totalOperatingExpenses} bold negative />
              </StatementSection>

              <div className={`px-4 py-4 flex items-baseline justify-between ${report.netProfit >= 0 ? 'bg-black text-white' : 'bg-red-600 text-white'}`}>
                <span className={`${display.className} font-bold text-sm sm:text-base`}>Net Profit</span>
                <span className={`${display.className} font-bold text-base sm:text-lg`}>
                  {formatIDR(report.netProfit)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
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