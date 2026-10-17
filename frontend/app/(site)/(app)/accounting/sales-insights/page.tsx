'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { display } from '@/lib/fonts';
import { BarChart3, CalendarRange, Car, Crown, PackageSearch, Search, SlidersHorizontal, Users, X, type LucideIcon } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR, formatIDRCompact } from '@/lib/format';
import { toCalendarDateString } from '@/lib/dates';
import { getInitialParam, useSyncQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';
import { useHasModule } from '@/lib/hooks/useHasModule';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import TopCustomersBarChart from '@/app/components/reports/TopCustomersBarChart';
import TopItemsPieChart from '@/app/components/reports/TopItemsPieChart';
import TopVehiclesBarChart from '@/app/components/reports/TopVehiclesBarChart';
import type { TopReport } from '@/app/components/reports/types';


const FULL_REPORT_LIMIT = 10;

// Colours come from the .console tokens in theme.css (light + dark), shared
// with the platform console; .insights swaps in the app's blue and backdrop.
const CARD = 'rounded-2xl border border-(--c-line) bg-(--c-surface) backdrop-blur shadow-[0_20px_50px_-30px_var(--c-shadow)]';

type VehicleSearchResult = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  customer: { name: string };
};

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toCalendarDateString(d);
}
function defaultTo(): string {
  return toCalendarDateString(new Date());
}

// What DateRangePicker's "All time" preset resolves to — the top-report
// endpoint's from/to are required, not optional, so a null/null onChange
// gets translated to a fixed wide range rather than sent through as-is.
const ALL_TIME_FROM = '2000-01-01';

export default function SalesInsightsPage() {
  const { t } = useLanguage();
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');

  const [from, setFrom] = useState(() => getInitialParam('from', defaultFrom()));
  const [to, setTo] = useState(() => getInitialParam('to', defaultTo()));

  // Vehicle scope — WORKSHOP_RMS orgs only. Narrows Top Customers/Items
  // down to invoices for one car; Top Vehicles stays unscoped (see
  // InvoiceService.getTopReport's comment on why).
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [vehicleResults, setVehicleResults] = useState<VehicleSearchResult[]>([]);
  const [vehicleSearching, setVehicleSearching] = useState(false);
  const [showVehicleResults, setShowVehicleResults] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleSearchResult | null>(null);
  const vehicleBoxRef = useRef<HTMLDivElement>(null);

  const [report, setReport] = useState<TopReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useSyncQueryParams({ from, to, vehicleId: selectedVehicle?.id ?? null });

  useEffect(() => {
    if (!hasWorkshopRms || !vehicleQuery.trim()) {
      setVehicleResults([]);
      return;
    }
    let cancelled = false;
    setVehicleSearching(true);
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: vehicleQuery.trim() });
        const res = await apiFetch(`/vehicles/search?${params}`);
        if (res.ok && !cancelled) setVehicleResults(await res.json());
      } finally {
        if (!cancelled) setVehicleSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [vehicleQuery, hasWorkshopRms]);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (vehicleBoxRef.current && !vehicleBoxRef.current.contains(e.target as Node)) {
        setShowVehicleResults(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, limit: String(FULL_REPORT_LIMIT) });
      if (selectedVehicle) params.set('vehicleId', selectedVehicle.id);
      const res = await apiFetch(`/invoices/reports/top?${params}`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.salesInsights.requestFailed', { status: res.status }));
        setReport(null);
        return;
      }

      setReport(await res.json());
    } catch {
      setError(t('accounting.salesInsights.couldNotReachServer'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, selectedVehicle]);

  function pickVehicle(v: VehicleSearchResult) {
    setSelectedVehicle(v);
    setVehicleQuery('');
    setVehicleResults([]);
    setShowVehicleResults(false);
  }

  const topCustomer = report?.topCustomers[0];
  const topItem = report?.topProducts[0];
  const topVehicle = report?.topVehicles[0];

  return (
    <main
      className="console insights min-h-screen text-(--c-text) bg-(--c-bg)"
      style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-(--c-header) backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <BarChart3 size={18} strokeWidth={2} className="text-blue-700" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate text-(--c-ink)`}>
                {t('accounting.salesInsights.title')}
              </h1>
              <p className="text-sm text-(--c-muted) truncate">{t('accounting.salesInsights.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-5">
        {/* Filters */}
        <section className={`${CARD} p-4 sm:p-5 relative z-[5] ${hasWorkshopRms ? '' : 'w-full lg:w-fit'}`}>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-(--c-muted) mb-3">
            <SlidersHorizontal size={13} aria-hidden />
            {t('accounting.salesInsights.filters')}
          </p>
          <div className="flex flex-col lg:flex-row gap-4">
            <div>
              <p className="text-xs font-semibold text-(--c-muted) mb-1.5 flex items-center gap-1">
                <CalendarRange size={12} strokeWidth={2} aria-hidden />
                {t('accounting.salesInsights.dateRange')}
              </p>
              <DateRangePicker
                from={from}
                to={to}
                onChange={(f, t) => {
                  setFrom(f ?? ALL_TIME_FROM);
                  setTo(t ?? toCalendarDateString(new Date()));
                }}
              />
            </div>

            {/* Vehicle scope — WORKSHOP_RMS only */}
            {hasWorkshopRms && (
              <div className="w-full lg:flex-1 lg:min-w-0">
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
                      <p className="text-xs text-(--c-muted) truncate">{selectedVehicle.customer.name}</p>
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
                    {showVehicleResults && vehicleQuery.trim() && (
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
                                {v.vehicleModel} · {v.customer.name}
                              </p>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {error && (
          <p role="alert" className="text-sm text-(--c-red) bg-(--c-red)/10 border border-(--c-red)/30 rounded-xl p-3">
            {error}
          </p>
        )}

        {loading && (
          <div className="space-y-4" aria-busy="true">
            <span className="sr-only">{t('accounting.salesInsights.crunchingNumbers')}</span>
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${hasWorkshopRms ? 'lg:grid-cols-3' : ''} gap-3`}>
              {[0, 1, hasWorkshopRms ? 2 : null].filter((x) => x !== null).map((i) => (
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
            {/* Highlights — the #1 of each list, in plain words */}
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel
                icon={Users}
                title={t('accounting.salesInsights.topCustomers')}
                subtitle={t('accounting.salesInsights.topCustomersSubtitle')}
              >
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

              <Panel
                icon={PackageSearch}
                title={t('accounting.salesInsights.topItems')}
                subtitle={t('accounting.salesInsights.topItemsSubtitle')}
              >
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

              {/* Top vehicles — WORKSHOP_RMS only */}
              {hasWorkshopRms && (
                <Panel
                  icon={Car}
                  title={t('accounting.salesInsights.topVehicles')}
                  subtitle={t('accounting.salesInsights.topVehiclesSubtitle')}
                  wide
                >
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
    </main>
  );
}

const TONES = {
  sky: { icon: 'text-(--c-sky)', tile: 'from-(--c-sky)/20 border-(--c-sky)/30', glow: 'from-(--c-sky)/10' },
  emerald: { icon: 'text-(--c-emerald)', tile: 'from-(--c-emerald)/20 border-(--c-emerald)/30', glow: 'from-(--c-emerald)/10' },
  amber: { icon: 'text-(--c-amber)', tile: 'from-(--c-amber)/20 border-(--c-amber)/30', glow: 'from-(--c-amber)/10' },
} as const;

// The #1 entry of one list, spelled out: what it is, how much, and why.
function Highlight({
  icon: Icon,
  tone,
  label,
  name,
  value,
  detail,
  empty,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONES;
  label: string;
  name: string | undefined;
  value: string | null;
  detail: string | null;
  empty: string;
}) {
  const c = TONES[tone];
  return (
    <div className={`${CARD} relative overflow-hidden p-4`}>
      <span className={`absolute inset-0 bg-gradient-to-br ${c.glow} to-transparent pointer-events-none`} aria-hidden />
      <div className="relative flex items-center gap-2">
        <span className={`flex items-center justify-center w-8 h-8 rounded-lg border bg-gradient-to-br to-transparent ${c.tile}`}>
          <Icon size={15} className={c.icon} aria-hidden />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-(--c-muted)">{label}</span>
        {name && <Crown size={14} className="ml-auto text-(--c-amber)" aria-hidden />}
      </div>
      {name ? (
        <>
          <p className="relative mt-3 text-base font-semibold text-(--c-ink) truncate" title={name}>
            {name}
          </p>
          <p className="relative mt-0.5 flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xl font-semibold tabular-nums text-(--c-ink)">{value}</span>
            <span className="text-sm text-(--c-muted)">{detail}</span>
          </p>
        </>
      ) : (
        <p className="relative mt-3 text-sm text-(--c-muted)">{empty}</p>
      )}
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  subtitle,
  wide,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`${CARD} p-4 sm:p-5 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="flex items-start gap-3 mb-4">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-(--c-sky)/20 to-transparent border border-(--c-sky)/30 shrink-0">
          <Icon size={16} className="text-(--c-sky)" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className={`${display.className} text-base font-bold text-(--c-ink)`}>{title}</h2>
          <p className="text-sm text-(--c-muted)">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

// Ranked rows under each chart: exact amount plus each row's share of the
// listed total, so the chart's shape has numbers you can read off.
function RankList({
  rows,
  twoColumns,
}: {
  rows: { key: string; name: string; revenue: number; detail: string }[];
  twoColumns?: boolean;
}) {
  const { t } = useLanguage();
  const total = rows.reduce((n, r) => n + r.revenue, 0);
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  return (
    <ol className={`mt-4 pt-4 border-t border-(--c-line) grid gap-x-6 gap-y-3 ${twoColumns ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
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
                <div className="h-full rounded-full bg-gradient-to-r from-(--c-sky) to-(--c-emerald)" style={{ width: `${(r.revenue / max) * 100}%` }} />
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

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-(--c-line-strong) py-10 text-center">
      <BarChart3 size={22} className="text-(--c-faint)" aria-hidden />
      <p className="text-sm text-(--c-muted)">{text}</p>
    </div>
  );
}
