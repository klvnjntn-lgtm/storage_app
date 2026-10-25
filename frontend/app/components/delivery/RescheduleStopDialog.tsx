'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import DatePicker from '@/app/components/shared/DatePicker';
import DateTimePicker from '@/app/components/shared/DateTimePicker';
import { useEscapeToClose } from '@/lib/hooks/useEscapeToClose';
import { toCalendarDateString } from '@/lib/dates';
import type { PickerTeam } from '@/app/components/delivery/TeamPicker';

type RouteOption = { id: string; name: string | null; status: string; team: PickerTeam };

// A failed stop to put back on a route — from the route page or the
// delivery reports.
export type RescheduleTarget = {
  stopId: string;
  // The route the failed stop is on (a customer stop is rescheduled
  // through it; never offered as the new route).
  routeId: string;
  label: string;
  failureReason: string | null;
  // Set for a delivery-order stop: it reschedules through the DO and may
  // go back to the unrouted pool instead of a route.
  deliveryOrderId: string | null;
};

// Pick a date and a route on it (and optionally a new delivery window);
// defaults to tomorrow, the usual "try again next day".
export default function RescheduleStopDialog({
  target,
  onClose,
  onDone,
}: {
  target: RescheduleTarget;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [date, setDate] = useState(() => toCalendarDateString(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [routeId, setRouteId] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeToClose(true, onClose);

  // Routes on the chosen date (cleared when the date changes, below).
  useEffect(() => {
    let alive = true;
    if (!date) return;
    (async () => {
      const res = await apiFetch(`/delivery-routes?date=${date}`);
      if (!alive || !res.ok) return;
      const rows: RouteOption[] = await res.json();
      setRoutes(rows.filter((r) => r.id !== target.routeId && r.status !== 'COMPLETED' && r.status !== 'CANCELLED'));
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [date, target.routeId]);

  // A customer stop has no unrouted pool to return to — it needs a route.
  const needsRoute = !target.deliveryOrderId;

  async function save() {
    if (needsRoute && !routeId) return;
    setSaving(true);
    setError(null);
    try {
      const url = target.deliveryOrderId
        ? `/delivery-orders/${target.deliveryOrderId}/reschedule`
        : `/delivery-routes/${target.routeId}/stops/${target.stopId}/reschedule`;
      const res = await apiFetch(url, {
        method: 'POST',
        body: JSON.stringify({
          routeId: routeId || undefined,
          deliveryWindowStart: windowStart ? new Date(windowStart).toISOString() : undefined,
          deliveryWindowEnd: windowEnd ? new Date(windowEnd).toISOString() : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.routeDetail.requestFailed', { status: res.status }));
        return;
      }
      await onDone();
    } catch {
      setError(t('delivery.routeDetail.couldNotReachServer'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/25 flex items-end sm:items-center justify-center z-[60] sm:p-4">
      <div role="dialog" aria-modal="true" className="bg-white rounded-t-2xl sm:rounded-xl shadow-lg w-full max-w-lg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <CalendarClock size={16} className="text-amber-600" />
            {t('delivery.routeDetail.rescheduleTitle', { name: target.label })}
          </h3>
          <button onClick={onClose} aria-label={t('common.cancel')} className="p-2 -m-2 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        {target.failureReason && (
          <p className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-md px-2 py-1.5">
            {t('delivery.routeDetail.failureReasonLabel')}: {target.failureReason}
          </p>
        )}
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">
            {t('delivery.routeDetail.rescheduleDate')}
          </label>
          <DatePicker
            value={date}
            onChange={(d) => {
              setDate(d);
              setRouteId('');
              setRoutes([]);
            }}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">
            {t('delivery.routeDetail.rescheduleRoute')}
          </label>
          <select
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
          >
            {needsRoute ? (
              <option value="">{t('delivery.routeDetail.rescheduleSelectRoute')}</option>
            ) : (
              <option value="">{t('delivery.routeDetail.rescheduleNoRoute')}</option>
            )}
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {(r.name ?? r.team.name) + (r.name ? ` — ${r.team.name}` : '')}
              </option>
            ))}
          </select>
          {date && routes.length === 0 && (
            <p className="text-xs text-gray-500 mt-1">{t('delivery.routeDetail.rescheduleNoRoutesOnDate')}</p>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">{t('delivery.routeDetail.windowStartLabel')}</span>
            <DateTimePicker value={windowStart} onChange={(v) => setWindowStart(v)} className="w-full" />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">{t('delivery.routeDetail.windowEndLabel')}</span>
            <DateTimePicker value={windowEnd} onChange={(v) => setWindowEnd(v)} className="w-full" />
          </label>
        </div>
        <p className="text-xs text-gray-500">
          {t(needsRoute ? 'delivery.routeDetail.rescheduleCustomerHint' : 'delivery.routeDetail.rescheduleHint')}
        </p>
        {error && (
          <p role="alert" className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-md px-2 py-1.5">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 sm:flex sm:justify-end gap-2">
          <button onClick={onClose} className="text-sm font-medium border border-gray-300 rounded-md px-3 py-2.5 sm:py-1.5">
            {t('common.cancel')}
          </button>
          <button
            disabled={saving || (needsRoute && !routeId)}
            onClick={save}
            className="bg-amber-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 hover:bg-amber-700 disabled:opacity-50"
          >
            {saving ? t('delivery.routeDetail.rescheduling') : t('delivery.routeDetail.reschedule')}
          </button>
        </div>
      </div>
    </div>
  );
}
