'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Flame,
  CircleCheck,
  CircleAlert,
  RotateCcw,
  Package,
  Store,
  TriangleAlert,
  ListTodo,
  Camera,
  CalendarClock,
  CalendarDays,
  Clock,
  Lightbulb,
  Search,
  Trophy,
  UserX,
  X,
  type LucideIcon,
} from 'lucide-react';
import { display } from '@/lib/fonts';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import { getInitialParam, useMergeQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import Pagination from '@/app/components/shared/Pagination';
import RescheduleStopDialog, { type RescheduleTarget } from '@/app/components/delivery/RescheduleStopDialog';
import { CARD, EmptyState, Highlight, Panel, TONES, type Tone } from '@/app/components/reports/InsightBlocks';

// Mirrors DeliveryReportService.report() on the backend.
type Driver = { id: string; email: string; displayName: string | null };
type TeamRow = {
  team: { id: string; name: string; driver: Driver | null };
  stops: number;
  delivered: number;
  failed: number;
  notDone: number;
  timed: number;
  onTime: number;
  routeDays: number;
  perfectDays: number;
  incompleteDays: number;
  completionRate: number | null;
  perfectRate: number | null;
  onTimeRate: number | null;
  streak: number;
};
type Summary = {
  stops: number;
  delivered: number;
  failed: number;
  notDone: number;
  timed: number;
  onTime: number;
  completionRate: number | null;
  failRate: number | null;
  onTimeRate: number | null;
};
type Counts = {
  stops: number;
  delivered: number;
  failed: number;
  notDone: number;
};
type Report = {
  totals: Summary & { routeDays: number; perfectDays: number };
  previous: Summary & { from: string; to: string };
  daily: (Counts & { date: string })[];
  weekdays: (Counts & { weekday: number })[];
  teams: TeamRow[];
  topCustomers: {
    customerId: string | null;
    name: string;
    delivered: number;
    failed: number;
  }[];
  problemCustomers: {
    customerId: string | null;
    name: string;
    delivered: number;
    failed: number;
    failRate: number;
  }[];
  failureReasons: { reason: string; count: number }[];
  itemsEnabled: boolean;
  topItems: {
    productId: string | null;
    name: string;
    unit: string | null;
    quantity: number;
    deliveries: number;
  }[];
  attention: {
    pendingTotal: number;
    missed: number;
    photoNotConfirmed: number;
    failedTotal: number;
    needsReschedule: number;
  };
};
// Mirrors DeliveryReportService.attention().
type AttentionRow = {
  stopId: string;
  routeId: string;
  date: string;
  team: { id: string; name: string; driver: Driver | null };
  customerId: string | null;
  name: string;
  doNumber: string | null;
  deliveryOrderId: string | null;
  address: string | null;
  photoTaken: boolean;
  photoTakenAt: string | null;
  missed: boolean;
  failedAt: string | null;
  reason: string | null;
  needsReschedule: boolean;
};
type AttentionPage = {
  kind: 'pending' | 'failed';
  total: number;
  page: number;
  pageSize: number;
  rows: AttentionRow[];
};

// Console tokens (theme.css), so the chart follows light/dark like the rest
// of the page. Blue = done, red = failed, gray = never attempted; every
// series is also named in the legend and tooltip, so color is never the
// only cue.
const SERIES = {
  delivered: 'var(--c-sky)',
  failed: 'var(--c-red)',
  notDone: 'var(--c-line-strong)',
} as const;

// A team needs a few finished days before it earns an "always"/"never" tag
// or a takeaway of its own.
const MIN_DAYS_FOR_TAG = 3;
// Below this many stops a rate is noise, not a pattern.
const MIN_STOPS_FOR_PATTERN = 10;
// How far off the overall rate a weekday or team has to be to get called out.
const NOTABLE_GAP = 0.05;
// Monday first — how the week is read in Indonesia.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toCalendarDateString(d);
}

const validDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const missRate = (c: Counts) => (c.stops ? (c.failed + c.notDone) / c.stops : 0);

// Change vs the previous period, as a chip: green when it moved the good way.
type Delta = { text: string; good: boolean | null };

function Kpi({
  label,
  value,
  sub,
  bar,
  tone = 'text-(--c-ink)',
  delta,
  deltaNote,
}: {
  label: string;
  value: string;
  sub: string;
  bar?: number | null;
  tone?: string;
  delta?: Delta | null;
  deltaNote?: string;
}) {
  const DeltaIcon = delta && delta.text.startsWith('-') ? TrendingDown : TrendingUp;
  return (
    <div className={`${CARD} p-4 min-w-0`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-(--c-muted) truncate">{label}</div>
      <div className={`font-mono tabular-nums text-2xl sm:text-3xl font-semibold mt-1 ${tone}`}>{value}</div>
      {bar != null && (
        <div className="h-1 rounded-full bg-(--c-fill-strong) mt-2 overflow-hidden" aria-hidden="true">
          <div className="h-full bg-(--c-sky) rounded-full" style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
      <div className="text-xs text-(--c-muted) mt-1.5 truncate" title={sub}>
        {sub}
      </div>
      {deltaNote && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {delta && (
            <span
              className={`inline-flex items-center gap-1 font-semibold font-mono tabular-nums rounded px-1.5 py-0.5 border ${
                delta.good == null
                  ? 'text-(--c-muted) bg-(--c-fill) border-(--c-line)'
                  : delta.good
                    ? 'text-(--c-emerald) bg-(--c-emerald)/10 border-(--c-emerald)/25'
                    : 'text-(--c-red) bg-(--c-red)/10 border-(--c-red)/25'
              }`}
            >
              <DeltaIcon size={11} aria-hidden="true" />
              {delta.text}
            </span>
          )}
          <span className="text-(--c-faint)">{deltaNote}</span>
        </div>
      )}
    </div>
  );
}

// Ranked rows: name, bar scaled to the largest value, number on the right
// and a detail line underneath (share of the list, failures…).
function RankList({
  rows,
  color = 'from-(--c-sky) to-(--c-emerald)',
}: {
  rows: {
    key: string;
    label: React.ReactNode;
    title: string;
    value: number;
    display: string;
    detail?: string;
    aside?: string;
  }[];
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="grid gap-y-3">
      {rows.map((r, i) => (
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
              <span className="text-sm font-medium text-(--c-ink) truncate" title={r.title}>
                {r.label}
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums text-(--c-ink) shrink-0">{r.display}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-(--c-fill-strong) overflow-hidden" aria-hidden="true">
              <div className={`h-full rounded-full bg-gradient-to-r ${color}`} style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
            {(r.detail || r.aside) && (
              <div className="mt-1 flex justify-between gap-3 text-xs text-(--c-muted)">
                <span className="truncate">{r.detail}</span>
                {r.aside && <span className="tabular-nums shrink-0">{r.aside}</span>}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

const FIELD =
  'rounded-xl border border-(--c-line) bg-(--c-input) text-sm text-(--c-text) px-3 py-2 outline-none focus:border-(--c-sky)/60 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.15)]';

// Who still has to be delivered to, and which failures nobody has put back
// on a route yet — fetched a page at a time with its own filters, since a
// long range can hold hundreds. Each row opens its route, where it's handled.
function AttentionPanel({
  from,
  to,
  counts,
  teams,
  reloadKey,
  dayLabel,
  driverName,
  onReschedule,
}: {
  from: string;
  to: string;
  counts: Report['attention'];
  teams: TeamRow['team'][];
  reloadKey: number;
  dayLabel: (iso: string) => string;
  driverName: (d: Driver | null) => string;
  onReschedule: (target: RescheduleTarget) => void;
}) {
  const { t } = useLanguage();
  const [kind, setKind] = useState<'pending' | 'failed'>(counts.needsReschedule > 0 ? 'failed' : 'pending');
  const [teamId, setTeamId] = useState('');
  const [state, setState] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<AttentionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce typing; any filter change goes back to page 1.
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [search]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        from,
        to,
        kind,
        sort,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (teamId) params.set('teamId', teamId);
      if (state) params.set('state', state);
      if (q) params.set('q', q);
      try {
        const res = await apiFetch(`/delivery-routes/reports/attention?${params}`);
        const body = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) {
          setError(
            body?.message ??
              t('delivery.reports.attention.loadFailed', {
                status: res.status,
              }),
          );
          return;
        }
        setData(body);
      } catch {
        if (alive) setError(t('delivery.reports.attention.loadFailed', { status: '—' }));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, kind, teamId, state, sort, q, page, pageSize, reloadKey]);

  const filtered = !!(teamId || state || q);
  const clearFilters = () => {
    setTeamId('');
    setState('');
    setSearch('');
    setQ('');
    setPage(1);
  };
  const states =
    kind === 'pending'
      ? [
          {
            value: 'missed',
            label: t('delivery.reports.attention.stateMissed'),
          },
          { value: 'open', label: t('delivery.reports.attention.stateOpen') },
          { value: 'photo', label: t('delivery.reports.attention.statePhoto') },
        ]
      : [
          {
            value: 'toReschedule',
            label: t('delivery.reports.attention.stateToReschedule'),
          },
          {
            value: 'rescheduled',
            label: t('delivery.reports.attention.stateRescheduled'),
          },
        ];
  const tabs = [
    {
      key: 'pending' as const,
      label: t('delivery.reports.attention.tabPending', {
        count: counts.pendingTotal,
      }),
      note:
        counts.missed > 0
          ? t('delivery.reports.attention.missedCount', {
              count: counts.missed,
            })
          : null,
    },
    {
      key: 'failed' as const,
      label: t('delivery.reports.attention.tabFailed', {
        count: counts.failedTotal,
      }),
      note:
        counts.needsReschedule > 0
          ? t('delivery.reports.attention.toReschedule', {
              count: counts.needsReschedule,
            })
          : null,
    },
  ];
  // Rows only match the tab once the fetch for it lands.
  const rows = data && data.kind === kind ? data.rows : [];

  return (
    <Panel title={t('delivery.reports.attention.title')} subtitle={t('delivery.reports.attention.subtitle')} icon={ListTodo}>
      <div role="tablist" className="flex flex-wrap gap-2 mb-3">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            role="tab"
            aria-selected={kind === tb.key}
            onClick={() => {
              setKind(tb.key);
              setState('');
              setPage(1);
            }}
            className={`text-sm font-medium rounded-lg border px-3 py-1.5 cursor-pointer ${
              kind === tb.key
                ? 'bg-(--c-sky) text-white border-(--c-sky)'
                : 'bg-(--c-input) text-(--c-sub) border-(--c-line) hover:border-(--c-sky)/50'
            }`}
          >
            {tb.label}
            {tb.note && <span className={`ml-1.5 text-xs ${kind === tb.key ? 'text-white/80' : 'text-(--c-amber)'}`}>· {tb.note}</span>}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 mb-4">
        <div className={`${FIELD} flex items-center gap-2 py-0 sm:col-span-2 lg:col-span-1`}>
          <Search size={15} className="text-(--c-faint) shrink-0" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('delivery.reports.attention.search')}
            aria-label={t('delivery.reports.attention.search')}
            className="flex-1 min-w-0 py-2 text-base sm:text-sm outline-none bg-transparent placeholder:text-(--c-faint)"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label={t('common.remove')}
              className="text-(--c-faint) hover:text-(--c-ink) cursor-pointer"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <select
          value={teamId}
          onChange={(e) => {
            setTeamId(e.target.value);
            setPage(1);
          }}
          aria-label={t('delivery.reports.teams.colTeam')}
          className={`${FIELD} cursor-pointer`}
        >
          <option value="">{t('delivery.reports.attention.allTeams')}</option>
          {teams.map((tm) => (
            <option key={tm.id} value={tm.id}>
              {tm.name}
            </option>
          ))}
        </select>
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
          aria-label={t('delivery.reports.attention.allStates')}
          className={`${FIELD} cursor-pointer`}
        >
          <option value="">{t('delivery.reports.attention.allStates')}</option>
          {states.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as 'newest' | 'oldest');
            setPage(1);
          }}
          aria-label={t('delivery.reports.attention.sortNewest')}
          className={`${FIELD} cursor-pointer`}
        >
          <option value="newest">{t('delivery.reports.attention.sortNewest')}</option>
          <option value="oldest">{t('delivery.reports.attention.sortOldest')}</option>
        </select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-(--c-red) bg-(--c-red)/10 border border-(--c-red)/30 rounded-xl p-3">
          {error}
        </p>
      ) : loading && !rows.length ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-12 rounded-lg bg-(--c-fill-strong) motion-safe:animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        filtered ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-(--c-muted)">
            {t('delivery.reports.attention.noMatch')}
            <button onClick={clearFilters} className="font-medium text-(--c-sky) hover:underline cursor-pointer">
              {t('delivery.reports.attention.clearFilters')}
            </button>
          </div>
        ) : (
          <p className="text-sm text-(--c-muted)">
            {t(kind === 'pending' ? 'delivery.reports.attention.nonePending' : 'delivery.reports.attention.noneFailed')}
          </p>
        )
      ) : (
        <>
          <ul className={`divide-y divide-(--c-line) ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {rows.map((row) => (
              <li
                key={row.stopId}
                className="py-2.5 first:pt-0 grid grid-cols-[3.5rem_minmax(0,1fr)] sm:grid-cols-[4rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-start"
              >
                <span className="font-mono text-xs text-(--c-muted) tabular-nums pt-0.5">{dayLabel(row.date)}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-(--c-ink) truncate">
                    {row.customerId ? (
                      <Link href={`/customers/${row.customerId}`} className="hover:text-(--c-sky) hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                    {row.doNumber && <span className="ml-1.5 font-mono text-[11px] font-normal text-(--c-faint)">{row.doNumber}</span>}
                  </div>
                  <div className="text-xs text-(--c-muted) truncate">
                    {row.team.name} · {driverName(row.team.driver)}
                    {row.address && <> · {row.address}</>}
                  </div>
                  {kind === 'failed' && row.reason && <div className="text-xs text-(--c-red) line-clamp-2">{row.reason}</div>}
                </div>
                <div className="col-start-2 sm:col-start-auto flex flex-wrap items-center gap-1.5 sm:justify-end">
                  {kind === 'pending' &&
                    (row.photoTaken ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-(--c-amber) bg-(--c-amber)/10 border border-(--c-amber)/25 rounded px-1.5 py-0.5">
                        <Camera size={11} aria-hidden="true" />
                        {t('delivery.reports.attention.photoNotConfirmed')}
                      </span>
                    ) : (
                      <span
                        className={`text-[11px] font-semibold rounded px-1.5 py-0.5 border ${
                          row.missed
                            ? 'text-(--c-red) bg-(--c-red)/10 border-(--c-red)/25'
                            : 'text-(--c-muted) bg-(--c-fill) border-(--c-line)'
                        }`}
                      >
                        {t(row.missed ? 'delivery.reports.attention.missed' : 'delivery.reports.attention.stillOpen')}
                      </span>
                    ))}
                  {kind === 'failed' &&
                    (row.needsReschedule ? (
                      <button
                        onClick={() =>
                          onReschedule({
                            stopId: row.stopId,
                            routeId: row.routeId,
                            label: row.name,
                            failureReason: row.reason,
                            deliveryOrderId: row.deliveryOrderId,
                          })
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded px-2 py-1 cursor-pointer"
                      >
                        <CalendarClock size={11} aria-hidden="true" />
                        {t('delivery.reports.attention.reschedule')}
                      </button>
                    ) : (
                      <span className="text-[11px] font-semibold text-(--c-muted) bg-(--c-fill) border border-(--c-line) rounded px-1.5 py-0.5">
                        {t('delivery.reports.attention.rescheduled')}
                      </span>
                    ))}
                  <Link href={`/delivery/routes/${row.routeId}`} className="text-xs font-medium text-(--c-sky) hover:underline">
                    {t('delivery.reports.attention.openRoute')} →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-3 border-t border-(--c-line)">
            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={data?.total ?? 0}
              onPageChange={setPage}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              pageSizeOptions={[10, 20, 50, 100]}
            />
          </div>
        </>
      )}
    </Panel>
  );
}

type Takeaway = { tone: Tone; icon: LucideIcon; text: string };

// The Driver tab of Staff Reports: its body (the page's header and tabs are Staff Reports').
export default function DeliveryReports() {
  const { t, language } = useLanguage();
  const locale = language === 'id' ? 'id-ID' : 'en-US';
  // In the URL, so opening a customer or route and coming back keeps the
  // range picked. The default (last 30 days) keeps a clean URL.
  const [from, setFrom] = useState(() => validDay(getInitialParam('from', '')) ?? daysAgo(29));
  const [to, setTo] = useState(() => validDay(getInitialParam('to', '')) ?? daysAgo(0));
  const isDefaultRange = from === daysAgo(29) && to === daysAgo(0);
  useMergeQueryParams({
    from: isDefaultRange ? null : from,
    to: isDefaultRange ? null : to,
  });
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [rescheduling, setRescheduling] = useState<RescheduleTarget | null>(null);

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
    n == null
      ? '—'
      : new Intl.NumberFormat(locale, {
          style: 'percent',
          maximumFractionDigits: 0,
        }).format(n);
  const num = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  // 2024-01-07 was a Sunday, so +weekday lands on the right day.
  const weekdayName = (wd: number, style: 'long' | 'short' = 'long') =>
    new Date(Date.UTC(2024, 0, 7 + wd)).toLocaleDateString(locale, {
      weekday: style,
      timeZone: 'UTC',
    });
  const driverName = (d: Driver | null) => (d ? d.displayName || d.email : t('delivery.reports.teams.noDriver'));

  const r = report;
  const hasData = !!r && r.totals.stops > 0;
  const hasPrev = !!r && r.previous.stops > 0;
  const periodDays = r ? Math.round((Date.parse(r.previous.to) - Date.parse(r.previous.from)) / 86_400_000) + 1 : 0;
  const deltaNote = hasPrev ? t('delivery.reports.kpi.vsPrev', { days: periodDays }) : t('delivery.reports.kpi.noPrev');

  // Rate change in percentage points; higherIsBetter flips the colour.
  const ptsDelta = (cur: number | null, prev: number | null, higherIsBetter = true): Delta | null => {
    if (!hasPrev || cur == null || prev == null) return null;
    const n = Math.round((cur - prev) * 100);
    return {
      text: t('delivery.reports.kpi.deltaPts', {
        sign: n > 0 ? '+' : n < 0 ? '-' : '±',
        n: Math.abs(n),
      }),
      good: n === 0 ? null : n > 0 === higherIsBetter,
    };
  };

  // Most reliable first: share of perfect days, then completion rate.
  const teams = r
    ? [...r.teams].sort((a, b) => (b.perfectRate ?? -1) - (a.perfectRate ?? -1) || (b.completionRate ?? -1) - (a.completionRate ?? -1))
    : [];
  const bestTeam = teams.find((tm) => tm.routeDays > 0);
  const weekdays = r ? WEEK_ORDER.map((wd) => r.weekdays[wd]) : [];
  const activeWeekdays = weekdays.filter((w) => w.stops > 0);
  const worstWeekday = activeWeekdays.length >= 2 ? [...activeWeekdays].sort((a, b) => missRate(b) - missRate(a))[0] : undefined;

  // Plain-language reading of the numbers: the trend first, then what needs
  // doing, then what's going wrong, then what's going well.
  const takeaways: Takeaway[] = [];
  if (r && hasData) {
    const rate = pct(r.totals.completionRate);
    if (!hasPrev) {
      takeaways.push({
        tone: 'sky',
        icon: TrendingUp,
        text: t('delivery.reports.takeaways.completionNoPrev', {
          rate,
          days: periodDays,
        }),
      });
    } else {
      const d = Math.round(((r.totals.completionRate ?? 0) - (r.previous.completionRate ?? 0)) * 100);
      const key = d >= 1 ? 'completionUp' : d <= -1 ? 'completionDown' : 'completionFlat';
      takeaways.push({
        tone: d >= 1 ? 'emerald' : d <= -1 ? 'red' : 'sky',
        icon: d <= -1 ? TrendingDown : TrendingUp,
        text: t(`delivery.reports.takeaways.${key}`, {
          rate,
          delta: Math.abs(d),
          days: periodDays,
        }),
      });
    }
    if (r.attention.needsReschedule > 0) {
      takeaways.push({
        tone: 'amber',
        icon: CalendarClock,
        text: t('delivery.reports.takeaways.reschedule', {
          count: r.attention.needsReschedule,
        }),
      });
    }
    if (r.attention.missed > 0) {
      takeaways.push({
        tone: 'amber',
        icon: TriangleAlert,
        text: t('delivery.reports.takeaways.missed', {
          count: r.attention.missed,
        }),
      });
    }
    const overallMiss = missRate(r.totals);
    if (worstWeekday && worstWeekday.stops >= MIN_STOPS_FOR_PATTERN && missRate(worstWeekday) - overallMiss >= NOTABLE_GAP) {
      takeaways.push({
        tone: 'red',
        icon: CalendarDays,
        text: t('delivery.reports.takeaways.worstWeekday', {
          day: weekdayName(worstWeekday.weekday),
          rate: pct(missRate(worstWeekday)),
          avg: pct(overallMiss),
        }),
      });
    }
    const topReason = r.failureReasons[0];
    if (topReason && r.totals.failed > 0) {
      takeaways.push({
        tone: 'red',
        icon: CircleAlert,
        text: t('delivery.reports.takeaways.topReason', {
          reason: topReason.reason,
          count: topReason.count,
          failed: r.totals.failed,
        }),
      });
    }
    const problem = r.problemCustomers[0];
    if (problem && problem.failed >= 2 && problem.failRate >= 0.25) {
      takeaways.push({
        tone: 'red',
        icon: UserX,
        text: t('delivery.reports.takeaways.problemCustomer', {
          name: problem.name,
          failed: problem.failed,
          total: problem.delivered + problem.failed,
        }),
      });
    }
    const ranked = r.teams.filter((tm) => tm.stops >= MIN_STOPS_FOR_PATTERN);
    const weakest = ranked.length >= 2 ? [...ranked].sort((a, b) => (a.completionRate ?? 0) - (b.completionRate ?? 0))[0] : undefined;
    if (weakest && (r.totals.completionRate ?? 0) - (weakest.completionRate ?? 0) >= NOTABLE_GAP) {
      takeaways.push({
        tone: 'red',
        icon: TriangleAlert,
        text: t('delivery.reports.takeaways.weakTeam', {
          team: weakest.team.name,
          rate: pct(weakest.completionRate),
          avg: pct(r.totals.completionRate),
        }),
      });
    }
    if (r.totals.timed >= MIN_STOPS_FOR_PATTERN) {
      takeaways.push({
        tone: (r.totals.onTimeRate ?? 0) >= 0.9 ? 'emerald' : 'amber',
        icon: Clock,
        text: t('delivery.reports.takeaways.onTime', {
          rate: pct(r.totals.onTimeRate),
        }),
      });
    }
    if (bestTeam && bestTeam.routeDays >= MIN_DAYS_FOR_TAG && bestTeam.perfectDays > 0) {
      takeaways.push({
        tone: 'emerald',
        icon: Trophy,
        text: t('delivery.reports.takeaways.bestTeam', {
          team: bestTeam.team.name,
          perfect: bestTeam.perfectDays,
          days: bestTeam.routeDays,
        }),
      });
    }
    const streaker = [...r.teams].sort((a, b) => b.streak - a.streak)[0];
    if (streaker && streaker.streak >= MIN_DAYS_FOR_TAG && streaker.team.id !== bestTeam?.team.id) {
      takeaways.push({
        tone: 'emerald',
        icon: Flame,
        text: t('delivery.reports.takeaways.streak', {
          team: streaker.team.name,
          count: streaker.streak,
        }),
      });
    }
    if (takeaways.length === 1 && r.totals.failed === 0 && r.totals.notDone === 0) {
      takeaways.push({
        tone: 'emerald',
        icon: CircleCheck,
        text: t('delivery.reports.takeaways.allGood'),
      });
    }
  }

  const topCustomer = r?.topCustomers[0];
  const topItem = r?.topItems[0];
  const topReason = r?.failureReasons[0];
  const customersTotal = r ? r.topCustomers.reduce((n, c) => n + c.delivered, 0) : 0;
  const chartData = r?.daily.map((d) => {
    const total = d.delivered + d.failed + d.notDone;
    return { ...d, completion: total ? d.delivered / total : null };
  });

  return (
    // Its panels use the console tokens (theme.css .console.insights); the page around it is Staff Reports'.
    <div className="console insights text-(--c-text)">
      <div className="space-y-4 sm:space-y-5">
        {/* Filters — the reports' one date range, first in the body like every other report. */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <DateRangePicker
              from={from}
              to={to}
              onChange={(f, tt) => {
                setFrom(f ?? daysAgo(29));
                setTo(tt ?? daysAgo(0));
              }}
            />
        </div>

        {error && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-(--c-red) bg-(--c-red)/10 border border-(--c-red)/30 rounded-xl px-4 py-3">
            <CircleAlert size={16} aria-hidden="true" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="inline-flex items-center gap-1.5 text-sm font-medium border border-(--c-red)/30 bg-(--c-input) rounded-lg px-3 py-1.5 cursor-pointer"
            >
              <RotateCcw size={14} aria-hidden="true" />
              {t('delivery.reports.retry')}
            </button>
          </div>
        )}

        {/* KPI row — skeletons while loading so the layout doesn't jump. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {loading && !r
            ? Array.from({ length: 4 }, (_, i) => <div key={i} className={`${CARD} h-[146px] motion-safe:animate-pulse`} />)
            : r && (
                <>
                  <Kpi
                    label={t('delivery.reports.kpi.completion')}
                    value={pct(r.totals.completionRate)}
                    bar={r.totals.completionRate}
                    sub={t('delivery.reports.kpi.completionSub', {
                      delivered: r.totals.delivered,
                      stops: r.totals.stops,
                    })}
                    tone="text-(--c-sky)"
                    delta={ptsDelta(r.totals.completionRate, r.previous.completionRate)}
                    deltaNote={deltaNote}
                  />
                  <Kpi
                    label={t('delivery.reports.kpi.onTime')}
                    value={pct(r.totals.onTimeRate)}
                    bar={r.totals.onTimeRate}
                    sub={
                      r.totals.timed
                        ? t('delivery.reports.kpi.onTimeSub', {
                            onTime: r.totals.onTime,
                            timed: r.totals.timed,
                          })
                        : t('delivery.reports.kpi.onTimeNone')
                    }
                    delta={ptsDelta(r.totals.onTimeRate, r.previous.onTimeRate)}
                    deltaNote={deltaNote}
                  />
                  <Kpi
                    label={t('delivery.reports.kpi.failed')}
                    value={`${r.totals.failed}`}
                    sub={t('delivery.reports.kpi.failedSub', {
                      rate: pct(r.totals.failRate),
                    })}
                    tone={r.totals.failed > 0 ? 'text-(--c-red)' : 'text-(--c-ink)'}
                    delta={ptsDelta(r.totals.failRate, r.previous.failRate, false)}
                    deltaNote={deltaNote}
                  />
                  <Kpi
                    label={t('delivery.reports.kpi.perfectDays')}
                    value={`${r.totals.perfectDays}`}
                    bar={r.totals.routeDays ? r.totals.perfectDays / r.totals.routeDays : null}
                    sub={t('delivery.reports.kpi.perfectDaysSub', {
                      routeDays: r.totals.routeDays,
                    })}
                  />
                </>
              )}
        </div>

        {r && !hasData && !loading && (
          <div className={`${CARD} border-dashed p-8 text-center`}>
            <p className={`${display.className} font-semibold text-(--c-ink)`}>{t('delivery.reports.empty')}</p>
            <p className="text-sm text-(--c-muted) mt-1">{t('delivery.reports.emptyHint')}</p>
            <Link href="/delivery/routes" className="inline-block mt-3 text-sm font-medium text-(--c-sky) hover:underline">
              {t('nav.items.deliveryRoutes')} →
            </Link>
          </div>
        )}

        {r && hasData && (
          <>
            {/* Highlights — the #1 of each list, in plain words */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Highlight
                icon={Trophy}
                tone="emerald"
                label={t('delivery.reports.highlights.bestTeam')}
                name={bestTeam?.team.name}
                value={bestTeam ? pct(bestTeam.completionRate) : null}
                detail={
                  bestTeam
                    ? t('delivery.reports.highlights.bestTeamDetail', {
                        perfect: bestTeam.perfectDays,
                        days: bestTeam.routeDays,
                      })
                    : null
                }
                empty={t('delivery.reports.highlights.noDataShort')}
              />
              <Highlight
                icon={Store}
                tone="sky"
                label={t('delivery.reports.highlights.topCustomer')}
                name={topCustomer?.name}
                value={topCustomer ? `${topCustomer.delivered}` : null}
                detail={topCustomer ? t('delivery.reports.customers.deliveries') : null}
                empty={t('delivery.reports.highlights.noDataShort')}
              />
              {r.itemsEnabled && topItem ? (
                <Highlight
                  icon={Package}
                  tone="amber"
                  label={t('delivery.reports.highlights.topItem')}
                  name={topItem.name}
                  value={`${num(topItem.quantity)}${topItem.unit ? ` ${topItem.unit}` : ''}`}
                  detail={t('delivery.reports.items.inOrders', {
                    count: topItem.deliveries,
                  })}
                  empty={t('delivery.reports.highlights.noDataShort')}
                />
              ) : (
                <Highlight
                  icon={CircleAlert}
                  tone="red"
                  crown={false}
                  label={t('delivery.reports.highlights.topReason')}
                  name={topReason?.reason}
                  value={topReason ? `${topReason.count}` : null}
                  detail={
                    topReason
                      ? t('delivery.reports.highlights.shareOfFailures', {
                          pct: pct(topReason.count / Math.max(1, r.totals.failed)),
                        })
                      : null
                  }
                  empty={t('delivery.reports.reasons.none')}
                />
              )}
            </div>

            {/* Key takeaways */}
            <Panel title={t('delivery.reports.takeaways.title')} subtitle={t('delivery.reports.takeaways.subtitle')} icon={Lightbulb}>
              <ul className="grid sm:grid-cols-2 gap-2.5">
                {takeaways.map((tk, i) => {
                  const c = TONES[tk.tone];
                  return (
                    <li key={i} className="flex items-start gap-2.5 rounded-xl border border-(--c-line) bg-(--c-fill) p-3">
                      <span
                        className={`flex items-center justify-center w-7 h-7 rounded-lg border bg-gradient-to-br to-transparent shrink-0 ${c.tile}`}
                      >
                        <tk.icon size={14} className={c.icon} aria-hidden="true" />
                      </span>
                      <p className="text-sm text-(--c-text) leading-snug pt-0.5">{tk.text}</p>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <AttentionPanel
              key={`${from}-${to}`}
              from={from}
              to={to}
              counts={r.attention}
              teams={r.teams.map((tm) => tm.team)}
              reloadKey={reloadKey}
              dayLabel={dayLabel}
              driverName={driverName}
              onReschedule={setRescheduling}
            />

            <Panel title={t('delivery.reports.daily.title')} subtitle={t('delivery.reports.daily.subtitle')} icon={TrendingUp}>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-(--c-muted)">
                {(['delivered', 'failed', 'notDone'] as const).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SERIES[k] }} aria-hidden="true" />
                    {t(`delivery.reports.daily.${k}`)}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 rounded-full bg-(--c-emerald)" aria-hidden="true" />
                  {t('delivery.reports.daily.completion')}
                </span>
              </div>
              <div
                role="img"
                aria-label={`${t('delivery.reports.daily.title')}: ${t('delivery.reports.kpi.completionSub', {
                  delivered: r.totals.delivered,
                  stops: r.totals.stops,
                })}`}
              >
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: -8, bottom: 0, left: -20 }} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={dayLabel}
                      tick={{
                        fontSize: 11,
                        fill: 'var(--chart-ink)',
                        fontFamily: 'var(--font-mono)',
                      }}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--chart-grid)' }}
                      minTickGap={16}
                    />
                    <YAxis
                      yAxisId="stops"
                      allowDecimals={false}
                      tick={{
                        fontSize: 11,
                        fill: 'var(--chart-ink)',
                        fontFamily: 'var(--font-mono)',
                      }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      yAxisId="rate"
                      orientation="right"
                      domain={[0, 1]}
                      ticks={[0, 0.5, 1]}
                      tickFormatter={(v: number) => pct(v)}
                      tick={{
                        fontSize: 11,
                        fill: 'var(--chart-ink)',
                        fontFamily: 'var(--font-mono)',
                      }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--c-fill-strong)' }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload as NonNullable<typeof chartData>[number];
                        return (
                          <div className="rounded-lg border border-(--c-line) bg-(--chart-surface) shadow-md px-3 py-2 text-xs text-(--c-text)">
                            <div className="font-semibold mb-1">{dayLabel(String(label))}</div>
                            {(['delivered', 'failed', 'notDone'] as const).map((k) => (
                              <div key={k} className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-sm" style={{ background: SERIES[k] }} aria-hidden="true" />
                                <span className="text-(--c-muted)">{t(`delivery.reports.daily.${k}`)}</span>
                                <span className="ml-auto pl-4 font-mono tabular-nums">{d[k]}</span>
                              </div>
                            ))}
                            <div className="border-t border-(--c-line) mt-1 pt-1 flex gap-2">
                              <span className="text-(--c-muted)">{t('delivery.reports.daily.completion')}</span>
                              <span className="ml-auto font-mono tabular-nums">{pct(d.completion)}</span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar yAxisId="stops" dataKey="delivered" stackId="s" fill={SERIES.delivered} isAnimationActive={false} />
                    <Bar yAxisId="stops" dataKey="failed" stackId="s" fill={SERIES.failed} isAnimationActive={false} />
                    <Bar
                      yAxisId="stops"
                      dataKey="notDone"
                      stackId="s"
                      fill={SERIES.notDone}
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="rate"
                      dataKey="completion"
                      type="monotone"
                      stroke="var(--c-emerald)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <div className="grid lg:grid-cols-2 gap-4">
              <Panel title={t('delivery.reports.weekdays.title')} subtitle={t('delivery.reports.weekdays.subtitle')} icon={CalendarDays}>
                <ul className="space-y-2.5">
                  {weekdays.map((w) => {
                    const worst = worstWeekday?.weekday === w.weekday && missRate(w) > 0;
                    return (
                      <li key={w.weekday} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3">
                        <span className={`text-sm font-medium ${worst ? 'text-(--c-red)' : 'text-(--c-ink)'}`}>
                          {weekdayName(w.weekday, 'short')}
                        </span>
                        {w.stops > 0 ? (
                          <div className="flex h-2.5 rounded-full overflow-hidden bg-(--c-fill-strong)" aria-hidden="true">
                            <div
                              style={{
                                width: `${(w.delivered / w.stops) * 100}%`,
                                background: SERIES.delivered,
                              }}
                            />
                            <div
                              style={{
                                width: `${(w.failed / w.stops) * 100}%`,
                                background: SERIES.failed,
                              }}
                            />
                            <div
                              style={{
                                width: `${(w.notDone / w.stops) * 100}%`,
                                background: SERIES.notDone,
                              }}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-(--c-faint)">{t('delivery.reports.weekdays.noStops')}</span>
                        )}
                        <div className="text-right min-w-[6.5rem]">
                          {w.stops > 0 && (
                            <>
                              <div
                                className={`font-mono tabular-nums text-xs font-semibold ${worst ? 'text-(--c-red)' : 'text-(--c-ink)'}`}
                              >
                                {t('delivery.reports.weekdays.missRate', {
                                  rate: pct(missRate(w)),
                                })}
                              </div>
                              <div className="text-[11px] text-(--c-muted)">
                                {t('delivery.reports.weekdays.stops', {
                                  count: w.stops,
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>

              <Panel title={t('delivery.reports.reasons.title')} subtitle={t('delivery.reports.reasons.subtitle')} icon={CircleAlert}>
                {r.failureReasons.length === 0 ? (
                  <EmptyState icon={CircleCheck} text={t('delivery.reports.reasons.none')} />
                ) : (
                  <RankList
                    color="from-(--c-red) to-(--c-amber)"
                    rows={r.failureReasons.map((x) => ({
                      key: x.reason,
                      label: x.reason,
                      title: x.reason,
                      value: x.count,
                      display: `${x.count}`,
                      detail: t('delivery.reports.reasons.shareOfFailures', {
                        pct: pct(x.count / Math.max(1, r.totals.failed)),
                      }),
                    }))}
                  />
                )}
              </Panel>
            </div>

            <Panel title={t('delivery.reports.teams.title')} subtitle={t('delivery.reports.teams.subtitle')} icon={CircleCheck}>
              <ul className="divide-y divide-(--c-line)">
                {teams.map((tm) => {
                  const always = tm.routeDays >= MIN_DAYS_FOR_TAG && tm.perfectDays === tm.routeDays;
                  const never = tm.routeDays >= MIN_DAYS_FOR_TAG && tm.perfectDays === 0;
                  return (
                    <li
                      key={tm.team.id}
                      className="py-3 first:pt-0 last:pb-0 grid sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_7rem] gap-x-4 gap-y-2 items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-(--c-ink) truncate">{tm.team.name}</span>
                          {always && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-(--c-emerald) bg-(--c-emerald)/10 border border-(--c-emerald)/25 rounded px-1.5 py-0.5">
                              <CircleCheck size={11} aria-hidden="true" />
                              {t('delivery.reports.teams.alwaysComplete')}
                            </span>
                          )}
                          {never && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-(--c-red) bg-(--c-red)/10 border border-(--c-red)/25 rounded px-1.5 py-0.5">
                              <TriangleAlert size={11} aria-hidden="true" />
                              {t('delivery.reports.teams.neverComplete')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-(--c-muted) truncate">{driverName(tm.team.driver)}</div>
                      </div>

                      <div className="min-w-0">
                        {tm.routeDays > 0 ? (
                          <>
                            {/* One segment per finished day: perfect days first, then the rest. */}
                            <div className="flex h-2.5 rounded-full overflow-hidden bg-(--c-fill-strong)" aria-hidden="true">
                              <div
                                style={{
                                  width: `${(tm.perfectDays / tm.routeDays) * 100}%`,
                                  background: SERIES.delivered,
                                }}
                              />
                              <div
                                style={{
                                  width: `${(tm.incompleteDays / tm.routeDays) * 100}%`,
                                  background: SERIES.failed,
                                }}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 mt-1 text-xs text-(--c-muted)">
                              <span className="font-mono tabular-nums">
                                {t('delivery.reports.teams.perfectOf', {
                                  perfect: tm.perfectDays,
                                  days: tm.routeDays,
                                })}
                              </span>
                              {tm.onTimeRate != null && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={12} aria-hidden="true" />
                                  {t('delivery.reports.teams.onTime', {
                                    rate: pct(tm.onTimeRate),
                                  })}
                                </span>
                              )}
                              {tm.streak >= 2 && (
                                <span className="inline-flex items-center gap-1 text-(--c-amber)">
                                  <Flame size={12} aria-hidden="true" />
                                  {t('delivery.reports.teams.streak', {
                                    count: tm.streak,
                                  })}
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-(--c-faint)">{t('delivery.reports.teams.noFinishedDays')}</span>
                        )}
                      </div>

                      <div className="sm:text-right">
                        <div className="font-mono tabular-nums text-lg font-semibold text-(--c-ink)">{pct(tm.completionRate)}</div>
                        <div className="text-[11px] text-(--c-muted) font-mono tabular-nums">
                          {t('delivery.reports.teams.stops', {
                            delivered: tm.delivered,
                            stops: tm.stops,
                          })}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <div className="grid lg:grid-cols-2 gap-4">
              <Panel title={t('delivery.reports.customers.title')} subtitle={t('delivery.reports.customers.subtitle')} icon={Store}>
                {r.topCustomers.length === 0 ? (
                  <EmptyState text={t('delivery.reports.customers.none')} />
                ) : (
                  <RankList
                    rows={r.topCustomers.map((c) => ({
                      key: c.customerId ?? c.name,
                      title: c.name,
                      label: c.customerId ? (
                        <Link href={`/customers/${c.customerId}`} className="hover:text-(--c-sky) hover:underline">
                          {c.name}
                        </Link>
                      ) : (
                        c.name
                      ),
                      value: c.delivered,
                      display: `${c.delivered}`,
                      detail:
                        c.failed > 0
                          ? t('delivery.reports.customers.failedCount', {
                              count: c.failed,
                            })
                          : undefined,
                      aside: t('delivery.reports.customers.shareOfTop', {
                        pct: pct(customersTotal ? c.delivered / customersTotal : 0),
                        n: r.topCustomers.length,
                      }),
                    }))}
                  />
                )}
              </Panel>

              <Panel title={t('delivery.reports.problems.title')} subtitle={t('delivery.reports.problems.subtitle')} icon={UserX}>
                {r.problemCustomers.length === 0 ? (
                  <EmptyState icon={CircleCheck} text={t('delivery.reports.problems.none')} />
                ) : (
                  <RankList
                    color="from-(--c-red) to-(--c-amber)"
                    rows={r.problemCustomers.map((c) => ({
                      key: c.customerId ?? c.name,
                      title: c.name,
                      label: c.customerId ? (
                        <Link href={`/customers/${c.customerId}`} className="hover:text-(--c-sky) hover:underline">
                          {c.name}
                        </Link>
                      ) : (
                        c.name
                      ),
                      value: c.failed,
                      display: pct(c.failRate),
                      detail: t('delivery.reports.problems.failedOf', {
                        failed: c.failed,
                        total: c.delivered + c.failed,
                      }),
                    }))}
                  />
                )}
              </Panel>
            </div>

            {r.itemsEnabled && (
              <Panel title={t('delivery.reports.items.title')} subtitle={t('delivery.reports.items.subtitle')} icon={Package}>
                {r.topItems.length === 0 ? (
                  <EmptyState icon={Package} text={t('delivery.reports.items.none')} />
                ) : (
                  <RankList
                    rows={r.topItems.map((it) => ({
                      key: it.productId ?? it.name,
                      label: it.name,
                      title: it.name,
                      value: it.quantity,
                      display: `${num(it.quantity)}${it.unit ? ` ${it.unit}` : ''}`,
                      detail: t('delivery.reports.items.inOrders', {
                        count: it.deliveries,
                      }),
                    }))}
                  />
                )}
              </Panel>
            )}
          </>
        )}
      </div>
      {rescheduling && (
        <RescheduleStopDialog
          target={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => {
            setRescheduling(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
