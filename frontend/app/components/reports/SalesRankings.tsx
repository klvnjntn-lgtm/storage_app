'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Car, PackageSearch, Search, Users, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR, formatIDRCompact } from '@/lib/format';
import { useMergeQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';
import { useHasModule } from '@/lib/hooks/useHasModule';
import TopCustomersBarChart from '@/app/components/reports/TopCustomersBarChart';
import TopItemsPieChart from '@/app/components/reports/TopItemsPieChart';
import TopVehiclesBarChart from '@/app/components/reports/TopVehiclesBarChart';
import type { TopReport } from '@/app/components/reports/types';
import { CARD, EmptyState, Highlight, Panel } from '@/app/components/reports/InsightBlocks';

// The Rankings tab of Sales Reports (top customers, items and vehicles
// from GET /invoices/reports/top), plus the top-five preview on Overview.
// Both use the console tokens, so they sit inside `console insights`.

const FULL_REPORT_LIMIT = 10;
const PREVIEW_LIMIT = 5;

type VehicleSearchResult = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  customerName: string;
};

function useTopReport(from: string, to: string, limit: number, vehicleId?: string) {
  const { t } = useLanguage();
  const key = `${from}|${to}|${limit}|${vehicleId ?? ''}`;
  // Tagged with the request it answers; loading is "the answer isn't for
  // the current request yet".
  const [result, setResult] = useState<{ key: string; report: TopReport | null; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams({ from, to, limit: String(limit) });
      if (vehicleId) params.set('vehicleId', vehicleId);
      let next: { report: TopReport | null; error: string | null };
      try {
        const res = await apiFetch(`/invoices/reports/top?${params}`);
        if (res.ok) next = { report: await res.json(), error: null };
        else {
          const body = await res.json().catch(() => null);
          next = { report: null, error: body?.message ?? t('accounting.salesInsights.requestFailed', { status: res.status }) };
        }
      } catch {
        next = { report: null, error: t('accounting.salesInsights.couldNotReachServer') };
      }
      if (!cancelled) setResult({ key, ...next });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = result?.key !== key;
  return { report: result?.report ?? null, loading, error: loading ? null : (result?.error ?? null) };
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p role="alert" className="text-sm text-(--c-red) bg-(--c-red)/10 border border-(--c-red)/30 rounded-xl p-3">
      {text}
    </p>
  );
}

// The #1 customer, item and (workshops) vehicle, in plain words.
function Highlights({ report }: { report: TopReport }) {
  const { t } = useLanguage();
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');
  const topCustomer = report.topCustomers[0];
  const topItem = report.topProducts[0];
  const topVehicle = report.topVehicles[0];
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 ${hasWorkshopRms ? 'lg:grid-cols-3' : ''} gap-3`}>
      <Highlight
        icon={Users}
        tone="sky"
        label={t('accounting.salesInsights.bestCustomer')}
        name={topCustomer?.name}
        value={topCustomer ? formatIDR(topCustomer.revenue) : null}
        detail={topCustomer ? t('accounting.salesInsights.invoicesCount', { n: topCustomer.invoiceCount }) : null}
        empty={t('accounting.salesInsights.noDataShort')}
      />
      <Highlight
        icon={PackageSearch}
        tone="emerald"
        label={t('accounting.salesInsights.bestItem')}
        name={topItem?.name}
        value={topItem ? formatIDR(topItem.revenue) : null}
        detail={topItem ? t('accounting.salesInsights.unitsSold', { n: topItem.unitsSold }) : null}
        empty={t('accounting.salesInsights.noDataShort')}
      />
      {hasWorkshopRms && (
        <Highlight
          icon={Car}
          tone="amber"
          label={t('accounting.salesInsights.bestVehicle')}
          name={topVehicle ? `${topVehicle.plateNumber} · ${topVehicle.vehicleModel}` : undefined}
          value={topVehicle ? formatIDR(topVehicle.revenue) : null}
          detail={topVehicle ? t('accounting.salesInsights.visitsCount', { n: topVehicle.visitCount }) : null}
          empty={t('accounting.salesInsights.noDataShort')}
        />
      )}
    </div>
  );
}

// Overview's "who and what sold": the top five customers and items as
// ranked lists, no charts — the Rankings tab has those.
export function TopSellersPreview({ from, to, onSeeAll }: { from: string; to: string; onSeeAll: () => void }) {
  const { t } = useLanguage();
  const { report, loading, error } = useTopReport(from, to, PREVIEW_LIMIT);

  const seeAll = (
    <button
      type="button"
      onClick={onSeeAll}
      className="flex items-center gap-1 text-xs font-semibold text-(--c-sky) hover:underline cursor-pointer"
    >
      {t('salesReports.seeAllRankings')}
      <ArrowRight size={12} aria-hidden />
    </button>
  );

  return (
    <div className="console insights text-(--c-text) space-y-4">
      {error && <ErrorNote text={error} />}
      {loading && !report && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-busy="true">
          <div className={`${CARD} h-64 motion-safe:animate-pulse`} />
          <div className={`${CARD} h-64 motion-safe:animate-pulse`} />
        </div>
      )}
      {report && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel icon={Users} title={t('accounting.salesInsights.topCustomers')} subtitle={t('accounting.salesInsights.topCustomersSubtitle')} actions={seeAll}>
            {report.topCustomers.length === 0 ? (
              <EmptyState text={t('accounting.salesInsights.noData')} />
            ) : (
              <RankList
                flush
                rows={report.topCustomers.map((c) => ({
                  key: c.customerId,
                  name: c.name,
                  revenue: c.revenue,
                  detail: t('accounting.salesInsights.invoicesCount', { n: c.invoiceCount }),
                }))}
              />
            )}
          </Panel>
          <Panel icon={PackageSearch} title={t('accounting.salesInsights.topItems')} subtitle={t('accounting.salesInsights.topItemsSubtitle')} actions={seeAll}>
            {report.topProducts.length === 0 ? (
              <EmptyState text={t('accounting.salesInsights.noData')} />
            ) : (
              <RankList
                flush
                rows={report.topProducts.map((p) => ({
                  key: p.productId,
                  name: p.name,
                  revenue: p.revenue,
                  detail: `${p.unitsSold} ${t('accounting.salesInsights.units')}`,
                }))}
              />
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

export function SalesRankings({ from, to }: { from: string; to: string }) {
  const { t } = useLanguage();
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');

  // Vehicle scope — WORKSHOP_RMS orgs only. Narrows Top Customers/Items
  // down to invoices for one car; Top Vehicles stays unscoped (see
  // InvoiceService.getTopReport's comment on why).
  const [vehicleQuery, setVehicleQuery] = useState('');
  // Results tagged with the query they answer, so "searching" and a
  // cleared box need no state of their own.
  const [vehicleHits, setVehicleHits] = useState<{ q: string; rows: VehicleSearchResult[] }>({ q: '', rows: [] });
  const trimmedQuery = vehicleQuery.trim();
  const vehicleSearching = !!trimmedQuery && vehicleHits.q !== trimmedQuery;
  const vehicleResults = trimmedQuery && !vehicleSearching ? vehicleHits.rows : [];
  const [showVehicleResults, setShowVehicleResults] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleSearchResult | null>(null);
  const vehicleBoxRef = useRef<HTMLDivElement>(null);

  const { report, loading, error } = useTopReport(from, to, FULL_REPORT_LIMIT, selectedVehicle?.id);
  useMergeQueryParams({ vehicleId: selectedVehicle?.id ?? null });

  useEffect(() => {
    if (!hasWorkshopRms || !trimmedQuery) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      let rows: VehicleSearchResult[] = [];
      try {
        const res = await apiFetch(`/vehicles/search?${new URLSearchParams({ q: trimmedQuery })}`);
        if (res.ok) rows = await res.json();
      } catch {
        // shows as "no vehicles found"
      }
      if (!cancelled) setVehicleHits({ q: trimmedQuery, rows });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [trimmedQuery, hasWorkshopRms]);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (vehicleBoxRef.current && !vehicleBoxRef.current.contains(e.target as Node)) setShowVehicleResults(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  function pickVehicle(v: VehicleSearchResult) {
    setSelectedVehicle(v);
    setVehicleQuery('');
    setShowVehicleResults(false);
  }

  return (
    <div className="console insights text-(--c-text) space-y-4 sm:space-y-5">
      {/* Vehicle scope — WORKSHOP_RMS only; the date range is the page's */}
      {hasWorkshopRms && (
        <section className={`${CARD} p-4 sm:p-5 relative z-[5]`}>
          <label htmlFor="insights-vehicle" className="text-xs font-semibold text-(--c-muted) mb-1.5 flex items-center gap-1">
            <Car size={12} strokeWidth={2} aria-hidden />
            {t('accounting.salesInsights.vehicleFilter')}
          </label>

          {selectedVehicle ? (
            <div className="flex items-center justify-between rounded-xl border border-(--c-sky)/40 bg-(--c-sky)/8 px-3 py-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate text-(--c-ink)">
                  <span className="font-mono">{selectedVehicle.plateNumber}</span> · {selectedVehicle.vehicleModel}
                </p>
                <p className="text-xs text-(--c-muted) truncate">{selectedVehicle.customerName}</p>
              </div>
              <button
                onClick={() => setSelectedVehicle(null)}
                aria-label={t('common.remove')}
                className="ml-2 shrink-0 flex items-center justify-center w-8 h-8 rounded-lg text-(--c-muted) hover:text-(--c-ink) hover:bg-(--c-fill-strong) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--c-sky)/60 cursor-pointer"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <div className="relative" ref={vehicleBoxRef}>
              <div className="flex items-center gap-2 rounded-xl border border-(--c-line) bg-(--c-input) px-3 transition-colors focus-within:border-(--c-sky)/60 focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.15)]">
                <Search size={15} strokeWidth={2} className="text-(--c-faint) shrink-0" aria-hidden />
                <input
                  id="insights-vehicle"
                  value={vehicleQuery}
                  onChange={(e) => {
                    setVehicleQuery(e.target.value);
                    setShowVehicleResults(true);
                  }}
                  onFocus={() => setShowVehicleResults(true)}
                  placeholder={t('accounting.salesInsights.vehicleSearchPlaceholder')}
                  className="flex-1 min-w-0 py-2.5 text-base sm:text-sm outline-none bg-transparent text-(--c-text) placeholder:text-(--c-faint)"
                />
              </div>
              {showVehicleResults && trimmedQuery && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1.5 rounded-xl border border-(--c-line) bg-(--c-input) shadow-[0_20px_40px_-15px_var(--c-shadow)] max-h-64 overflow-y-auto">
                  {vehicleSearching && <p className="text-sm text-(--c-muted) p-3">{t('accounting.salesInsights.searching')}</p>}
                  {!vehicleSearching && vehicleResults.length === 0 && (
                    <p className="text-sm text-(--c-muted) p-3">{t('accounting.salesInsights.noVehiclesFound')}</p>
                  )}
                  {!vehicleSearching &&
                    vehicleResults.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => pickVehicle(v)}
                        className="w-full text-left px-3 py-2.5 hover:bg-(--c-sky)/8 focus-visible:outline-none focus-visible:bg-(--c-sky)/8 border-b border-(--c-line) last:border-0 cursor-pointer"
                      >
                        <p className="font-mono font-semibold text-sm text-(--c-ink)">{v.plateNumber}</p>
                        <p className="text-xs text-(--c-muted)">
                          {v.vehicleModel} · {v.customerName}
                        </p>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {error && <ErrorNote text={error} />}

      {loading && (
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">{t('accounting.salesInsights.crunchingNumbers')}</span>
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${hasWorkshopRms ? 'lg:grid-cols-3' : ''} gap-3`}>
            {[0, 1, hasWorkshopRms ? 2 : null]
              .filter((x) => x !== null)
              .map((i) => (
                <div key={i} className={`${CARD} h-28 motion-safe:animate-pulse`} />
              ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${CARD} h-80 motion-safe:animate-pulse`} />
            <div className={`${CARD} h-80 motion-safe:animate-pulse`} />
          </div>
        </div>
      )}

      {!loading && !error && report && (
        <>
          <Highlights report={report} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel icon={Users} title={t('accounting.salesInsights.topCustomers')} subtitle={t('accounting.salesInsights.topCustomersSubtitle')}>
              {report.topCustomers.length === 0 ? (
                <EmptyState text={t('accounting.salesInsights.noData')} />
              ) : (
                <>
                  <TopCustomersBarChart rows={report.topCustomers} />
                  <RankList
                    rows={report.topCustomers.map((c) => ({
                      key: c.customerId,
                      name: c.name,
                      revenue: c.revenue,
                      detail: t('accounting.salesInsights.invoicesCount', { n: c.invoiceCount }),
                    }))}
                  />
                </>
              )}
            </Panel>

            <Panel icon={PackageSearch} title={t('accounting.salesInsights.topItems')} subtitle={t('accounting.salesInsights.topItemsSubtitle')}>
              {report.topProducts.length === 0 ? (
                <EmptyState text={t('accounting.salesInsights.noData')} />
              ) : (
                <>
                  <TopItemsPieChart rows={report.topProducts} otherLabel={t('accounting.salesInsights.other')} />
                  <RankList
                    rows={report.topProducts.map((p) => ({
                      key: p.productId,
                      name: p.name,
                      revenue: p.revenue,
                      detail: `${p.unitsSold} ${t('accounting.salesInsights.units')}`,
                    }))}
                  />
                </>
              )}
            </Panel>

            {hasWorkshopRms && (
              <Panel icon={Car} title={t('accounting.salesInsights.topVehicles')} subtitle={t('accounting.salesInsights.topVehiclesSubtitle')} wide>
                {report.topVehicles.length === 0 ? (
                  <EmptyState text={t('accounting.salesInsights.noData')} />
                ) : (
                  <>
                    <TopVehiclesBarChart rows={report.topVehicles} />
                    <RankList
                      twoColumns
                      rows={report.topVehicles.map((v) => ({
                        key: v.vehicleId,
                        name: `${v.plateNumber} · ${v.vehicleModel}`,
                        revenue: v.revenue,
                        detail: t('accounting.salesInsights.visitsCount', { n: v.visitCount }),
                      }))}
                    />
                  </>
                )}
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Ranked rows: exact amount plus each row's share of the listed total, so
// a chart's shape has numbers you can read off. `flush` drops the divider
// used when it sits under a chart.
function RankList({
  rows,
  twoColumns,
  flush,
}: {
  rows: { key: string; name: string; revenue: number; detail: string }[];
  twoColumns?: boolean;
  flush?: boolean;
}) {
  const { t } = useLanguage();
  const total = rows.reduce((n, r) => n + r.revenue, 0);
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  return (
    <ol
      className={`${flush ? '' : 'mt-4 pt-4 border-t border-(--c-line)'} grid gap-x-6 gap-y-3 ${twoColumns ? 'sm:grid-cols-2' : 'grid-cols-1'}`}
    >
      {rows.map((r, i) => {
        const pct = total ? Math.round((r.revenue / total) * 100) : 0;
        return (
          <li key={r.key} className="flex items-start gap-3 min-w-0">
            <span
              className={`mt-0.5 flex items-center justify-center w-6 h-6 rounded-md font-mono text-xs font-semibold shrink-0 ${
                i === 0
                  ? 'bg-(--c-amber)/15 text-(--c-amber) border border-(--c-amber)/30'
                  : 'bg-(--c-fill) text-(--c-muted) border border-(--c-line)'
              }`}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-(--c-ink) truncate" title={r.name}>
                  {r.name}
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-(--c-ink) shrink-0" title={formatIDR(r.revenue)}>
                  {formatIDRCompact(r.revenue)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-(--c-fill) overflow-hidden" aria-hidden>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-(--c-sky) to-(--c-emerald)"
                  style={{ width: `${(r.revenue / max) * 100}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between gap-3 text-xs text-(--c-muted)">
                <span>{r.detail}</span>
                <span className="tabular-nums">{t('accounting.salesInsights.shareOfTop', { pct, n: rows.length })}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
