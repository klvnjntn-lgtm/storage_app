'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { display } from '@/lib/fonts';
import { BarChart3, RefreshCw, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import DeliveryMap, { type MapStop } from '@/app/components/delivery/DeliveryMap';
import DatePicker from '@/app/components/shared/DatePicker';
import { driverLabel } from '@/app/components/delivery/DriverPicker';


type Summary = { total: number; delivered: number; pending: number; failed: number; atRisk: number };
type DriverProgress = Summary & { routeId: string; driver: { id: string; email: string; displayName: string | null } };
// Prisma Decimal fields serialize as strings over JSON, not numbers.
type MapStopRaw = { id: string; status: MapStop['status']; latitude: string; longitude: string; label: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// How often today's view refreshes itself while the tab is visible.
const REFRESH_MS = 30_000;

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 min-w-0">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-gray-500 truncate">{label}</div>
    </div>
  );
}

export default function DeliveryMonitoringPage() {
  const { t } = useLanguage();
  const [date, setDate] = useState(todayIso());
  const [summary, setSummary] = useState<Summary>({ total: 0, delivered: 0, pending: 0, failed: 0, atRisk: 0 });
  const [byDriver, setByDriver] = useState<DriverProgress[]>([]);
  const [mapStops, setMapStops] = useState<MapStop[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);
  const isToday = date === todayIso();

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
      const [summaryRes, driversRes, mapRes] = await Promise.all([
        apiFetch(`/delivery-routes/monitoring/summary?date=${date}`),
        apiFetch(`/delivery-routes/monitoring/drivers?date=${date}`),
        apiFetch(`/delivery-routes/monitoring/map?date=${date}`),
      ]);
      if (!summaryRes.ok || !driversRes.ok) {
        const body = await (summaryRes.ok ? driversRes : summaryRes).json().catch(() => null);
        setError(body?.message ?? t('delivery.monitoring.requestFailed', { status: summaryRes.status }));
        return;
      }
      setSummary(await summaryRes.json());
      setByDriver(await driversRes.json());
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Live mode for today: poll while the tab is visible, and catch up
  // immediately when the user comes back to it.
  useEffect(() => {
    if (!isToday) return;
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
  }, [date, isToday]);

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

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
              {t('delivery.monitoring.dateLabel')}
            </label>
            <DatePicker value={date} onChange={setDate} />
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

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
          <StatCard label={t('delivery.monitoring.total')} value={summary.total} tone="text-gray-900" />
          <StatCard label={t('delivery.monitoring.delivered')} value={summary.delivered} tone="text-green-600" />
          <StatCard label={t('delivery.monitoring.pending')} value={summary.pending} tone="text-amber-600" />
          <StatCard label={t('delivery.monitoring.failed')} value={summary.failed} tone="text-red-600" />
          <StatCard label={t('delivery.monitoring.atRisk')} value={summary.atRisk} tone="text-red-600" />
        </div>

        {mapStops.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">{t('delivery.monitoring.mapTitle')}</h2>
            <DeliveryMap stops={mapStops} />
          </div>
        )}

        <div className="space-y-2">
          <h2 className="text-sm font-semibold">{t('delivery.monitoring.byDriver')}</h2>
          {!loading && byDriver.length === 0 && (
            <p className="text-sm text-gray-500">{t('delivery.monitoring.noDrivers')}</p>
          )}
          {byDriver.map((d) => {
            const done = d.delivered + d.failed;
            return (
              <Link
                key={d.routeId}
                href={`/delivery/routes/${d.routeId}`}
                className="block bg-white rounded-lg border border-gray-200 p-3 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium truncate min-w-0">{driverLabel(d.driver)}</span>
                  <span className="text-xs text-gray-600 shrink-0 flex items-center gap-2">
                    {d.atRisk > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-red-600 font-semibold">
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
                    {done < d.total && d.atRisk > 0 && (
                      <div className="bg-amber-400" style={{ width: `${(d.atRisk / d.total) * 100}%` }} />
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
