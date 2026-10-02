'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Flame, CircleCheck, CircleAlert, RotateCcw, Package, Store, TriangleAlert } from 'lucide-react';
import { display } from '@/lib/fonts';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import DateRangePicker from '@/app/components/shared/DateRangePicker';

// Mirrors DeliveryReportService.report() on the backend.
type Driver = { id: string; email: string; displayName: string | null };
type TeamRow = {
  team: { id: string; name: string; driver: Driver | null };
  stops: number;
  delivered: number;
  failed: number;
  notDone: number;
  routeDays: number;
  perfectDays: number;
  incompleteDays: number;
  completionRate: number | null;
  perfectRate: number | null;
  streak: number;
};
type Report = {
  totals: {
    stops: number;
    delivered: number;
    failed: number;
    notDone: number;
    completionRate: number | null;
    routeDays: number;
    perfectDays: number;
  };
  daily: { date: string; delivered: number; failed: number; notDone: number }[];
  teams: TeamRow[];
  topCustomers: { customerId: string | null; name: string; delivered: number; failed: number }[];
  failureReasons: { reason: string; count: number }[];
  itemsEnabled: boolean;
  topItems: { productId: string | null; name: string; unit: string | null; quantity: number; deliveries: number }[];
};

// Tailwind palette variables, so the chart follows the app's dark mode
// (theme.css re-points these) instead of fixed hex values. Blue = done,
// red = failed, gray = never attempted; every series is also named in
// the legend and tooltip, so color is never the only cue.
const SERIES = {
  delivered: 'var(--color-blue-600)',
  failed: 'var(--color-red-500)',
  notDone: 'var(--color-gray-300)',
} as const;

// A team needs a few finished days before it earns an "always"/"never" tag.
const MIN_DAYS_FOR_TAG = 3;

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toCalendarDateString(d);
}

// Small uppercase eyebrow + Space Grotesk title — the panel header used
// across the report.
function Panel({
  title,
  subtitle,
  icon: Icon,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  icon: typeof TrendingUp;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-blue-500/15 rounded-xl bg-white shadow-sm p-4 sm:p-5 min-w-0 ${className}`}>
      <header className="flex items-start gap-2.5 mb-4">
        <span className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-600/10 border border-blue-600/20 shrink-0">
          <Icon size={14} strokeWidth={2} className="text-blue-700" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className={`${display.className} text-base font-semibold leading-tight`}>{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, bar, tone = 'text-gray-900' }: { label: string; value: string; sub: string; bar?: number | null; tone?: string }) {
  return (
    <div className="border border-blue-500/15 rounded-xl bg-white shadow-sm p-4 min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-900/50">{label}</div>
      <div className={`font-mono tabular-nums text-2xl sm:text-3xl font-semibold mt-1 ${tone}`}>{value}</div>
      {bar != null && (
        <div className="h-1 rounded-full bg-gray-100 mt-2 overflow-hidden" aria-hidden="true">
          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
      <div className="text-xs text-gray-500 mt-1.5 truncate">{sub}</div>
    </div>
  );
}

// Horizontal bar list: name, bar scaled to the largest value, number on
// the right. Used for every ranking so they read the same way.
function BarList({
  rows,
  color = 'bg-blue-600',
}: {
  rows: { key: string; label: React.ReactNode; value: number; display: string; note?: string }[];
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1">
          <span className="font-mono text-[11px] text-gray-400 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
          <div className="min-w-0">
            <div className="text-sm truncate">{r.label}</div>
            <div className="h-1.5 rounded-full bg-gray-100 mt-1 overflow-hidden" aria-hidden="true">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono tabular-nums text-sm font-semibold">{r.display}</div>
            {r.note && <div className="text-[11px] text-gray-500">{r.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function DeliveryReportsPage() {
  const { t, language } = useLanguage();
  const locale = language === 'id' ? 'id-ID' : 'en-US';
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/delivery-routes/reports?from=${from}&to=${to}`);
        const body = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) {
          setError(body?.message ?? t('delivery.reports.requestFailed', { status: res.status }));
          return;
        }
        setReport(body);
      } catch {
        if (alive) setError(t('delivery.reports.requestFailed', { status: '—' }));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, reloadKey]);

  const pct = (n: number | null) =>
    n == null ? '—' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(n);
  const num = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const driverName = (d: Driver | null) => (d ? d.displayName || d.email : t('delivery.reports.teams.noDriver'));

  const r = report;
  const hasData = !!r && r.totals.stops > 0;
  // Most reliable first: share of perfect days, then completion rate.
  const teams = r
    ? [...r.teams].sort(
        (a, b) => (b.perfectRate ?? -1) - (a.perfectRate ?? -1) || (b.completionRate ?? -1) - (a.completionRate ?? -1),
      )
    : [];

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <TrendingUp size={18} strokeWidth={2} className="text-blue-700" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('delivery.reports.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('delivery.reports.subtitle')}</p>
            </div>
          </div>
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, tt) => {
              setFrom(f ?? daysAgo(29));
              setTo(tt ?? daysAgo(0));
            }}
          />
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-3 sm:p-6 space-y-4">
        {error && (
          <div className="flex flex-wrap items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            <CircleAlert size={16} aria-hidden="true" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="inline-flex items-center gap-1.5 text-sm font-medium border border-red-200 bg-white rounded-md px-3 py-1.5 cursor-pointer"
            >
              <RotateCcw size={14} aria-hidden="true" />
              {t('delivery.reports.retry')}
            </button>
          </div>
        )}

        {/* KPI row — skeletons while loading so the layout doesn't jump. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {loading && !r
            ? Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-[118px] rounded-xl border border-blue-500/15 bg-white animate-pulse motion-reduce:animate-none" />
              ))
            : r && (
                <>
                  <Kpi
                    label={t('delivery.reports.kpi.completion')}
                    value={pct(r.totals.completionRate)}
                    bar={r.totals.completionRate}
                    sub={t('delivery.reports.kpi.completionSub', { delivered: r.totals.delivered, stops: r.totals.stops })}
                    tone="text-blue-700"
                  />
                  <Kpi
                    label={t('delivery.reports.kpi.perfectDays')}
                    value={`${r.totals.perfectDays}`}
                    bar={r.totals.routeDays ? r.totals.perfectDays / r.totals.routeDays : null}
                    sub={t('delivery.reports.kpi.perfectDaysSub', { routeDays: r.totals.routeDays })}
                  />
                  <Kpi
                    label={t('delivery.reports.kpi.failed')}
                    value={`${r.totals.failed}`}
                    sub={t('delivery.reports.kpi.failedSub', { rate: pct(r.totals.stops ? r.totals.failed / r.totals.stops : null) })}
                    tone={r.totals.failed > 0 ? 'text-red-600' : 'text-gray-900'}
                  />
                  <Kpi
                    label={t('delivery.reports.kpi.notDone')}
                    value={`${r.totals.notDone}`}
                    sub={t('delivery.reports.kpi.notDoneSub')}
                  />
                </>
              )}
        </div>

        {r && !hasData && !loading && (
          <div className="border border-dashed border-blue-500/30 rounded-xl bg-white/70 p-8 text-center">
            <p className={`${display.className} font-semibold`}>{t('delivery.reports.empty')}</p>
            <p className="text-sm text-gray-500 mt-1">{t('delivery.reports.emptyHint')}</p>
            <Link href="/delivery/routes" className="inline-block mt-3 text-sm font-medium text-blue-700 hover:underline">
              {t('nav.items.deliveryRoutes')} →
            </Link>
          </div>
        )}

        {r && hasData && (
          <>
            <Panel title={t('delivery.reports.daily.title')} subtitle={t('delivery.reports.daily.subtitle')} icon={TrendingUp}>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-gray-600">
                {(['delivered', 'failed', 'notDone'] as const).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SERIES[k] }} aria-hidden="true" />
                    {t(`delivery.reports.daily.${k}`)}
                  </span>
                ))}
              </div>
              <div
                role="img"
                aria-label={`${t('delivery.reports.daily.title')}: ${t('delivery.reports.kpi.completionSub', {
                  delivered: r.totals.delivered,
                  stops: r.totals.stops,
                })}`}
              >
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={r.daily} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke="var(--color-gray-200)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={dayLabel}
                      tick={{ fontSize: 11, fill: 'var(--color-gray-500)', fontFamily: 'var(--font-mono)' }}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--color-gray-200)' }}
                      minTickGap={16}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: 'var(--color-gray-500)', fontFamily: 'var(--font-mono)' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--color-blue-50)' }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload as Report['daily'][number];
                        const total = d.delivered + d.failed + d.notDone;
                        return (
                          <div className="rounded-lg border border-blue-500/20 bg-white shadow-md px-3 py-2 text-xs">
                            <div className="font-semibold mb-1">{dayLabel(String(label))}</div>
                            {(['delivered', 'failed', 'notDone'] as const).map((k) => (
                              <div key={k} className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-sm" style={{ background: SERIES[k] }} aria-hidden="true" />
                                <span className="text-gray-600">{t(`delivery.reports.daily.${k}`)}</span>
                                <span className="ml-auto pl-4 font-mono tabular-nums">{d[k]}</span>
                              </div>
                            ))}
                            <div className="border-t border-gray-100 mt-1 pt-1 text-gray-500 font-mono tabular-nums">
                              {pct(total ? d.delivered / total : null)}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="delivered" stackId="s" fill={SERIES.delivered} isAnimationActive={false} />
                    <Bar dataKey="failed" stackId="s" fill={SERIES.failed} isAnimationActive={false} />
                    <Bar dataKey="notDone" stackId="s" fill={SERIES.notDone} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title={t('delivery.reports.teams.title')} subtitle={t('delivery.reports.teams.subtitle')} icon={CircleCheck}>
              <ul className="divide-y divide-gray-100">
                {teams.map((tm) => {
                  const always = tm.routeDays >= MIN_DAYS_FOR_TAG && tm.perfectDays === tm.routeDays;
                  const never = tm.routeDays >= MIN_DAYS_FOR_TAG && tm.perfectDays === 0;
                  return (
                    <li key={tm.team.id} className="py-3 first:pt-0 last:pb-0 grid sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_7rem] gap-x-4 gap-y-2 items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold truncate">{tm.team.name}</span>
                          {always && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                              <CircleCheck size={11} aria-hidden="true" />
                              {t('delivery.reports.teams.alwaysComplete')}
                            </span>
                          )}
                          {never && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                              <TriangleAlert size={11} aria-hidden="true" />
                              {t('delivery.reports.teams.neverComplete')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{driverName(tm.team.driver)}</div>
                      </div>

                      <div className="min-w-0">
                        {tm.routeDays > 0 ? (
                          <>
                            {/* One segment per finished day: perfect days first, then the rest. */}
                            <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100" aria-hidden="true">
                              <div className="bg-blue-600" style={{ width: `${(tm.perfectDays / tm.routeDays) * 100}%` }} />
                              <div className="bg-red-400" style={{ width: `${(tm.incompleteDays / tm.routeDays) * 100}%` }} />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 mt-1 text-xs text-gray-600">
                              <span className="font-mono tabular-nums">
                                {t('delivery.reports.teams.perfectOf', { perfect: tm.perfectDays, days: tm.routeDays })}
                              </span>
                              {tm.streak >= 2 && (
                                <span className="inline-flex items-center gap-1 text-amber-700">
                                  <Flame size={12} aria-hidden="true" />
                                  {t('delivery.reports.teams.streak', { count: tm.streak })}
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">{t('delivery.reports.teams.noFinishedDays')}</span>
                        )}
                      </div>

                      <div className="sm:text-right">
                        <div className="font-mono tabular-nums text-lg font-semibold">{pct(tm.completionRate)}</div>
                        <div className="text-[11px] text-gray-500 font-mono tabular-nums">
                          {t('delivery.reports.teams.stops', { delivered: tm.delivered, stops: tm.stops })}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <div className="grid lg:grid-cols-2 gap-4">
              <Panel title={t('delivery.reports.customers.title')} subtitle={t('delivery.reports.customers.subtitle')} icon={Store}>
                <BarList
                  rows={r.topCustomers.map((c) => ({
                    key: c.customerId ?? c.name,
                    label: c.customerId ? (
                      <Link href={`/customers/${c.customerId}`} className="hover:text-blue-700 hover:underline">
                        {c.name}
                      </Link>
                    ) : (
                      c.name
                    ),
                    value: c.delivered,
                    display: `${c.delivered}`,
                    note: c.failed > 0 ? t('delivery.reports.customers.failedCount', { count: c.failed }) : undefined,
                  }))}
                />
              </Panel>

              <Panel title={t('delivery.reports.reasons.title')} subtitle={t('delivery.reports.reasons.subtitle')} icon={CircleAlert}>
                {r.failureReasons.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('delivery.reports.reasons.none')}</p>
                ) : (
                  <BarList
                    color="bg-red-500"
                    rows={r.failureReasons.map((x) => ({ key: x.reason, label: x.reason, value: x.count, display: `${x.count}` }))}
                  />
                )}
              </Panel>
            </div>

            {r.itemsEnabled && (
              <Panel title={t('delivery.reports.items.title')} subtitle={t('delivery.reports.items.subtitle')} icon={Package}>
                {r.topItems.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('delivery.reports.items.none')}</p>
                ) : (
                  <BarList
                    rows={r.topItems.map((it) => ({
                      key: it.productId ?? it.name,
                      label: it.name,
                      value: it.quantity,
                      display: `${num(it.quantity)}${it.unit ? ` ${it.unit}` : ''}`,
                      note: t('delivery.reports.items.inOrders', { count: it.deliveries }),
                    }))}
                  />
                )}
              </Panel>
            )}
          </>
        )}
      </div>
    </main>
  );
}
