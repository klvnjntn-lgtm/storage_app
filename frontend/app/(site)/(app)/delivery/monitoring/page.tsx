'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { display } from '@/lib/fonts';
import { BarChart3, RefreshCw, AlertTriangle, MapPin, Navigation } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import DeliveryMap, { type MapDriver, type MapStop } from '@/app/components/delivery/DeliveryMap';
import DatePicker from '@/app/components/shared/DatePicker';
import TeamPicker, { teamLabel, type PickerTeam } from '@/app/components/delivery/TeamPicker';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { toCalendarDateString } from '@/lib/dates';
import { getInitialParam, useSyncQueryParams } from '@/lib/useQuerySync';


type Summary = { total: number; delivered: number; pending: number; failed: number; atRisk: number; late: number };
// Where the driver probably is — from their last resolved stop, not live
// GPS (see DeliveryRoutesService.whereabouts).
type Whereabouts = {
  lastStop: {
    label: string;
    status: 'DELIVERED' | 'FAILED';
    at: string;
    plannedEta: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  nextStop: { label: string; plannedEta: string | null } | null;
  plannedDepartureAt: string | null;
  position: { latitude: number; longitude: number; source: 'LAST_STOP' | 'DEPOT' } | null;
};
type TeamProgress = Summary & Whereabouts & { routeId: string; team: PickerTeam };
// Prisma Decimal fields serialize as strings over JSON, not numbers.
type MapStopRaw = {
  id: string;
  status: MapStop['status'];
  latitude: string;
  longitude: string;
  label: string;
  routeId: string;
  team: PickerTeam;
};
type MonitoringMapStop = MapStop & { team: PickerTeam };

function todayIso() {
  // Local calendar date — toISOString() is UTC, still yesterday before 07:00 WIB.
  return toCalendarDateString(new Date());
}

// How often today's view refreshes itself while the tab is visible.
const REFRESH_MS = 30_000;

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

// Initials for the driver's map badge: driver name, else the team's.
function initials(team: PickerTeam) {
  const name = team.driver?.displayName || team.driver?.email.split('@')[0] || team.name;
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 min-w-0">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-gray-500 truncate">{label}</div>
    </div>
  );
}

// Office staff watch deliveries too; drivers have their own page.
const MONITORING_ROLES = ['ADMIN', 'USER'] as const;

const validDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export default function DeliveryMonitoringPage() {
  const { t } = useLanguage();
  const { authorized } = useRequireAdmin(MONITORING_ROLES);
  // In the URL, so opening a route and coming back keeps the day picked.
  const [date, setDate] = useState(() => validDay(getInitialParam('date', '')) ?? todayIso());
  const [summary, setSummary] = useState<Summary>({ total: 0, delivered: 0, pending: 0, failed: 0, atRisk: 0, late: 0 });
  const [byTeam, setByTeam] = useState<TeamProgress[]>([]);
  const [mapStops, setMapStops] = useState<MonitoringMapStop[]>([]);
  // '' = all teams. Narrows the map only; the stats and team list stay org-wide.
  const [mapTeamId, setMapTeamId] = useState(() => getInitialParam<string>('team', ''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);
  const isToday = date === todayIso();
  useSyncQueryParams({ date: isToday ? null : date, team: mapTeamId });

  // silent: background refresh — no loading state, keeps the last good
  // data on screen if a poll fails.
  async function load(silent = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [summaryRes, teamsRes, mapRes] = await Promise.all([
        apiFetch(`/delivery-routes/monitoring/summary?date=${date}`),
        apiFetch(`/delivery-routes/monitoring/teams?date=${date}`),
        apiFetch(`/delivery-routes/monitoring/map?date=${date}`),
      ]);
      if (!summaryRes.ok || !teamsRes.ok) {
        const body = await (summaryRes.ok ? teamsRes : summaryRes).json().catch(() => null);
        setError(body?.message ?? t('delivery.monitoring.requestFailed', { status: summaryRes.status }));
        return;
      }
      setSummary(await summaryRes.json());
      setByTeam(await teamsRes.json());
      if (mapRes.ok) {
        const raw: MapStopRaw[] = await mapRes.json();
        setMapStops(raw.map((s) => ({ ...s, latitude: Number(s.latitude), longitude: Number(s.longitude) })));
      }
      setUpdatedAt(new Date());
      setError(null);
    } catch {
      if (!silent) setError(t('delivery.monitoring.couldNotReachServer'));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authorized) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, authorized]);

  // Live mode for today: poll while the tab is visible, and catch up
  // immediately when the user comes back to it.
  useEffect(() => {
    if (!isToday || !authorized) return;
    const tick = () => {
      if (document.visibilityState === 'visible') load(true);
    };
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, isToday, authorized]);

  const noDriver = t('delivery.teams.noDriver');

  // Teams that have stops on the map today, for the map's team filter.
  const mapTeams = useMemo(() => {
    const seen = new Map<string, PickerTeam>();
    for (const s of mapStops) if (!seen.has(s.team.id)) seen.set(s.team.id, s.team);
    return [...seen.values()];
  }, [mapStops]);

  // One badge per driver at their best-guess position.
  // "Minutes ago" is measured from the last refresh, which runs every 30s.
  const now = updatedAt?.getTime() ?? 0;
  const mapDrivers = useMemo<MapDriver[]>(() => {
    return byTeam
      .filter((d) => d.position && (!mapTeamId || d.team.id === mapTeamId))
      .map((d) => ({
        id: d.routeId,
        latitude: d.position!.latitude,
        longitude: d.position!.longitude,
        badge: initials(d.team),
        label: teamLabel(d.team, noDriver),
        muted: d.position!.source === 'DEPOT',
        detail: d.lastStop
          ? t('delivery.monitoring.lastStopAgo', {
              n: minutesSince(d.lastStop.at, now),
              place: d.lastStop.label,
            })
          : t('delivery.monitoring.atDepot'),
      }));
  }, [byTeam, mapTeamId, noDriver, t, now]);

  // Popup shows the stop, then its team/driver and status.
  const visibleMapStops = useMemo<MapStop[]>(
    () =>
      mapStops
        .filter((s) => !mapTeamId || s.team.id === mapTeamId)
        .map((s) => ({
          ...s,
          detail: `${teamLabel(s.team, noDriver)} · ${t(`delivery.routeDetail.statusLabel.${s.status}`)}`,
        })),
    [mapStops, mapTeamId, noDriver, t],
  );

  if (!authorized) return null;

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center gap-2.5 min-w-0">
          <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
            <BarChart3 size={18} strokeWidth={2} className="text-blue-700" />
          </span>
          <div className="min-w-0">
            <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
              {t('delivery.monitoring.title')}
            </h1>
            <p className="text-xs text-gray-500 truncate">{t('delivery.monitoring.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>
        )}

        <div data-tour="dlv-mon-date" className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
              {t('delivery.monitoring.dateLabel')}
            </label>
            <DatePicker value={date} onChange={setDate} className="w-44" />
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {isToday && (
              <span className="inline-flex items-center gap-1.5 font-medium text-green-700">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                {t('delivery.monitoring.live')}
              </span>
            )}
            {updatedAt && (
              <span>
                {t('delivery.monitoring.updatedAt', {
                  time: updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                })}
              </span>
            )}
            <button
              onClick={() => load()}
              disabled={loading}
              aria-label={t('delivery.monitoring.refresh')}
              title={t('delivery.monitoring.refresh')}
              className="p-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div data-tour="dlv-mon-stats" className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
          <StatCard label={t('delivery.monitoring.total')} value={summary.total} tone="text-gray-900" />
          <StatCard label={t('delivery.monitoring.delivered')} value={summary.delivered} tone="text-green-600" />
          <StatCard label={t('delivery.monitoring.pending')} value={summary.pending} tone="text-amber-600" />
          <StatCard label={t('delivery.monitoring.failed')} value={summary.failed} tone="text-red-600" />
          <StatCard label={t('delivery.monitoring.late')} value={summary.late} tone="text-red-600" />
          <StatCard label={t('delivery.monitoring.atRisk')} value={summary.atRisk} tone="text-amber-600" />
        </div>

        {(mapStops.length > 0 || mapDrivers.length > 0) && (
          <div data-tour="dlv-mon-map" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('delivery.monitoring.mapTitle')}</h2>
              <TeamPicker
                teams={mapTeams}
                value={mapTeamId}
                onChange={setMapTeamId}
                clearLabel={t('delivery.routes.allTeams')}
                className="w-full sm:w-72"
              />
            </div>
            <DeliveryMap stops={visibleMapStops} drivers={mapDrivers} />
            <p className="text-xs text-gray-500">{t('delivery.monitoring.positionHint')}</p>
          </div>
        )}

        <div data-tour="dlv-mon-teams" className="space-y-2">
          <h2 className="text-sm font-semibold">{t('delivery.monitoring.byTeam')}</h2>
          {!loading && byTeam.length === 0 && (
            <p className="text-sm text-gray-500">{t('delivery.monitoring.noTeams')}</p>
          )}
          {byTeam.map((d) => {
            const done = d.delivered + d.failed;
            return (
              <Link
                key={d.routeId}
                href={`/delivery/routes/${d.routeId}`}
                className="block bg-white rounded-lg border border-gray-200 p-3 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium truncate min-w-0">{teamLabel(d.team, t('delivery.teams.noDriver'))}</span>
                  <span className="text-xs text-gray-600 shrink-0 flex items-center gap-2">
                    {d.late > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-red-600 font-semibold">
                        <AlertTriangle size={11} />
                        {d.late} {t('delivery.monitoring.late').toLowerCase()}
                      </span>
                    )}
                    {d.atRisk > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-amber-600 font-semibold">
                        <AlertTriangle size={11} />
                        {d.atRisk} {t('delivery.monitoring.atRisk').toLowerCase()}
                      </span>
                    )}
                    {d.failed > 0 && (
                      <span className="text-red-600 font-semibold">
                        {d.failed} {t('delivery.monitoring.failed').toLowerCase()}
                      </span>
                    )}
                    <span>
                      <span className="text-green-600 font-semibold">{d.delivered}</span>/{d.total}
                    </span>
                  </span>
                </div>
                {d.total > 0 && (
                  <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden flex" aria-hidden="true">
                    <div className="bg-green-500" style={{ width: `${(d.delivered / d.total) * 100}%` }} />
                    <div className="bg-red-400" style={{ width: `${(d.failed / d.total) * 100}%` }} />
                    {done < d.total && d.late > 0 && (
                      <div className="bg-red-600" style={{ width: `${(d.late / d.total) * 100}%` }} />
                    )}
                    {done < d.total && d.atRisk > 0 && (
                      <div className="bg-amber-400" style={{ width: `${(d.atRisk / d.total) * 100}%` }} />
                    )}
                  </div>
                )}
                <Whereabouts d={d} isToday={isToday} now={now} />
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}

// "Last stop 25 min ago · Toko Abadi" / "Next: Toko Baru · planned 10:30 ·
// 15 min overdue". Elapsed and overdue times only mean something for today.
function Whereabouts({ d, isToday, now }: { d: TeamProgress; isToday: boolean; now: number }) {
  const { t } = useLanguage();
  const overdue =
    isToday && d.nextStop?.plannedEta ? minutesSince(d.nextStop.plannedEta, now) : 0;
  const finished = d.total > 0 && !d.nextStop;

  return (
    <div className="mt-2 space-y-0.5 text-xs text-gray-600">
      <div className="flex items-center gap-1.5 min-w-0">
        <MapPin size={12} className="shrink-0 text-gray-400" />
        <span className="truncate">
          {d.lastStop
            ? `${t(d.lastStop.status === 'FAILED' ? 'delivery.monitoring.lastFailed' : 'delivery.monitoring.lastDelivered', {
                place: d.lastStop.label,
              })} · ${
                isToday
                  ? t('delivery.monitoring.minutesAgo', { n: minutesSince(d.lastStop.at, now) })
                  : clock(d.lastStop.at)
              }`
            : d.plannedDepartureAt
              ? t('delivery.monitoring.notStartedDeparts', { time: clock(d.plannedDepartureAt) })
              : t('delivery.monitoring.notStarted')}
        </span>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <Navigation size={12} className="shrink-0 text-gray-400" />
        <span className="truncate">
          {finished
            ? t('delivery.monitoring.allDone')
            : d.nextStop
              ? t('delivery.monitoring.nextStop', { place: d.nextStop.label }) +
                (d.nextStop.plannedEta ? ` · ${t('delivery.monitoring.planned', { time: clock(d.nextStop.plannedEta) })}` : '')
              : '—'}
        </span>
        {overdue > 0 && !finished && (
          <span className="shrink-0 font-semibold text-red-600">
            {t('delivery.monitoring.overdue', { n: overdue })}
          </span>
        )}
      </div>
    </div>
  );
}
