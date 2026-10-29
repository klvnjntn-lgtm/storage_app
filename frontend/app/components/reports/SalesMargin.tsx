'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, Info, PackageSearch, Percent, Wallet } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR, formatIDRCompact } from '@/lib/format';
import { getInitialNumberParam, useMergeQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';
import Pagination from '@/app/components/shared/Pagination';

// The Overview and Invoices tabs of Sales Reports: per-invoice revenue,
// cost and margin from GET /invoices/reports — not the accounting P&L.

type InvoiceReportRow = {
  id: string;
  invoiceNumber: string | null;
  issuedAt: string | null;
  gross: number;
  credited: number; // returned value — no longer owed
  cost: number | null; // null for staff — cost is admin-only
  profit: number | null;
  unitsSold: number;
  collected: number;
};

export type RevenueReport = {
  revenue: number; // accrual — full invoiced amount, tax included
  netRevenue: number; // after line discounts, before tax — margin base
  taxAmount: number;
  credited: number; // returned value — no longer owed
  invoiceCount: number;
  // All three null for staff: the backend only sends cost to admins.
  cost: number | null;
  profit: number | null;
  profitCoverage: number | null;
  lineItemCount: number;
  collected: number; // cash actually collected (sum of amountPaid)
  invoices: InvoiceReportRow[];
};

// `enabled` false skips the fetch (the Rankings tab doesn't need it) but
// keeps the last result, so flipping back doesn't flash a reload.
export function useRevenueReport(from: string, to: string, enabled = true) {
  const { t } = useLanguage();
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    const key = `${from}|${to}`;
    if (!enabled || loadedFor.current === key) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await apiFetch(`/invoices/reports?${new URLSearchParams({ from, to })}`);
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.message ?? t('sales.reports.requestFailed', { status: res.status }));
          setReport(null);
          return;
        }
        setReport(await res.json());
        loadedFor.current = key;
      } catch {
        if (!cancelled) {
          setError(t('sales.reports.couldNotReachServer'));
          setReport(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, enabled]);

  return { report, loading, error };
}

function Money({ amount }: { amount: number }) {
  return (
    <>
      <span className="sm:hidden">{formatIDRCompact(amount)}</span>
      <span className="hidden sm:inline">{formatIDR(amount)}</span>
    </>
  );
}

// Revenue, collected, cost and profit for the range, with the caveats
// that keep the numbers honest (missing cost prices, uncollected revenue).
export function MarginSummary({ report }: { report: RevenueReport }) {
  const { t } = useLanguage();

  const { cost, profit, profitCoverage } = report;
  const showCost = cost !== null && profit !== null && profitCoverage !== null;
  // Margin against revenue before tax — tax isn't earned, it's owed on.
  const margin = showCost && report.netRevenue > 0 ? (profit / report.netRevenue) * 100 : 0;
  const hasPartialCoverage = showCost && profitCoverage < report.lineItemCount;
  // Returned goods (credited) are no longer owed, so they count toward
  // neither collected nor outstanding.
  const owed = report.revenue - report.credited;
  const outstanding = Math.max(owed - report.collected, 0);
  const collectionRate = owed > 0 ? (report.collected / owed) * 100 : 0;

  const cards = [
    { icon: DollarSign, label: t('sales.reports.revenue'), amount: report.revenue },
    { icon: Wallet, label: t('sales.reports.paidToDate', { pct: collectionRate.toFixed(0) }), amount: report.collected },
    ...(showCost ? [{ icon: PackageSearch, label: t('sales.reports.costOfGoods'), amount: cost }] : []),
  ];

  return (
    <div>
      {/* 2-up even on the smallest phones so the numbers stay scannable */}
      <div className={`grid grid-cols-2 ${showCost ? 'lg:grid-cols-4' : ''} gap-2.5 sm:gap-3 mb-3`}>
        {cards.map(({ icon: Icon, label, amount }) => (
          <div key={label} className="border-2 border-gray-300 rounded-md p-3 sm:p-4 bg-white">
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-500 mb-1">
              <Icon size={13} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{label}</span>
            </div>
            <p className="text-lg sm:text-2xl font-bold leading-tight">
              <Money amount={amount} />
            </p>
          </div>
        ))}
        {showCost && (
          <div className="border-2 border-black rounded-md p-3 sm:p-4 bg-black text-white">
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-gray-300 mb-1">
              <Percent size={13} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{t('sales.reports.profit', { pct: margin.toFixed(1) })}</span>
            </div>
            <p className="text-lg sm:text-2xl font-bold leading-tight">
              <Money amount={profit} />
            </p>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-2">
        {report.invoiceCount}{' '}
        {t(report.invoiceCount === 1 ? 'sales.reports.issuedInvoiceSingular' : 'sales.reports.issuedInvoicePlural')}
      </p>

      {/* Profit/cost only reflect items with cost data */}
      {hasPartialCoverage && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3 mb-2">
          <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>
            {t('sales.reports.coverageDisclosure', {
              a: profitCoverage,
              b: report.lineItemCount,
              lineItemWord: t(report.lineItemCount === 1 ? 'sales.reports.lineItemSingular' : 'sales.reports.lineItemPlural'),
            })}
          </span>
        </div>
      )}

      {/* Revenue is accrual, not all of it is cash yet */}
      {outstanding > 0 && (
        <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md p-3">
          <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>{t('sales.reports.collectionDisclosure', { amount: formatIDR(outstanding) })}</span>
        </div>
      )}
    </div>
  );
}

// Every invoice in the range, newest first, with its own margin. Stacked
// on mobile so the metrics never get squeezed into unreadable columns.
export function InvoiceMarginList({ report }: { report: RevenueReport }) {
  const router = useRouter();
  const { t, language } = useLanguage();
  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', 20));

  // New range = new result set, so land back on page 1 — but not on
  // mount, or a page restored from the URL would be clobbered.
  const [pageFor, setPageFor] = useState(report);
  if (pageFor !== report) {
    setPageFor(report);
    setPage(1);
  }

  const sortedRows = useMemo(
    () =>
      [...report.invoices].sort((a, b) => new Date(b.issuedAt ?? 0).getTime() - new Date(a.issuedAt ?? 0).getTime()),
    [report],
  );
  // A page past the end (fewer rows, bigger page size) shows the last one.
  const current = Math.min(page, Math.max(1, Math.ceil(sortedRows.length / pageSize)));
  const rows = sortedRows.slice((current - 1) * pageSize, current * pageSize);
  // Seeded from the URL so Back from an invoice returns to the same page.
  useMergeQueryParams({ page: current !== 1 ? current : null, pageSize: pageSize !== 20 ? pageSize : null });

  if (report.invoiceCount === 0) return <p className="text-sm text-gray-400">{t('sales.reports.noInvoices')}</p>;

  const units = (n: number) => `${n} ${t(n === 1 ? 'sales.reports.unitSingular' : 'sales.reports.unitPlural')}`;

  return (
    <>
      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const due = row.gross - row.credited - row.collected;
          const stats: { label: string; amount: number; due?: number; profit?: boolean }[] = [
            { label: t('sales.reports.revenue'), amount: row.gross },
            { label: t('sales.reports.collected'), amount: row.collected, due: due > 0 ? due : 0 },
          ];
          if (row.cost !== null && row.profit !== null) {
            stats.push({ label: t('sales.reports.cost'), amount: row.cost }, { label: t('sales.reports.profitLabel'), amount: row.profit, profit: true });
          }
          return (
            <div
              key={row.id}
              onClick={() => router.push(`/sales/invoices/${row.id}`)}
              className="border-2 border-gray-300 rounded-md p-3 cursor-pointer bg-white hover:border-blue-500/40 hover:bg-blue-50/40 active:bg-blue-100/60 transition-colors"
            >
              <div className="flex items-baseline justify-between gap-2 mb-2 sm:mb-0">
                <span className="font-semibold truncate">{row.invoiceNumber ?? row.id}</span>
                <span className="text-xs text-gray-500 shrink-0">
                  {row.issuedAt
                    ? new Date(row.issuedAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', {
                        day: '2-digit',
                        month: 'short',
                      })
                    : '—'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-2 sm:hidden">{units(row.unitsSold)}</p>

              {/* Mobile: 2x2 stat grid. Desktop: single row, right-aligned. */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:hidden">
                {stats.map((s) => (
                  <div key={s.label}>
                    <p className="text-[11px] text-gray-500">{s.label}</p>
                    <p className={`text-sm font-semibold ${s.profit ? 'text-green-700' : ''}`}>
                      {formatIDRCompact(s.amount)}
                      {!!s.due && (
                        <span className="text-amber-600 font-normal">
                          {' '}
                          · {formatIDRCompact(s.due)} {t('sales.reports.due')}
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>

              <div className="hidden sm:flex items-center justify-between mt-0.5">
                <p className="text-xs text-gray-500">{units(row.unitsSold)}</p>
                <div className="flex items-center gap-4 text-right">
                  {stats.map((s) => (
                    <div key={s.label}>
                      <p className="text-xs text-gray-500">{s.label}</p>
                      <p className={`text-sm font-semibold ${s.profit ? 'text-green-700' : ''}`}>
                        {formatIDR(s.amount)}
                        {!!s.due && (
                          <span className="text-amber-600 font-normal">
                            {' '}
                            · {formatIDR(s.due)} {t('sales.reports.due')}
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <Pagination
          page={current}
          pageSize={pageSize}
          totalItems={sortedRows.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>
    </>
  );
}
