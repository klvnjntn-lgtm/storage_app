'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { ArrowLeft, ArrowUp, ArrowDown, Trash2, Plus, CheckCircle2, XCircle, Circle, MapPin, X, Navigation, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import DeliveryMap, { type MapStop } from '@/app/components/delivery/DeliveryMap';


type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

type Stop = {
  id: string;
  sequence: number;
  status: StopStatus;
  plannedEta: string | null;
  atRisk: boolean;
  deliveryOrder: {
    id: string;
    doNumber: string | null;
    customerName: string | null;
    deliveryAddress: string | null;
    failureReason: string | null;
    // Prisma Decimal fields serialize as strings over JSON, not numbers.
    destinationLatitude: string | null;
    destinationLongitude: string | null;
    priority: 'NORMAL' | 'HIGH';
    deliveryWindowStart: string | null;
    deliveryWindowEnd: string | null;
  };
};

type HistoryEvent = {
  id: string;
  type: string;
  createdAt: string;
  createdBy: { id: string; email: string } | null;
};

type RouteDetail = {
  id: string;
  name: string | null;
  routeDate: string;
  status: string;
  driver: { id: string; email: string };
  stops: Stop[];
  currentStop: Stop | null;
  // Prisma Decimal/DateTime fields serialize as strings over JSON.
  startLatitude: string | null;
  startLongitude: string | null;
  plannedDepartureAt: string | null;
};

type AvailableOrder = { id: string; doNumber: string | null; customerName: string | null };

// datetime-local inputs want local "YYYY-MM-DDTHH:mm", not an ISO string.
function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatEta(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status: StopStatus, label: string) {
  const styles: Record<StopStatus, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-300',
    DELIVERED: 'bg-green-100 text-green-800 border-green-300',
    FAILED: 'bg-red-100 text-red-800 border-red-300',
  };
  const icons: Record<StopStatus, typeof CheckCircle2> = {
    PENDING: Circle,
    DELIVERED: CheckCircle2,
    FAILED: XCircle,
  };
  const Icon = icons[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${styles[status]}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}

export default function DeliveryRouteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { t } = useLanguage();
  const { user } = useCurrentUser();
  // Route mutation (reorder/add/remove/optimize/set-start) is ADMIN/USER-only
  // server-side (see delivery-routes.controller.ts) — hide those controls for
  // DRIVER so the UI doesn't offer actions that would now 403.
  const isDriver = user?.role === 'DRIVER';

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [availableOrders, setAvailableOrders] = useState<AvailableOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [showAddStop, setShowAddStop] = useState(false);

  const [pickingStop, setPickingStop] = useState<Stop | null>(null);
  const [pickingStart, setPickingStart] = useState(false);
  const [pickedPosition, setPickedPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);

  const [departureTime, setDepartureTime] = useState('');
  const [optimizing, setOptimizing] = useState(false);

  const [editingStop, setEditingStop] = useState<Stop | null>(null);
  const [editPriority, setEditPriority] = useState<'NORMAL' | 'HIGH'>('NORMAL');
  const [editWindowStart, setEditWindowStart] = useState('');
  const [editWindowEnd, setEditWindowEnd] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-routes/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      const data: RouteDetail = await res.json();
      setRoute(data);
      setDepartureTime((current) => current || toLocalInputValue(data.plannedDepartureAt));
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setLoading(false);
    }
  }

  async function loadAvailableOrders() {
    const [packedRes, shippedRes] = await Promise.all([
      apiFetch('/delivery-orders?status=PACKED&pageSize=100'),
      apiFetch('/delivery-orders?status=SHIPPED&pageSize=100'),
    ]);
    const packed = packedRes.ok ? (await packedRes.json()).data : [];
    const shipped = shippedRes.ok ? (await shippedRes.json()).data : [];
    setAvailableOrders([...packed, ...shipped]);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleAddStop() {
    if (!selectedOrderId) return;
    setBusy('add-stop');
    setError(null);
    try {
      const res = await apiFetch(`/delivery-routes/${id}/stops`, {
        method: 'POST',
        body: JSON.stringify({ deliveryOrderId: selectedOrderId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      setShowAddStop(false);
      setSelectedOrderId('');
      await load();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setBusy(null);
    }
  }

  async function handleMove(stop: Stop, direction: -1 | 1) {
    if (!route) return;
    const idx = route.stops.findIndex((s) => s.id === stop.id);
    const swapWith = route.stops[idx + direction];
    if (!swapWith) return;

    setBusy(stop.id);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-routes/${id}/stops/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({
          stops: route.stops.map((s) => {
            if (s.id === stop.id) return { stopId: s.id, sequence: swapWith.sequence };
            if (s.id === swapWith.id) return { stopId: s.id, sequence: stop.sequence };
            return { stopId: s.id, sequence: s.sequence };
          }),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      await load();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(stop: Stop) {
    if (!confirm(t('delivery.routeDetail.confirmRemove'))) return;
    setBusy(stop.id);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-routes/${id}/stops/${stop.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      await load();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setBusy(null);
    }
  }

  function openLocationPicker(stop: Stop) {
    setPickingStop(stop);
    setPickedPosition(
      stop.deliveryOrder.destinationLatitude && stop.deliveryOrder.destinationLongitude
        ? { lat: Number(stop.deliveryOrder.destinationLatitude), lng: Number(stop.deliveryOrder.destinationLongitude) }
        : null,
    );
  }

  async function handleSaveLocation() {
    if (!pickingStop || !pickedPosition) return;
    setSavingLocation(true);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-orders/${pickingStop.deliveryOrder.id}/destination`, {
        method: 'PATCH',
        body: JSON.stringify({ latitude: pickedPosition.lat, longitude: pickedPosition.lng }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      setPickingStop(null);
      await load();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setSavingLocation(false);
    }
  }

  function openStartPicker() {
    setPickingStart(true);
    setPickedPosition(
      route?.startLatitude && route.startLongitude
        ? { lat: Number(route.startLatitude), lng: Number(route.startLongitude) }
        : null,
    );
  }

  async function handleSaveStart() {
    if (!pickedPosition) return;
    setSavingLocation(true);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-routes/${id}/start`, {
        method: 'PATCH',
        body: JSON.stringify({ latitude: pickedPosition.lat, longitude: pickedPosition.lng }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      setPickingStart(false);
      await load();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setSavingLocation(false);
    }
  }

  async function handleOptimize() {
    setOptimizing(true);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-routes/${id}/optimize`, {
        method: 'POST',
        body: JSON.stringify({ departureAt: departureTime ? new Date(departureTime).toISOString() : undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      await load();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setOptimizing(false);
    }
  }

  function openEditDetails(stop: Stop) {
    setEditingStop(stop);
    setEditPriority(stop.deliveryOrder.priority);
    setEditWindowStart(toLocalInputValue(stop.deliveryOrder.deliveryWindowStart));
    setEditWindowEnd(toLocalInputValue(stop.deliveryOrder.deliveryWindowEnd));
  }

  async function handleSaveDetails() {
    if (!editingStop) return;
    setSavingDetails(true);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-orders/${editingStop.deliveryOrder.id}/details`, {
        method: 'PATCH',
        body: JSON.stringify({
          priority: editPriority,
          deliveryWindowStart: editWindowStart ? new Date(editWindowStart).toISOString() : undefined,
          deliveryWindowEnd: editWindowEnd ? new Date(editWindowEnd).toISOString() : undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      setEditingStop(null);
      await load();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleReschedule(stop: Stop) {
    if (!confirm(t('delivery.routeDetail.rescheduleConfirm'))) return;
    setReschedulingId(stop.id);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-orders/${stop.deliveryOrder.id}/reschedule`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      await load();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setReschedulingId(null);
    }
  }

  async function loadHistory() {
    const res = await apiFetch(`/delivery-routes/${id}/history`);
    if (res.ok) setHistory(await res.json());
  }

  if (loading) {
    return <p className="text-sm text-gray-500 p-6">{t('common.loading')}</p>;
  }
  if (!route) {
    return <p className="text-sm text-red-600 p-6">{error}</p>;
  }

  const statusLabels: Record<StopStatus, string> = {
    PENDING: t('delivery.routeDetail.statusLabel.PENDING'),
    DELIVERED: t('delivery.routeDetail.statusLabel.DELIVERED'),
    FAILED: t('delivery.routeDetail.statusLabel.FAILED'),
  };

  return (
    <div className="min-h-screen bg-gray-50 text-black">
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/delivery/routes')}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-700 mb-1"
          >
            <ArrowLeft size={12} />
            {t('delivery.routeDetail.backToRoutes')}
          </button>
          <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight`}>
            {route.name ?? new Date(route.routeDate).toLocaleDateString()}
          </h1>
          <p className="text-xs text-gray-500">{route.driver.email}</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>
        )}

        {route.stops.some((s) => s.deliveryOrder.destinationLatitude && s.deliveryOrder.destinationLongitude) && (
          <DeliveryMap
            stops={route.stops
              .filter((s) => s.deliveryOrder.destinationLatitude && s.deliveryOrder.destinationLongitude)
              .map<MapStop>((s) => ({
                id: s.id,
                status: s.status,
                latitude: Number(s.deliveryOrder.destinationLatitude),
                longitude: Number(s.deliveryOrder.destinationLongitude),
                label: s.deliveryOrder.customerName ?? s.deliveryOrder.doNumber ?? s.deliveryOrder.id,
              }))}
          />
        )}

        {!isDriver && (
          <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm flex flex-wrap items-end gap-3">
            <button
              onClick={openStartPicker}
              className={`flex items-center gap-1.5 text-sm font-medium border rounded-md px-3 py-1.5 ${
                route.startLatitude ? 'border-blue-200 text-blue-700' : 'border-gray-300'
              }`}
            >
              <MapPin size={14} />
              {t('delivery.routeDetail.setStart')}
            </button>
            <div>
              <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('delivery.routeDetail.departureTimeLabel')}
              </label>
              <input
                type="datetime-local"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm"
              />
            </div>
            <button
              disabled={optimizing || !route.startLatitude || route.stops.every((s) => s.status !== 'PENDING')}
              onClick={handleOptimize}
              title={!route.startLatitude ? t('delivery.routeDetail.setStart') : undefined}
              className="flex items-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-md px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50"
            >
              <Navigation size={14} />
              {optimizing ? t('delivery.routeDetail.optimizing') : t('delivery.routeDetail.optimizeRoute')}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('delivery.routeDetail.stopsTitle')}</h2>
          {!isDriver && (
            <button
              onClick={async () => {
                setShowAddStop((v) => !v);
                if (!showAddStop) await loadAvailableOrders();
              }}
              className="flex items-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-md px-3 py-1.5 hover:bg-blue-700"
            >
              <Plus size={14} />
              {t('delivery.routeDetail.addStop')}
            </button>
          )}
        </div>

        {!isDriver && showAddStop && (
          <div className="border border-blue-500/15 rounded-xl p-3 bg-white shadow-sm flex flex-wrap items-end gap-3">
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm min-w-[220px]"
            >
              <option value="">{t('delivery.routeDetail.selectDeliveryOrder')}</option>
              {availableOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.doNumber ?? o.id} — {o.customerName ?? '—'}
                </option>
              ))}
            </select>
            {availableOrders.length === 0 && (
              <p className="text-xs text-gray-500">{t('delivery.routeDetail.noAvailableOrders')}</p>
            )}
            <button
              disabled={busy === 'add-stop' || !selectedOrderId}
              onClick={handleAddStop}
              className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
            >
              {busy === 'add-stop' ? t('delivery.routeDetail.adding') : t('delivery.routeDetail.add')}
            </button>
          </div>
        )}

        <div className="space-y-2">
          {route.stops.length === 0 && <p className="text-sm text-gray-500">{t('delivery.routeDetail.noStops')}</p>}
          {route.stops.map((stop, idx) => {
            const isCurrent = route.currentStop?.id === stop.id;
            const rowBusy = busy === stop.id;
            return (
              <div
                key={stop.id}
                className={`bg-white rounded-lg border p-3 flex items-center justify-between gap-3 ${isCurrent ? 'border-blue-400 ring-1 ring-blue-100' : 'border-gray-200'}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="text-xs text-gray-400 font-medium w-6 shrink-0">#{stop.sequence}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {stop.deliveryOrder.customerName ?? stop.deliveryOrder.doNumber ?? stop.deliveryOrder.id}
                    </div>
                    {stop.deliveryOrder.deliveryAddress && (
                      <div className="text-xs text-gray-500 truncate">{stop.deliveryOrder.deliveryAddress}</div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {isCurrent && (
                        <span className="text-[10px] text-blue-600 font-medium">
                          {t('delivery.routeDetail.currentStopBadge')}
                        </span>
                      )}
                      {stop.deliveryOrder.priority === 'HIGH' && (
                        <span className="text-[10px] bg-purple-100 text-purple-800 border border-purple-300 rounded-full px-1.5 font-medium">
                          {t('delivery.routeDetail.priorityHigh')}
                        </span>
                      )}
                      {stop.plannedEta && (
                        <span className="text-[10px] text-gray-500 font-medium">
                          {t('delivery.routeDetail.eta')} {formatEta(stop.plannedEta)}
                        </span>
                      )}
                      {stop.deliveryOrder.deliveryWindowEnd && (
                        <span className="text-[10px] text-gray-500 font-medium">
                          {t('delivery.routeDetail.windowEndLabel')} {formatEta(stop.deliveryOrder.deliveryWindowEnd)}
                        </span>
                      )}
                      {stop.atRisk && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-red-600 font-medium">
                          <AlertTriangle size={10} />
                          {t('delivery.routeDetail.atRisk')}
                        </span>
                      )}
                    </div>

                    {editingStop?.id === stop.id && (
                      <div className="mt-2 p-2 border border-gray-200 rounded-md bg-gray-50 flex flex-wrap items-end gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                            {t('delivery.routeDetail.priorityLabel')}
                          </label>
                          <select
                            value={editPriority}
                            onChange={(e) => setEditPriority(e.target.value as 'NORMAL' | 'HIGH')}
                            className="border border-gray-300 rounded-md px-2 py-1 text-xs"
                          >
                            <option value="NORMAL">{t('delivery.routeDetail.priorityNormal')}</option>
                            <option value="HIGH">{t('delivery.routeDetail.priorityHigh')}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                            {t('delivery.routeDetail.windowStartLabel')}
                          </label>
                          <input
                            type="datetime-local"
                            value={editWindowStart}
                            onChange={(e) => setEditWindowStart(e.target.value)}
                            className="border border-gray-300 rounded-md px-2 py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                            {t('delivery.routeDetail.windowEndLabel')}
                          </label>
                          <input
                            type="datetime-local"
                            value={editWindowEnd}
                            onChange={(e) => setEditWindowEnd(e.target.value)}
                            className="border border-gray-300 rounded-md px-2 py-1 text-xs"
                          />
                        </div>
                        <button
                          onClick={() => setEditingStop(null)}
                          className="text-xs font-medium border border-gray-300 rounded-md px-2 py-1"
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          disabled={savingDetails}
                          onClick={handleSaveDetails}
                          className="text-xs font-medium bg-blue-600 text-white rounded-md px-2 py-1 disabled:opacity-50"
                        >
                          {savingDetails ? t('common.saving') : t('delivery.routeDetail.saveDetails')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {statusBadge(stop.status, statusLabels[stop.status])}
                  <button
                    onClick={() => openEditDetails(stop)}
                    className="text-[11px] font-medium text-blue-600 border border-blue-200 rounded px-1.5 py-0.5"
                  >
                    {t('delivery.routeDetail.editDetails')}
                  </button>
                  {stop.status === 'FAILED' && (
                    <button
                      disabled={reschedulingId === stop.id}
                      onClick={() => handleReschedule(stop)}
                      className="text-[11px] font-medium text-amber-700 border border-amber-300 rounded px-1.5 py-0.5 disabled:opacity-50"
                    >
                      {reschedulingId === stop.id
                        ? t('delivery.routeDetail.rescheduling')
                        : t('delivery.routeDetail.reschedule')}
                    </button>
                  )}
                  <button
                    onClick={() => openLocationPicker(stop)}
                    aria-label={t('delivery.routeDetail.setLocation')}
                    className={`p-1 rounded border ${
                      stop.deliveryOrder.destinationLatitude
                        ? 'border-blue-200 text-blue-600'
                        : 'border-gray-200 text-gray-400'
                    }`}
                  >
                    <MapPin size={12} />
                  </button>
                  {!isDriver && (
                    <>
                      <button
                        disabled={rowBusy || idx === 0}
                        onClick={() => handleMove(stop, -1)}
                        aria-label={t('delivery.routeDetail.moveUp')}
                        className="p-1 rounded border border-gray-200 disabled:opacity-30"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        disabled={rowBusy || idx === route.stops.length - 1}
                        onClick={() => handleMove(stop, 1)}
                        aria-label={t('delivery.routeDetail.moveDown')}
                        className="p-1 rounded border border-gray-200 disabled:opacity-30"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        disabled={rowBusy}
                        onClick={() => handleRemove(stop)}
                        aria-label={t('delivery.routeDetail.remove')}
                        className="p-1 rounded border border-red-200 text-red-600 disabled:opacity-30"
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <button
            onClick={async () => {
              setShowHistory((v) => !v);
              if (!showHistory) await loadHistory();
            }}
            className="text-sm font-semibold text-gray-600"
          >
            {t('delivery.routeDetail.historyTitle')} {showHistory ? '▾' : '▸'}
          </button>
          {showHistory && (
            <div className="mt-2 space-y-1.5">
              {history.length === 0 && <p className="text-xs text-gray-500">{t('delivery.routeDetail.historyEmpty')}</p>}
              {history.map((h) => (
                <div key={h.id} className="text-xs text-gray-600 flex items-center justify-between border-b border-gray-100 pb-1.5">
                  <span>{t(`delivery.routeDetail.historyType.${h.type}`)}</span>
                  <span className="text-gray-400">
                    {h.createdBy?.email ?? '—'} · {new Date(h.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {(pickingStop || pickingStart) && (
        <div className="fixed inset-0 bg-black/25 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {t(pickingStart ? 'delivery.routeDetail.pickStartTitle' : 'delivery.routeDetail.pickLocationTitle')}
              </h3>
              <button
                onClick={() => {
                  setPickingStop(null);
                  setPickingStart(false);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            </div>
            <DeliveryMap
              // Shown as context/centering only, not editable here — keeps
              // the picker from defaulting to the Jakarta fallback center
              // when the route's actual stops are somewhere else entirely.
              stops={route.stops
                .filter((s) => s.deliveryOrder.destinationLatitude && s.deliveryOrder.destinationLongitude)
                .map<MapStop>((s) => ({
                  id: s.id,
                  status: s.status,
                  latitude: Number(s.deliveryOrder.destinationLatitude),
                  longitude: Number(s.deliveryOrder.destinationLongitude),
                  label: s.deliveryOrder.customerName ?? s.deliveryOrder.doNumber ?? s.deliveryOrder.id,
                }))}
              height={280}
              pickMode
              pickedPosition={pickedPosition}
              onPick={(lat, lng) => setPickedPosition({ lat, lng })}
            />
            {!pickedPosition && <p className="text-xs text-gray-500">{t('delivery.routeDetail.noLocationSet')}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setPickingStop(null);
                  setPickingStart(false);
                }}
                className="text-sm font-medium border border-gray-300 rounded-md px-3 py-1.5"
              >
                {t('common.cancel')}
              </button>
              <button
                disabled={!pickedPosition || savingLocation}
                onClick={pickingStart ? handleSaveStart : handleSaveLocation}
                className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
              >
                {savingLocation ? t('common.saving') : t('delivery.routeDetail.saveLocation')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
