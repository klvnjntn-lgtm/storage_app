'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { ArrowLeft, Sparkles, Lock, MapPinOff, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import DatePicker from '@/app/components/shared/DatePicker';
import DeliveryMap, { type MapStop } from '@/app/components/delivery/DeliveryMap';
import CoordinateInputs from '@/app/components/delivery/CoordinateInputs';
import GoogleMapsLink from '@/app/components/delivery/GoogleMapsLink';
import { DriverAvatar, driverLabel } from '@/app/components/delivery/DriverPicker';
import { teamLabel } from '@/app/components/delivery/TeamPicker';
import type { PlanCandidates, PlanPreview } from '@/app/components/delivery/plan-types';

// One color per team in the preview (list swatch + map dots).
const DRIVER_COLORS = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#4b5563'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

const sectionClass = 'border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm';
const labelClass = 'block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1';

export default function RoutePlanPage() {
  return (
    <Suspense fallback={null}>
      <RoutePlanInner />
    </Suspense>
  );
}

function RoutePlanInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const [date, setDate] = useState(searchParams.get('date') || todayIso());
  const [departureTime, setDepartureTime] = useState('');
  const [depot, setDepot] = useState<{ lat: number; lng: number } | null>(null);

  const [candidates, setCandidates] = useState<PlanCandidates | null>(null);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [orderIds, setOrderIds] = useState<Set<string>>(new Set());

  // The preview plus the inputs it was computed from — shown only while
  // the inputs still match, so any change makes it stale.
  const [previewState, setPreviewState] = useState<{ key: string; data: PlanPreview } | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/delivery-routes/plan/candidates?routeDate=${date}`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
          return;
        }
        const c = body as PlanCandidates;
        setCandidates(c);
        // Plannable by default: has a driver, on duty, route not started yet.
        setTeamIds(new Set(c.teams.filter((x) => x.driver && !x.offDuty && !x.routes.some((r) => r.locked)).map((x) => x.id)));
        setOrderIds(new Set(c.deliveryOrders.filter((o) => o.hasPin).map((o) => o.id)));
        setDepot((prev) => prev ?? (c.defaultDepot ? { lat: c.defaultDepot.latitude, lng: c.defaultDepot.longitude } : null));
      } catch {
        if (!cancelled) setError(t('delivery.routeDetail.couldNotReachServer'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const teamName = useMemo(() => {
    const map = new Map((candidates?.teams ?? []).map((x) => [x.id, x.name]));
    return (id: string) => map.get(id) ?? '—';
  }, [candidates]);

  function toggle(set: Set<string>, id: string, update: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  }

  function planInput() {
    return {
      routeDate: date,
      departureAt: departureTime ? new Date(`${date}T${departureTime}`).toISOString() : undefined,
      depot: depot ? { latitude: depot.lat, longitude: depot.lng } : undefined,
      teamIds: [...teamIds],
      deliveryOrderIds: [...orderIds],
    };
  }

  const inputKey = JSON.stringify(planInput());
  const preview = previewState?.key === inputKey ? previewState.data : null;

  async function handlePreview() {
    if (!depot) return setError(t('delivery.plan.needDepot'));
    if (teamIds.size === 0) return setError(t('delivery.plan.needTeam'));
    if (orderIds.size === 0) return setError(t('delivery.plan.needDelivery'));
    setPreviewing(true);
    setError(null);
    try {
      const res = await apiFetch('/delivery-routes/plan/preview', {
        method: 'POST',
        body: JSON.stringify(planInput()),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      setPreviewState({ key: inputKey, data: body as PlanPreview });
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSave() {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/delivery-routes/plan', {
        method: 'POST',
        body: JSON.stringify({
          ...planInput(),
          routes: preview.routes.map((r) => ({
            teamId: r.team.id,
            deliveryOrderIds: r.stops.map((s) => s.deliveryOrderId),
          })),
          expectedVersions: preview.expectedVersions,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      router.push(`/delivery/routes?date=${date}`);
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setSaving(false);
    }
  }

  const colorOf = (teamId: string) => {
    const i = preview?.routes.findIndex((r) => r.team.id === teamId) ?? -1;
    return DRIVER_COLORS[Math.max(0, i) % DRIVER_COLORS.length];
  };

  const previewMapStops: MapStop[] = (preview?.routes ?? []).flatMap((r) =>
    r.stops.map((s) => ({
      id: s.deliveryOrderId,
      status: 'PENDING' as const,
      latitude: s.latitude,
      longitude: s.longitude,
      label: `${s.sequence}. ${s.customerName ?? s.doNumber ?? ''}`,
      color: colorOf(r.team.id),
    })),
  );

  const unassignedCount = preview?.unassigned.length ?? 0;

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
        <div className="max-w-5xl mx-auto flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => router.push(`/delivery/routes?date=${date}`)}
            aria-label="Back"
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 hover:bg-gray-50 shrink-0"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
            <Sparkles size={18} strokeWidth={2} className="text-blue-700" />
          </span>
          <div className="min-w-0">
            <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
              {t('delivery.plan.title')}
            </h1>
            <p className="text-xs text-gray-500 truncate">{t('delivery.plan.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>
        )}

        {/* Settings */}
        <div className={`${sectionClass} space-y-3`}>
          <h2 className="text-sm font-semibold">{t('delivery.plan.settings')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t('delivery.plan.dateLabel')}</label>
              <DatePicker value={date} onChange={setDate} />
            </div>
            <div>
              <label className={labelClass}>{t('delivery.plan.departureLabel')}</label>
              <input
                type="time"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">{t('delivery.plan.departureHint')}</p>
            </div>
          </div>
          <div>
            <label className={labelClass}>{t('delivery.plan.depotLabel')}</label>
            <p className="text-xs text-gray-500 mb-2">{t('delivery.plan.depotHint')}</p>
            <DeliveryMap
              stops={[]}
              height={220}
              pickMode
              pickedPosition={depot}
              onPick={(lat, lng) => setDepot({ lat, lng })}
            />
            <div className="mt-2">
              <CoordinateInputs value={depot} onChange={setDepot} />
            </div>
          </div>
        </div>

        {loading && <p className="text-sm text-gray-500">…</p>}

        {candidates && (
          <>
            {/* Teams */}
            <div className={sectionClass}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold">{t('delivery.plan.teamsLabel')}</h2>
                <span className="text-xs text-gray-500">
                  {t('delivery.plan.selectedCount', { count: teamIds.size })}
                </span>
              </div>
              {candidates.teams.length === 0 && (
                <p className="text-xs text-gray-400">{t('delivery.plan.noTeams')}</p>
              )}
              <div className="divide-y divide-gray-100">
                {candidates.teams.map((d) => {
                  const locked = d.routes.filter((r) => r.locked).length;
                  const planned = d.routes.filter((r) => !r.locked).length;
                  // No driver, or today's route already started (one route
                  // per team per day) — can't be planned.
                  const unavailable = !d.driver || locked > 0;
                  return (
                    <label key={d.id} className={`flex items-start gap-2.5 py-2 ${unavailable ? 'opacity-60' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={teamIds.has(d.id)}
                        disabled={unavailable}
                        onChange={() => toggle(teamIds, d.id, setTeamIds)}
                        className="mt-1"
                      />
                      {d.driver && <DriverAvatar driver={d.driver} size={24} />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{d.name}</p>
                        <p className={`text-xs truncate ${d.driver ? 'text-gray-500' : 'text-amber-700'}`}>
                          {d.driver ? driverLabel(d.driver) : t('delivery.teams.noDriver')}
                        </p>
                        <p className={`text-xs ${d.offDuty ? 'text-amber-700' : 'text-gray-500'}`}>
                          {d.offDuty ? t('delivery.plan.offDuty') : (d.hours ?? t('delivery.plan.hoursUnrestricted'))}
                        </p>
                        {locked > 0 && (
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Lock size={11} /> {t('delivery.plan.lockedRoutes', { count: locked })}
                          </p>
                        )}
                        {planned > 0 && (
                          <p className="text-xs text-gray-500">{t('delivery.plan.plannedRoutes', { count: planned })}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Deliveries */}
            <div className={sectionClass}>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <h2 className="text-sm font-semibold">{t('delivery.plan.deliveriesLabel')}</h2>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">{t('delivery.plan.selectedCount', { count: orderIds.size })}</span>
                  <button
                    onClick={() => setOrderIds(new Set(candidates.deliveryOrders.filter((o) => o.hasPin).map((o) => o.id)))}
                    className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                  >
                    {t('delivery.plan.selectAll')}
                  </button>
                  <button
                    onClick={() => setOrderIds(new Set())}
                    className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                  >
                    {t('delivery.plan.selectNone')}
                  </button>
                </div>
              </div>
              {candidates.deliveryOrders.length === 0 && (
                <p className="text-xs text-gray-400">{t('delivery.plan.noDeliveries')}</p>
              )}
              <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
                {candidates.deliveryOrders.map((o) => (
                  <label key={o.id} className="flex items-start gap-2.5 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={orderIds.has(o.id)}
                      onChange={() => toggle(orderIds, o.id, setOrderIds)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium">{o.customerName ?? o.doNumber ?? o.id}</span>
                        {o.doNumber && o.customerName && <span className="text-xs text-gray-500">{o.doNumber}</span>}
                        {o.priority === 'HIGH' && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-300">
                            {t('delivery.routeDetail.priorityHigh')}
                          </span>
                        )}
                        {!o.hasPin && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-300">
                            <MapPinOff size={10} /> {t('delivery.plan.noPin')}
                          </span>
                        )}
                      </div>
                      {(o.deliveryWindowStart || o.deliveryWindowEnd) && (
                        <p className="text-xs text-gray-500">
                          {formatTime(o.deliveryWindowStart)}–{formatTime(o.deliveryWindowEnd)}
                        </p>
                      )}
                      {o.currentRoute && (
                        <p className="text-xs text-gray-500">
                          {t('delivery.plan.onRoute', { driver: teamName(o.currentRoute.teamId) })}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handlePreview}
              disabled={previewing}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-md px-4 py-2.5 hover:bg-blue-700 disabled:opacity-50"
            >
              <Sparkles size={14} />
              {previewing ? t('delivery.plan.previewing') : t('delivery.plan.preview')}
            </button>
          </>
        )}

        {/* Preview */}
        {preview && (
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">{t('delivery.plan.previewTitle')}</h2>
              <p className="text-xs text-gray-500">{t('delivery.plan.etaNote')}</p>
            </div>

            {previewMapStops.length > 0 && <DeliveryMap stops={previewMapStops} height={320} />}

            {preview.routes.map((r) => (
              <div key={r.team.id} className={sectionClass}>
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-1 w-3 h-3 rounded-full shrink-0"
                    style={{ background: colorOf(r.team.id) }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{teamLabel(r.team, t('delivery.teams.noDriver'))}</p>
                    <p className="text-xs text-gray-500">
                      {r.existingRouteId ? t('delivery.plan.updatesRoute') : t('delivery.plan.newRoute')}
                      {r.stops.length > 0 && (
                        <>
                          {' · '}
                          {t('delivery.plan.departs')} {formatTime(r.departureAt)} · {t('delivery.plan.finishes')}{' '}
                          {formatTime(r.finishEta)} · {(r.totalMeters / 1000).toFixed(1)} km ·{' '}
                          {formatDuration(r.totalSeconds)}
                        </>
                      )}
                    </p>
                  </div>
                </div>
                {r.stops.length === 0 ? (
                  <p className="text-xs text-gray-400 mt-2">
                    {r.offDuty ? t('delivery.plan.offDuty') : t('delivery.plan.noStopsForDriver')}
                  </p>
                ) : (
                  <ol className="mt-2 divide-y divide-gray-100">
                    {r.stops.map((s) => (
                      <li key={s.deliveryOrderId} className="flex items-start gap-2.5 py-2">
                        <span className="text-xs font-semibold tabular-nums w-5 text-right text-gray-500 mt-0.5">
                          {s.sequence}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium">{s.customerName ?? s.doNumber}</span>
                            {s.priority === 'HIGH' && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-300">
                                {t('delivery.routeDetail.priorityHigh')}
                              </span>
                            )}
                            {s.movedFromRouteId && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-blue-50 text-blue-800 border-blue-300">
                                <ArrowRightLeft size={10} /> {t('delivery.plan.moved')}
                              </span>
                            )}
                          </div>
                          {s.deliveryAddress && (
                            <p className="text-xs text-gray-500 line-clamp-1">{s.deliveryAddress}</p>
                          )}
                          <GoogleMapsLink lat={s.latitude} lng={s.longitude} />
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm tabular-nums">{formatTime(s.eta)}</p>
                          {s.travelSeconds != null && (
                            <p className="text-[11px] text-gray-500 tabular-nums">
                              +{formatDuration(s.travelSeconds)}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}

            {unassignedCount > 0 && (
              <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-3 sm:p-4">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {t('delivery.plan.unassignedTitle', { count: unassignedCount })}
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs space-y-0.5">
                  {preview.unassigned.map((u) => (
                    <li key={u.deliveryOrderId}>
                      {u.label}
                      {u.priority === 'HIGH' && ` (${t('delivery.routeDetail.priorityHigh')})`} —{' '}
                      {t(`delivery.plan.reason.${u.reason}`)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.removedDeliveryOrderIds.length > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 sm:p-4">
                <p className="text-sm font-semibold">
                  {t('delivery.plan.removedTitle', { count: preview.removedDeliveryOrderIds.length })}
                </p>
                <p className="text-xs text-gray-600">{t('delivery.plan.removedHint')}</p>
              </div>
            )}

            {preview.cancelledRouteIds.length > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 sm:p-4 text-sm">
                {t('delivery.plan.cancelledTitle', { count: preview.cancelledRouteIds.length })}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full sm:w-auto text-sm font-medium bg-green-600 text-white rounded-md px-4 py-2.5 hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? t('delivery.plan.saving') : t('delivery.plan.save')}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
