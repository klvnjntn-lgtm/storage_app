'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { ArrowUp, ArrowDown, Trash2, Plus, CheckCircle2, XCircle, Circle, MapPin, MapPinOff, X, Navigation, AlertTriangle, Check, Users, CalendarClock, Store, Truck } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import DeliveryMap, { type MapStop } from '@/app/components/delivery/DeliveryMap';
import CoordinateInputs from '@/app/components/delivery/CoordinateInputs';
import GoogleMapsLink from '@/app/components/delivery/GoogleMapsLink';
import ProofPhoto from '@/app/components/delivery/ProofPhoto';
import { DeliveryFixBadge } from '@/app/components/delivery/PinStatus';
import type { UnscheduledReason } from '@/app/components/delivery/plan-types';
import { driverLabel } from '@/app/components/delivery/DriverPicker';
import TeamPicker, { teamLabel, toPickerTeam, type PickerTeam } from '@/app/components/delivery/TeamPicker';
import CustomerStopPicker, { type StopCustomer } from '@/app/components/delivery/CustomerStopPicker';
import DatePicker from '@/app/components/shared/DatePicker';
import { useCustomerAddresses } from '@/app/components/delivery/CustomerAddressPicker';
import { useHasModule } from '@/lib/hooks/useHasModule';
import DateTimePicker from '@/app/components/shared/DateTimePicker';


type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

// One shape for both stop kinds (see DeliveryRoutesService.presentStop):
// a DO stop or a customer visit (orgs without INVOICE_POS). Top-level
// fields are the stop's target; `deliveryOrder` is only set on DO stops.
type Stop = {
  id: string;
  sequence: number;
  status: StopStatus;
  plannedEta: string | null;
  atRisk: boolean;
  late: boolean;
  superseded: boolean;
  kind: 'DELIVERY_ORDER' | 'CUSTOMER';
  label: string;
  customerId: string | null;
  customerName: string | null;
  doNumber: string | null;
  address: string | null;
  // Saved-address name for a customer stop ("Gudang Timur"); null = main address.
  addressLabel: string | null;
  // Prisma Decimal fields serialize as strings over JSON, not numbers.
  destinationLatitude: string | null;
  destinationLongitude: string | null;
  priority: 'NORMAL' | 'HIGH';
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  receivedBy: string | null;
  hasProofPhoto: boolean;
  // Where the driver marked it delivered (Decimal → string) and how good
  // that GPS fix was, in metres.
  completedLatitude: string | null;
  completedLongitude: string | null;
  completedAccuracy: number | null;
  failureReason: string | null;
  deliveryOrder: { id: string } | null;
};

type HistoryEvent = {
  id: string;
  type: string;
  createdAt: string;
  createdBy: { id: string; email: string; displayName: string | null } | null;
  // Stop-changing events carry the route version they produced and a
  // snapshot of the stop order at that version (see recordHistory).
  metadata: {
    version?: number;
    stops?: { sequence: number; label: string | null; superseded: boolean }[];
  } | null;
};

type RouteOption = { id: string; name: string | null; status: string; team: PickerTeam };

type RouteDetail = {
  id: string;
  name: string | null;
  routeDate: string;
  status: string;
  team: PickerTeam;
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
  const { t } = useLanguage();
  const { user } = useCurrentUser();
  // Route mutation (reorder/add/remove/optimize/set-start) is ADMIN/USER-only
  // server-side (see delivery-routes.controller.ts) — hide those controls for
  // DRIVER so the UI doesn't offer actions that would now 403.
  const isDriver = user?.role === 'DRIVER';
  // With INVOICE_POS every stop is a delivery order; without it, stops
  // are picked from the customer list (DOs still allowed if the org has any).
  const hasInvoicePos = useHasModule('INVOICE_POS');

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [availableOrders, setAvailableOrders] = useState<AvailableOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [showAddStop, setShowAddStop] = useState(false);
  const [addMode, setAddMode] = useState<'CUSTOMER' | 'DELIVERY_ORDER'>('CUSTOMER');
  const [selectedCustomer, setSelectedCustomer] = useState<StopCustomer | null>(null);
  // '' = the customer's main address, else one of their saved addresses.
  const [newStopAddressId, setNewStopAddressId] = useState('');
  const [newStopPriority, setNewStopPriority] = useState<'NORMAL' | 'HIGH'>('NORMAL');
  const [newStopWindowStart, setNewStopWindowStart] = useState('');
  const [newStopWindowEnd, setNewStopWindowEnd] = useState('');
  const stopMode = hasInvoicePos ? 'DELIVERY_ORDER' : addMode;

  const [pickingStop, setPickingStop] = useState<Stop | null>(null);
  const [pickingStart, setPickingStart] = useState(false);
  const [pickedPosition, setPickedPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const { addresses: savedAddresses } = useCustomerAddresses(pickingStop?.customerId);
  const { addresses: newStopAddresses } = useCustomerAddresses(selectedCustomer?.id);

  const [departureTime, setDepartureTime] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  // Stops the last optimize couldn't fit (kept at the end of the route).
  const [unscheduled, setUnscheduled] = useState<{ stopId: string; label: string; reason: UnscheduledReason }[]>([]);
  // Stop shown on the route map (from clicking its card); nonce re-triggers
  // the fly-to when the same card is clicked again.
  const [mapFocus, setMapFocus] = useState<{ stopId: string; nonce: number } | null>(null);
  const mapBoxRef = useRef<HTMLDivElement>(null);

  function focusStopOnMap(stopId: string) {
    setMapFocus((prev) => ({ stopId, nonce: (prev?.nonce ?? 0) + 1 }));
    mapBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const [editingStop, setEditingStop] = useState<Stop | null>(null);
  const [editPriority, setEditPriority] = useState<'NORMAL' | 'HIGH'>('NORMAL');
  const [editWindowStart, setEditWindowStart] = useState('');
  const [editWindowEnd, setEditWindowEnd] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  const [changingTeam, setChangingTeam] = useState(false);
  const [teams, setTeams] = useState<PickerTeam[]>([]);
  const [savingTeam, setSavingTeam] = useState(false);

  const [rescheduleStop, setRescheduleStop] = useState<Stop | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleRoutes, setRescheduleRoutes] = useState<RouteOption[]>([]);
  const [rescheduleRouteId, setRescheduleRouteId] = useState('');
  const [rescheduleWindowStart, setRescheduleWindowStart] = useState('');
  const [rescheduleWindowEnd, setRescheduleWindowEnd] = useState('');

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
    const payload =
      stopMode === 'CUSTOMER'
        ? selectedCustomer && {
            customerId: selectedCustomer.id,
            customerAddressId: newStopAddressId || undefined,
            priority: newStopPriority,
            deliveryWindowStart: newStopWindowStart ? new Date(newStopWindowStart).toISOString() : undefined,
            deliveryWindowEnd: newStopWindowEnd ? new Date(newStopWindowEnd).toISOString() : undefined,
          }
        : selectedOrderId && { deliveryOrderId: selectedOrderId };
    if (!payload) return;
    setBusy('add-stop');
    setError(null);
    try {
      const res = await apiFetch(`/delivery-routes/${id}/stops`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      setShowAddStop(false);
      setSelectedOrderId('');
      setSelectedCustomer(null);
      setNewStopAddressId('');
      setNewStopPriority('NORMAL');
      setNewStopWindowStart('');
      setNewStopWindowEnd('');
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
      stop.destinationLatitude && stop.destinationLongitude
        ? { lat: Number(stop.destinationLatitude), lng: Number(stop.destinationLongitude) }
        : null,
    );
  }

  // For a customer stop this changes the pin on this route only — the
  // customer's own pin stays as it is (see setStopDestination).
  async function saveStopPin(stop: Stop, position: { lat: number; lng: number }) {
    setSavingLocation(true);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-routes/${id}/stops/${stop.id}/destination`, {
        method: 'PATCH',
        body: JSON.stringify({ latitude: position.lat, longitude: position.lng }),
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

  async function handleSaveLocation() {
    if (!pickingStop || !pickedPosition) return;
    await saveStopPin(pickingStop, pickedPosition);
  }

  async function handleApplySavedAddress(customerAddressId: string | undefined) {
    if (!pickingStop) return;
    // A DO stop changes address on its delivery order; a customer stop on
    // the stop itself. Either way the address text, name and pin change
    // together. customerAddressId undefined = back to the main address.
    const url = pickingStop.deliveryOrder
      ? `/delivery-orders/${pickingStop.deliveryOrder.id}/address`
      : `/delivery-routes/${id}/stops/${pickingStop.id}/address`;
    setSavingLocation(true);
    setError(null);
    try {
      const res = await apiFetch(url, {
        method: 'PATCH',
        body: JSON.stringify({ customerAddressId }),
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
    setUnscheduled([]);
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
      setUnscheduled(body?.unscheduled ?? []);
      await load();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setOptimizing(false);
    }
  }

  function openEditDetails(stop: Stop) {
    setEditingStop(stop);
    setEditPriority(stop.priority);
    setEditWindowStart(toLocalInputValue(stop.deliveryWindowStart));
    setEditWindowEnd(toLocalInputValue(stop.deliveryWindowEnd));
  }

  async function handleSaveDetails() {
    if (!editingStop) return;
    setSavingDetails(true);
    setError(null);
    try {
      // A DO stop's details live on its delivery order; a customer stop's on the stop.
      const url = editingStop.deliveryOrder
        ? `/delivery-orders/${editingStop.deliveryOrder.id}/details`
        : `/delivery-routes/${id}/stops/${editingStop.id}/details`;
      const res = await apiFetch(url, {
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

  async function loadRescheduleRoutes(date: string) {
    setRescheduleRouteId('');
    setRescheduleRoutes([]);
    if (!date) return;
    const res = await apiFetch(`/delivery-routes?date=${date}`);
    if (res.ok) {
      const rows: RouteOption[] = await res.json();
      setRescheduleRoutes(rows.filter((r) => r.id !== id && r.status !== 'COMPLETED' && r.status !== 'CANCELLED'));
    }
  }

  function openReschedule(stop: Stop) {
    // Default to tomorrow — the usual "try again next day" case.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setRescheduleStop(stop);
    setRescheduleDate(tomorrow);
    setRescheduleWindowStart('');
    setRescheduleWindowEnd('');
    loadRescheduleRoutes(tomorrow);
  }

  async function handleReschedule() {
    const stop = rescheduleStop;
    if (!stop) return;
    // A customer stop has no unrouted pool to return to — it needs a route.
    if (!stop.deliveryOrder && !rescheduleRouteId) return;
    setReschedulingId(stop.id);
    setError(null);
    try {
      const url = stop.deliveryOrder
        ? `/delivery-orders/${stop.deliveryOrder.id}/reschedule`
        : `/delivery-routes/${id}/stops/${stop.id}/reschedule`;
      const res = await apiFetch(url, {
        method: 'POST',
        body: JSON.stringify({
          routeId: rescheduleRouteId || undefined,
          deliveryWindowStart: rescheduleWindowStart ? new Date(rescheduleWindowStart).toISOString() : undefined,
          deliveryWindowEnd: rescheduleWindowEnd ? new Date(rescheduleWindowEnd).toISOString() : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      setRescheduleStop(null);
      await load();
      if (showHistory) await loadHistory();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setReschedulingId(null);
    }
  }

  async function openChangeTeam() {
    setChangingTeam(true);
    if (teams.length === 0) {
      const res = await apiFetch('/teams');
      if (res.ok) setTeams((await res.json()).map(toPickerTeam));
    }
  }

  async function handleChangeTeam(teamId: string) {
    if (!route || !teamId || teamId === route.team.id) {
      setChangingTeam(false);
      return;
    }
    const next = teams.find((x) => x.id === teamId);
    if (next && !confirm(t('delivery.routeDetail.confirmChangeTeam', { name: teamLabel(next, t('delivery.teams.noDriver')) }))) return;
    setSavingTeam(true);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-routes/${id}`, { method: 'PATCH', body: JSON.stringify({ teamId }) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      setChangingTeam(false);
      await load();
      if (showHistory) await loadHistory();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setSavingTeam(false);
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

  const routeOpen = route.status !== 'COMPLETED' && route.status !== 'CANCELLED';
  const mapStops = route.stops
    .filter((s) => s.destinationLatitude && s.destinationLongitude)
    .map<MapStop>((s) => ({
      id: s.id,
      status: s.status,
      latitude: Number(s.destinationLatitude),
      longitude: Number(s.destinationLongitude),
      label: s.label,
      detail: s.address,
    }));

  const statusLabels: Record<StopStatus, string> = {
    PENDING: t('delivery.routeDetail.statusLabel.PENDING'),
    DELIVERED: t('delivery.routeDetail.statusLabel.DELIVERED'),
    FAILED: t('delivery.routeDetail.statusLabel.FAILED'),
  };

  return (
    <div className="min-h-screen bg-gray-50 text-black">
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15">
        <div className="max-w-5xl mx-auto min-w-0">
          <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
            {route.name ?? new Date(route.routeDate).toLocaleDateString()}
          </h1>
          {changingTeam ? (
            <div className="mt-1 flex items-center gap-2 max-w-sm">
              <TeamPicker
                className="flex-1 min-w-0"
                teams={teams}
                value={route.team.id}
                onChange={handleChangeTeam}
                disabled={savingTeam}
              />
              <button
                onClick={() => setChangingTeam(false)}
                aria-label={t('common.cancel')}
                className="p-2 text-gray-400 hover:text-gray-600 shrink-0"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-500 truncate flex items-center gap-1.5">
              {teamLabel(route.team, t('delivery.teams.noDriver'))}
              {!isDriver && routeOpen && (
                <button
                  onClick={openChangeTeam}
                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
                >
                  <Users size={12} />
                  {t('delivery.routeDetail.changeTeam')}
                </button>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>
        )}
        {unscheduled.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 text-amber-900 text-sm rounded-md px-3 py-2">
            <p className="font-semibold">{t('delivery.plan.unscheduledOnRoute')}</p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {unscheduled.map((u) => (
                <li key={u.stopId}>
                  {u.label} — {t(`delivery.plan.reason.${u.reason}`)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {mapStops.length > 0 && (
          <div data-tour="dlv-route-map" ref={mapBoxRef} className="scroll-mt-28">
            <DeliveryMap stops={mapStops} focus={mapFocus} />
          </div>
        )}

        {!isDriver && (
          <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm grid grid-cols-1 sm:flex sm:flex-wrap sm:items-end gap-3">
            <button data-tour="dlv-route-start"
              onClick={openStartPicker}
              className={`flex items-center justify-center gap-1.5 text-sm font-medium border rounded-md px-3 py-2.5 sm:py-1.5 ${
                route.startLatitude
                  ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
                  : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              {route.startLatitude ? <Check size={14} /> : <MapPinOff size={14} />}
              {route.startLatitude ? t('delivery.routeDetail.startSet') : t('delivery.routeDetail.setStart')}
            </button>
            <div data-tour="dlv-route-departure">
              <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('delivery.routeDetail.departureTimeLabel')}
              </label>
              <DateTimePicker
                clearable={false}
                value={departureTime}
                onChange={(v) => setDepartureTime(v)}
                className="w-full sm:w-auto"
              />
            </div>
            <button data-tour="dlv-route-optimize"
              disabled={optimizing || !route.startLatitude || route.stops.every((s) => s.status !== 'PENDING')}
              onClick={handleOptimize}
              title={!route.startLatitude ? t('delivery.routeDetail.setStart') : undefined}
              className="flex items-center justify-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-md px-3 py-2.5 sm:py-1.5 hover:bg-blue-700 disabled:opacity-50"
            >
              <Navigation size={14} />
              {optimizing ? t('delivery.routeDetail.optimizing') : t('delivery.routeDetail.optimizeRoute')}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('delivery.routeDetail.stopsTitle')}</h2>
          {!isDriver && routeOpen && (
            <button data-tour="dlv-route-add-stop"
              onClick={async () => {
                setShowAddStop((v) => !v);
                if (!showAddStop) await loadAvailableOrders();
              }}
              className="flex items-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-md px-3 py-2 sm:py-1.5 hover:bg-blue-700"
            >
              <Plus size={14} />
              {t('delivery.routeDetail.addStop')}
            </button>
          )}
        </div>

        {!isDriver && showAddStop && (
          <div className="border border-blue-500/15 rounded-xl p-3 bg-white shadow-sm grid grid-cols-1 sm:flex sm:flex-wrap sm:items-end gap-3">
            {!hasInvoicePos && (
              <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-sm w-full sm:w-auto">
                {(['CUSTOMER', 'DELIVERY_ORDER'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setAddMode(mode)}
                    className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 ${
                      addMode === mode ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {mode === 'CUSTOMER' ? <Store size={14} /> : <Truck size={14} />}
                    {t(mode === 'CUSTOMER' ? 'delivery.routeDetail.addCustomerStop' : 'delivery.routeDetail.addDeliveryOrderStop')}
                  </button>
                ))}
              </div>
            )}
            {stopMode === 'CUSTOMER' ? (
              <>
                <CustomerStopPicker
                  className="w-full sm:w-auto"
                  value={selectedCustomer}
                  onChange={(c) => {
                    setSelectedCustomer(c);
                    setNewStopAddressId('');
                  }}
                />
                {selectedCustomer && newStopAddresses.length > 0 && (
                  <select
                    value={newStopAddressId}
                    onChange={(e) => setNewStopAddressId(e.target.value)}
                    aria-label={t('delivery.addresses.deliverTo')}
                    className="w-full sm:w-auto border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
                  >
                    <option value="">
                      {t('delivery.addresses.mainAddress')}
                      {selectedCustomer.address ? ` — ${selectedCustomer.address}` : ''}
                    </option>
                    {newStopAddresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                        {a.address ? ` — ${a.address}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={newStopPriority}
                  onChange={(e) => setNewStopPriority(e.target.value as 'NORMAL' | 'HIGH')}
                  aria-label={t('delivery.routeDetail.priorityLabel')}
                  className="w-full sm:w-auto border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
                >
                  <option value="NORMAL">{t('delivery.routeDetail.priorityNormal')}</option>
                  <option value="HIGH">{t('delivery.routeDetail.priorityHigh')}</option>
                </select>
                <label className="block">
                  <span className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                    {t('delivery.routeDetail.windowStartLabel')}
                  </span>
                  <DateTimePicker
                    value={newStopWindowStart}
                    onChange={(v) => setNewStopWindowStart(v)}
                    className="w-full sm:w-auto"
                  />
                </label>
                <label className="block">
                  <span className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                    {t('delivery.routeDetail.windowEndLabel')}
                  </span>
                  <DateTimePicker
                    value={newStopWindowEnd}
                    onChange={(v) => setNewStopWindowEnd(v)}
                    className="w-full sm:w-auto"
                  />
                </label>
              </>
            ) : (
              <>
                <select
                  value={selectedOrderId}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  className="w-full sm:w-auto border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm sm:min-w-[220px]"
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
              </>
            )}
            <button
              disabled={busy === 'add-stop' || (stopMode === 'CUSTOMER' ? !selectedCustomer : !selectedOrderId)}
              onClick={handleAddStop}
              className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 disabled:opacity-50"
            >
              {busy === 'add-stop' ? t('delivery.routeDetail.adding') : t('delivery.routeDetail.add')}
            </button>
          </div>
        )}

        <div data-tour="dlv-route-stops" className="space-y-2">
          {route.stops.length === 0 && <p className="text-sm text-gray-500">{t('delivery.routeDetail.noStops')}</p>}
          {route.stops.map((stop, idx) => {
            const isCurrent = route.currentStop?.id === stop.id;
            const rowBusy = busy === stop.id;
            const onMap = !!(stop.destinationLatitude && stop.destinationLongitude);
            const focused = mapFocus?.stopId === stop.id;
            return (
              <div
                key={stop.id}
                // Clicking the card (not its buttons/inputs) shows the stop on the map.
                onClick={(e) => {
                  if (!onMap || (e.target as HTMLElement).closest('button, a, input, select, textarea, label, [data-no-map-focus]')) return;
                  focusStopOnMap(stop.id);
                }}
                className={`bg-white rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 ${
                  focused ? 'border-blue-600 ring-2 ring-blue-200' : isCurrent ? 'border-blue-400 ring-1 ring-blue-100' : 'border-gray-200'
                } ${onMap ? 'cursor-pointer hover:border-blue-300' : ''}`}
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div className="text-xs text-gray-400 font-medium w-6 shrink-0">#{stop.sequence}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                      {stop.kind === 'CUSTOMER' ? (
                        <Store size={13} className="text-blue-500 shrink-0" aria-label={t('delivery.routeDetail.customerStopBadge')} />
                      ) : (
                        stop.doNumber && <span className="text-[10px] font-mono text-gray-400 shrink-0">{stop.doNumber}</span>
                      )}
                      <span className="truncate">{stop.label}</span>
                    </div>
                    {(stop.addressLabel || stop.address) && (
                      // Wraps on phones where a truncated address is useless;
                      // single-line on wider screens where the row has room.
                      <div className="text-xs text-gray-500 line-clamp-2 sm:truncate">
                        {stop.addressLabel && <span className="font-semibold text-gray-700">{stop.addressLabel}{stop.address ? ' · ' : ''}</span>}
                        {stop.address}
                      </div>
                    )}
                    {stop.status === 'DELIVERED' && stop.receivedBy && (
                      <div className="text-xs text-green-700">{t('delivery.routeDetail.receivedByLabel')}: {stop.receivedBy}</div>
                    )}
                    {stop.status === 'DELIVERED' && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <DeliveryFixBadge accuracy={stop.completedLatitude ? stop.completedAccuracy : null} />
                        <GoogleMapsLink lat={stop.completedLatitude} lng={stop.completedLongitude} className="!px-2 !py-1" />
                      </div>
                    )}
                    {stop.status === 'DELIVERED' && stop.hasProofPhoto && (
                      <ProofPhoto
                        linkPath={
                          stop.deliveryOrder
                            ? `/delivery-orders/${stop.deliveryOrder.id}/proof-photo-link`
                            : `/delivery-routes/${id}/stops/${stop.id}/proof-photo-link`
                        }
                      />
                    )}
                    {stop.status === 'FAILED' && stop.failureReason && (
                      <div className="text-xs text-red-600">{stop.failureReason}</div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {isCurrent && (
                        <span className="text-[10px] text-blue-600 font-medium">
                          {t('delivery.routeDetail.currentStopBadge')}
                        </span>
                      )}
                      {stop.superseded && (
                        <span className="text-[10px] bg-gray-100 text-gray-600 border border-gray-300 rounded-full px-1.5 font-medium">
                          {t('delivery.routeDetail.rescheduledBadge')}
                        </span>
                      )}
                      {stop.priority === 'HIGH' && (
                        <span className="text-[10px] bg-purple-100 text-purple-800 border border-purple-300 rounded-full px-1.5 font-medium">
                          {t('delivery.routeDetail.priorityHigh')}
                        </span>
                      )}
                      {stop.plannedEta && (
                        <span className="text-[10px] text-gray-500 font-medium">
                          {t('delivery.routeDetail.eta')} {formatEta(stop.plannedEta)}
                        </span>
                      )}
                      {stop.deliveryWindowEnd && (
                        <span className="text-[10px] text-gray-500 font-medium">
                          {t('delivery.routeDetail.windowEndLabel')} {formatEta(stop.deliveryWindowEnd)}
                        </span>
                      )}
                      {stop.late && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-white bg-red-600 rounded-full px-1.5 font-semibold">
                          <AlertTriangle size={10} />
                          {t('delivery.routeDetail.late')}
                        </span>
                      )}
                      {stop.atRisk && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 font-medium">
                          <AlertTriangle size={10} />
                          {t('delivery.routeDetail.atRisk')}
                        </span>
                      )}
                    </div>

                    {editingStop?.id === stop.id && (
                      <div data-no-map-focus className="mt-2 p-2 border border-gray-200 rounded-md bg-gray-50 grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2">
                        <div className="col-span-2">
                          <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                            {t('delivery.routeDetail.priorityLabel')}
                          </label>
                          <select
                            value={editPriority}
                            onChange={(e) => setEditPriority(e.target.value as 'NORMAL' | 'HIGH')}
                            className="w-full sm:w-auto border border-gray-300 rounded-md px-2 py-2 sm:py-1 text-base sm:text-xs"
                          >
                            <option value="NORMAL">{t('delivery.routeDetail.priorityNormal')}</option>
                            <option value="HIGH">{t('delivery.routeDetail.priorityHigh')}</option>
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                            {t('delivery.routeDetail.windowStartLabel')}
                          </label>
                          <DateTimePicker
                            size="sm"
                            value={editWindowStart}
                            onChange={(v) => setEditWindowStart(v)}
                            className="w-full sm:w-auto"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                            {t('delivery.routeDetail.windowEndLabel')}
                          </label>
                          <DateTimePicker
                            size="sm"
                            value={editWindowEnd}
                            onChange={(v) => setEditWindowEnd(v)}
                            className="w-full sm:w-auto"
                          />
                        </div>
                        <button
                          onClick={() => setEditingStop(null)}
                          className="text-sm sm:text-xs font-medium border border-gray-300 rounded-md px-2 py-2 sm:py-1"
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          disabled={savingDetails}
                          onClick={handleSaveDetails}
                          className="text-sm sm:text-xs font-medium bg-blue-600 text-white rounded-md px-2 py-2 sm:py-1 disabled:opacity-50"
                        >
                          {savingDetails ? t('common.saving') : t('delivery.routeDetail.saveDetails')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* On phones the actions drop to their own line (indented past
                    the #sequence column) with larger tap targets, instead of
                    squeezing the stop details down to nothing beside them. */}
                <div className="flex items-center gap-2 flex-wrap pl-9 sm:pl-0 sm:flex-nowrap sm:shrink-0">
                  {statusBadge(stop.status, statusLabels[stop.status])}
                  {(stop.deliveryOrder || (stop.status === 'PENDING' && routeOpen && !isDriver)) && (
                    <button
                      onClick={() => openEditDetails(stop)}
                      className="text-xs sm:text-[11px] font-medium text-blue-600 border border-blue-200 rounded px-2.5 py-1.5 sm:px-1.5 sm:py-0.5"
                    >
                      {t('delivery.routeDetail.editDetails')}
                    </button>
                  )}
                  {stop.status === 'FAILED' && !stop.superseded && !isDriver && (
                    <button
                      disabled={reschedulingId === stop.id}
                      onClick={() => openReschedule(stop)}
                      className="text-xs sm:text-[11px] font-medium text-amber-700 border border-amber-300 rounded px-2.5 py-1.5 sm:px-1.5 sm:py-0.5 disabled:opacity-50"
                    >
                      {reschedulingId === stop.id
                        ? t('delivery.routeDetail.rescheduling')
                        : t('delivery.routeDetail.reschedule')}
                    </button>
                  )}
                  <button
                    onClick={() => openLocationPicker(stop)}
                    disabled={isDriver || !routeOpen || stop.status !== 'PENDING'}
                    title={t('delivery.routeDetail.setLocation')}
                    className={`inline-flex items-center gap-1 text-xs sm:text-[11px] font-medium rounded border px-2.5 py-1.5 sm:px-1.5 sm:py-0.5 disabled:cursor-default ${
                      stop.destinationLatitude
                        ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100 disabled:hover:bg-green-50'
                        : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:hover:bg-amber-50'
                    }`}
                  >
                    {stop.destinationLatitude ? <MapPin size={12} /> : <MapPinOff size={12} />}
                    {stop.destinationLatitude
                      ? t('delivery.routeDetail.locationSet')
                      : t('delivery.routeDetail.noLocation')}
                  </button>
                  <GoogleMapsLink lat={stop.destinationLatitude} lng={stop.destinationLongitude} />
                  {!isDriver && routeOpen && (
                    <>
                      <button
                        disabled={rowBusy || idx === 0}
                        onClick={() => handleMove(stop, -1)}
                        aria-label={t('delivery.routeDetail.moveUp')}
                        className="p-2 sm:p-1 rounded border border-gray-200 disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        disabled={rowBusy || idx === route.stops.length - 1}
                        onClick={() => handleMove(stop, 1)}
                        aria-label={t('delivery.routeDetail.moveDown')}
                        className="p-2 sm:p-1 rounded border border-gray-200 disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        disabled={rowBusy}
                        onClick={() => handleRemove(stop)}
                        aria-label={t('delivery.routeDetail.remove')}
                        className="p-2 sm:p-1 rounded border border-red-200 text-red-600 disabled:opacity-30"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <button data-tour="dlv-route-history"
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
              {history.map((h) => {
                const version = h.metadata?.version;
                const snapshot = h.metadata?.stops;
                const open = expandedVersion === h.id;
                return (
                  <div key={h.id} className="text-xs text-gray-600 border-b border-gray-100 pb-1.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-0.5">
                      <span className="flex items-center gap-1.5 font-medium sm:font-normal">
                        {version != null && (
                          <span className="text-[10px] font-semibold font-mono bg-blue-50 text-blue-700 border border-blue-200 rounded px-1">
                            v{version}
                          </span>
                        )}
                        {t(`delivery.routeDetail.historyType.${h.type}`)}
                        {snapshot && (
                          <button
                            onClick={() => setExpandedVersion(open ? null : h.id)}
                            className="text-blue-600 hover:underline font-normal"
                          >
                            {open ? t('delivery.routeDetail.hideStops') : t('delivery.routeDetail.showStops', { count: snapshot.length })}
                          </button>
                        )}
                      </span>
                      <span className="text-gray-400 break-all sm:break-normal">
                        {h.createdBy ? driverLabel(h.createdBy) : '—'} · {new Date(h.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {open && snapshot && (
                      <ol className="mt-1.5 ml-2 pl-3 border-l-2 border-blue-100 space-y-0.5">
                        {snapshot.length === 0 && <li className="text-gray-400">{t('delivery.routeDetail.noStops')}</li>}
                        {snapshot.map((s) => (
                          <li key={s.sequence} className={s.superseded ? 'text-gray-400 line-through' : ''}>
                            #{s.sequence} {s.label ?? '—'}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {rescheduleStop && (
        <div className="fixed inset-0 bg-black/25 flex items-end sm:items-center justify-center z-[60] sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-lg w-full max-w-lg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 max-h-[95vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <CalendarClock size={16} className="text-amber-600" />
                {t('delivery.routeDetail.rescheduleTitle', { name: rescheduleStop.label })}
              </h3>
              <button onClick={() => setRescheduleStop(null)} aria-label={t('common.cancel')} className="p-2 -m-2 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            {rescheduleStop.failureReason && (
              <p className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-md px-2 py-1.5">
                {t('delivery.routeDetail.failureReasonLabel')}: {rescheduleStop.failureReason}
              </p>
            )}
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">
                {t('delivery.routeDetail.rescheduleDate')}
              </label>
              <DatePicker
                value={rescheduleDate}
                onChange={(d) => {
                  setRescheduleDate(d);
                  loadRescheduleRoutes(d);
                }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">
                {t('delivery.routeDetail.rescheduleRoute')}
              </label>
              <select
                value={rescheduleRouteId}
                onChange={(e) => setRescheduleRouteId(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
              >
                {rescheduleStop.deliveryOrder ? (
                  <option value="">{t('delivery.routeDetail.rescheduleNoRoute')}</option>
                ) : (
                  <option value="">{t('delivery.routeDetail.rescheduleSelectRoute')}</option>
                )}
                {rescheduleRoutes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {(r.name ?? r.team.name) + (r.name ? ` — ${r.team.name}` : '')}
                  </option>
                ))}
              </select>
              {rescheduleDate && rescheduleRoutes.length === 0 && (
                <p className="text-xs text-gray-500 mt-1">{t('delivery.routeDetail.rescheduleNoRoutesOnDate')}</p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">{t('delivery.routeDetail.windowStartLabel')}</span>
                <DateTimePicker
                  value={rescheduleWindowStart}
                  onChange={(v) => setRescheduleWindowStart(v)}
                  className="w-full"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">{t('delivery.routeDetail.windowEndLabel')}</span>
                <DateTimePicker
                  value={rescheduleWindowEnd}
                  onChange={(v) => setRescheduleWindowEnd(v)}
                  className="w-full"
                />
              </label>
            </div>
            <p className="text-xs text-gray-500">
              {t(rescheduleStop.deliveryOrder ? 'delivery.routeDetail.rescheduleHint' : 'delivery.routeDetail.rescheduleCustomerHint')}
            </p>
            <div className="grid grid-cols-2 sm:flex sm:justify-end gap-2">
              <button
                onClick={() => setRescheduleStop(null)}
                className="text-sm font-medium border border-gray-300 rounded-md px-3 py-2.5 sm:py-1.5"
              >
                {t('common.cancel')}
              </button>
              <button
                disabled={reschedulingId === rescheduleStop.id || (!rescheduleStop.deliveryOrder && !rescheduleRouteId)}
                onClick={handleReschedule}
                className="bg-amber-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 hover:bg-amber-700 disabled:opacity-50"
              >
                {reschedulingId === rescheduleStop.id ? t('delivery.routeDetail.rescheduling') : t('delivery.routeDetail.reschedule')}
              </button>
            </div>
          </div>
        </div>
      )}

      {(pickingStop || pickingStart) && (
        <div className="fixed inset-0 bg-black/25 flex items-end sm:items-center justify-center z-[60] sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-lg w-full max-w-lg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {t(pickingStart ? 'delivery.routeDetail.pickStartTitle' : 'delivery.routeDetail.pickLocationTitle')}
              </h3>
              <button
                onClick={() => {
                  setPickingStop(null);
                  setPickingStart(false);
                }}
                aria-label={t('common.cancel')}
                className="p-2 -m-2 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            {pickingStop?.kind === 'CUSTOMER' && (
              <p className="text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-md px-2 py-1.5">
                {t('delivery.routeDetail.customerPinThisRouteOnly')}
              </p>
            )}
            {pickingStop && savedAddresses.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">{t('delivery.addresses.useSaved')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {pickingStop.kind === 'CUSTOMER' && (
                    <button
                      disabled={savingLocation}
                      onClick={() => handleApplySavedAddress(undefined)}
                      className="inline-flex items-center gap-1 text-xs font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 rounded-full px-2.5 py-1.5 sm:py-1 disabled:opacity-50"
                    >
                      {t('delivery.addresses.mainAddress')}
                    </button>
                  )}
                  {savedAddresses.map((a) => (
                    <button
                      key={a.id}
                      disabled={savingLocation}
                      onClick={() => handleApplySavedAddress(a.id)}
                      title={a.address ?? undefined}
                      className="inline-flex items-center gap-1 text-xs font-medium border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-full px-2.5 py-1.5 sm:py-1 disabled:opacity-50"
                    >
                      {a.latitude && a.longitude ? <MapPin size={11} /> : <MapPinOff size={11} />}
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <DeliveryMap
              // Shown as context/centering only, not editable here — keeps
              // the picker from defaulting to the Jakarta fallback center
              // when the route's actual stops are somewhere else entirely.
              stops={mapStops}
              height={320}
              pickMode
              pickedPosition={pickedPosition}
              onPick={(lat, lng) => setPickedPosition({ lat, lng })}
            />
            <CoordinateInputs value={pickedPosition} onChange={setPickedPosition} />
            {!pickedPosition && <p className="text-xs text-gray-500">{t('delivery.routeDetail.noLocationSet')}</p>}
            <div className="grid grid-cols-2 sm:flex sm:justify-end gap-2">
              <button
                onClick={() => {
                  setPickingStop(null);
                  setPickingStart(false);
                }}
                className="text-sm font-medium border border-gray-300 rounded-md px-3 py-2.5 sm:py-1.5"
              >
                {t('common.cancel')}
              </button>
              <button
                disabled={!pickedPosition || savingLocation}
                onClick={pickingStart ? handleSaveStart : handleSaveLocation}
                className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 disabled:opacity-50"
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
