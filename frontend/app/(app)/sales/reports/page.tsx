// app/reports/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  TrendingUp,
  Calendar,
  DollarSign,
  PackageSearch,
  Percent,
  Info,
  Wallet,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

type InvoiceReportRow = {
  id: string;
  invoiceNumber: string | null;
  issuedAt: string | null;
  gross: number;
  cost: number;
  profit: number;
  unitsSold: number;
  collected: number;
};

type RevenueReport = {
  revenue: number; // accrual — full invoiced amount
  invoiceCount: number;
  cost: number;
  profit: number;
  profitCoverage: number;
  lineItemCount: number;
  collected: number; // cash actually collected (sum of amountPaid)
  invoices: InvoiceReportRow[];
};

const PAGE_SIZE = 20;

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Shorter form for tight mobile cards — e.g. Rp 1,2jt instead of Rp 1.200.000
function formatIDRCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}rb`;
  return formatIDR(amount);
}

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

const RANGE_PRESETS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
] as const;

export default function ReportsPage() {
  const router = useRouter();

  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());

  const [report, setReport] = useState<RevenueReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await apiFetch(`/invoices/reports?${params}`);

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

  // New range = new result set, so always land back on page 1.
  useEffect(() => {
    setPage(1);
  }, [from, to]);

  function applyPreset(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setTo(end.toISOString().slice(0, 10));
    setFrom(start.toISOString().slice(0, 10));
  }

  const margin = report && report.revenue > 0 ? (report.profit / report.revenue) * 100 : 0;
  const hasPartialCoverage = !!report && report.profitCoverage < report.lineItemCount;

  // Cash actually collected vs still outstanding — both derived from
  // report.collected, which the backend aggregates from each invoice's
  // amountPaid.
  const outstanding = report ? Math.max(report.revenue - report.collected, 0) : 0;
  const collectionRate = report && report.revenue > 0 ? (report.collected / report.revenue) * 100 : 0;

  const sortedRows = useMemo(() => {
    if (!report) return [];
    return [...report.invoices].sort((a, b) => {
      const at = new Date(a.issuedAt ?? 0).getTime();
      const bt = new Date(b.issuedAt ?? 0).getTime();
      return bt - at;
    });
  }, [report]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, page]);

  return (
    <main className="min-h-screen bg-white text-black">
      {/* Header — sticky on mobile so filters stay reachable while scrolling */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex items-center gap-2">
            <TrendingUp size={20} strokeWidth={2} className="text-gray-700 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold truncate">Sales Report</h1>
              <p className="text-xs text-gray-500 truncate">Revenue, cost, and profit for issued invoices</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Filters —
            The old layout put From + To in a plain `flex` row with `flex-1`
            children. Flex items default to `min-width: auto`, so native date
            inputs refuse to shrink below their intrinsic rendered width and
            end up overlapping/clipping on narrow phones.
            Fix: use a `grid grid-cols-2` for the date pair so each one gets
            an exact, equal share of the row width, and add `min-w-0` so the
            input itself is allowed to shrink to fit that share. */}
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
                className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm w-full min-w-0 sm:w-auto"
              />
            </div>

            <div className="flex flex-col gap-1 min-w-0 sm:flex-none">
              <label className="text-xs font-semibold text-gray-600">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm w-full min-w-0 sm:w-auto"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 sm:flex gap-1.5">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.days)}
                className="text-xs px-3 py-2.5 sm:py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-gray-50 active:bg-gray-100"
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
            {/* Summary cards — 2-up grid even on the smallest phones so the numbers stay scannable at a glance */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-3">
              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <DollarSign size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">Revenue</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.revenue)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.revenue)}</span>
                </p>
              </div>

              {/* Paid to date — was corrupted with a stray non-JSX "//" line
                  comment (rendered as literal visible text) and a duplicate
                  copy of the "Collection disclosure" banner that already
                  appears, correctly, full-width below this grid. Restored
                  to the same plain stat-card shape as its siblings. */}
              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <Wallet size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">Paid to date ({collectionRate.toFixed(0)}%)</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.collected)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.collected)}</span>
                </p>
              </div>

              <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
                  <PackageSearch size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">Cost of Goods</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.cost)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.cost)}</span>
                </p>
              </div>

              <div className="border-2 border-black rounded-md p-3 sm:p-4 bg-black text-white">
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-300 mb-1">
                  <Percent size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">Profit ({margin.toFixed(1)}%)</span>
                </div>
                <p className="text-lg sm:text-2xl font-bold leading-tight">
                  <span className="sm:hidden">{formatIDRCompact(report.profit)}</span>
                  <span className="hidden sm:inline">{formatIDR(report.profit)}</span>
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-500 mb-2">
              {report.invoiceCount} issued invoice{report.invoiceCount === 1 ? '' : 's'}
            </p>

            {/* Coverage disclosure — profit/cost only reflect items with cost data */}
            {hasPartialCoverage && (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3 mb-2">
                <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span>
                  Cost and profit are based on {report.profitCoverage} of {report.lineItemCount} sold
                  line item{report.lineItemCount === 1 ? '' : 's'} — the rest had no cost price set at
                  the time of sale. Revenue is complete; profit (overall and per invoice below) is a floor,
                  not the true number.
                </span>
              </div>
            )}

            {/* Collection disclosure — revenue is accrual, not all of it is cash yet */}
            {outstanding > 0 && (
              <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md p-3 mb-4">
                <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span>
                  Revenue above is invoiced (accrual) value. {formatIDR(outstanding)} of it hasn't been
                  collected yet across unpaid or partially paid invoices.
                </span>
              </div>
            )}

            {/* Per-invoice breakdown — stacked layout on mobile so metrics never
                get squeezed into unreadable columns; grid of 4 stats under the header row */}
            {report.invoiceCount === 0 ? (
              <p className="text-sm text-gray-400">No issued invoices in this range.</p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {paginatedRows.map((row) => (
                    <div
                      key={row.id}
                      onClick={() => router.push(`/sales/invoices/${row.id}`)}
                      className="border-2 border-gray-300 rounded-md p-3 cursor-pointer hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-baseline justify-between gap-2 mb-2 sm:mb-0">
                        <span className="font-semibold truncate">{row.invoiceNumber ?? row.id}</span>
                        <span className="text-xs text-gray-500 shrink-0">
                          {row.issuedAt
                            ? new Date(row.issuedAt).toLocaleDateString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                              })
                            : '—'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2 sm:hidden">
                        {row.unitsSold} unit{row.unitsSold === 1 ? '' : 's'}
                      </p>

                      {/* Mobile: 2x2 stat grid. Desktop: single row, right-aligned. */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:hidden">
                        <div>
                          <p className="text-[11px] text-gray-500">Revenue</p>
                          <p className="text-sm font-semibold">{formatIDRCompact(row.gross)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-gray-500">Collected</p>
                          <p className="text-sm font-semibold">
                            {formatIDRCompact(row.collected)}
                            {row.collected < row.gross && (
                              <span className="text-amber-600 font-normal">
                                {' '}
                                · {formatIDRCompact(row.gross - row.collected)} due
                              </span>
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-gray-500">Cost</p>
                          <p className="text-sm font-semibold">{formatIDRCompact(row.cost)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-gray-500">Profit</p>
                          <p className="text-sm font-semibold text-green-700">{formatIDRCompact(row.profit)}</p>
                        </div>
                      </div>

                      <div className="hidden sm:flex items-center justify-between mt-0.5">
                        <p className="text-xs text-gray-500">
                          {row.unitsSold} unit{row.unitsSold === 1 ? '' : 's'}
                        </p>
                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <p className="text-xs text-gray-500">Revenue</p>
                            <p className="text-sm font-semibold">{formatIDR(row.gross)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">Collected</p>
                            <p className="text-sm font-semibold">
                              {formatIDR(row.collected)}
                              {row.collected < row.gross && (
                                <span className="text-amber-600 font-normal">
                                  {' '}
                                  · {formatIDR(row.gross - row.collected)} due
                                </span>
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">Cost</p>
                            <p className="text-sm font-semibold">{formatIDR(row.cost)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">Profit</p>
                            <p className="text-sm font-semibold text-green-700">{formatIDR(row.profit)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4 text-sm">
                  <span className="text-gray-500">
                    Showing {(page - 1) * PAGE_SIZE + 1}–
                    {Math.min(page * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                    >
                      Prev
                    </button>
                    <span className="text-gray-600">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}