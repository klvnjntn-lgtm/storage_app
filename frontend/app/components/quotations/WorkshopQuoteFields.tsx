'use client';

import { useEffect, useState } from 'react';
import { Car } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { isOdometerBelowLast } from '@/lib/odometer';

export type WorkshopQuote = { vehicleId: string | null; odometer: string; complaint: string };
export const EMPTY_WORKSHOP_QUOTE: WorkshopQuote = { vehicleId: null, odometer: '', complaint: '' };

type CustomerVehicle = { id: string; plateNumber: string; vehicleModel: string; odometer?: number | null };

// Workshops: the car a quotation is for (one of the picked customer's), its odometer and the complaint —
// what the work order made from the quotation starts with.
export function WorkshopQuoteFields({
  customerId,
  value,
  onChange,
  onLastOdometerChange,
}: {
  customerId: string | undefined;
  value: WorkshopQuote;
  onChange: (next: WorkshopQuote) => void;
  // The picked car's last reading (null when none), so the page can hold submit on a lower one.
  onLastOdometerChange?: (km: number | null) => void;
}) {
  const { t } = useLanguage();
  const [vehicles, setVehicles] = useState<CustomerVehicle[] | null>(null);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    apiFetch(`/customers/${customerId}/vehicles`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list: CustomerVehicle[]) => {
        if (!cancelled) setVehicles(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setVehicles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const lastOdometer = customerId ? (vehicles?.find((v) => v.id === value.vehicleId)?.odometer ?? null) : null;
  useEffect(() => {
    onLastOdometerChange?.(lastOdometer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastOdometer]);

  if (!customerId) return null;
  const odometerTooLow = isOdometerBelowLast(value.odometer, lastOdometer);
  const inputCls =
    'w-full border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]';
  return (
    <div className="mb-3 border border-blue-500/15 rounded-xl p-3 bg-white space-y-2">
      <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
        <Car size={13} strokeWidth={2} className="text-blue-600/70" />
        {t('sales.quotationWorkshop.heading')}
      </p>
      <select
        aria-label={t('sales.invoiceCart.vehicleLabel')}
        value={value.vehicleId ?? ''}
        onChange={(e) => {
          const picked = vehicles?.find((v) => v.id === e.target.value);
          onChange({
            ...value,
            vehicleId: picked?.id ?? null,
            odometer: picked?.odometer != null ? String(picked.odometer) : '',
          });
        }}
        className={inputCls}
      >
        <option value="">
          {vehicles === null ? t('sales.invoiceCart.loadingVehicles') : t('sales.invoiceCart.noVehicleOption')}
        </option>
        {(vehicles ?? []).map((v) => (
          <option key={v.id} value={v.id}>
            {v.plateNumber} · {v.vehicleModel}
          </option>
        ))}
      </select>
      {vehicles?.length === 0 && <p className="text-xs text-gray-400">{t('sales.invoiceCart.noVehiclesYet')}</p>}
      {value.vehicleId && (
        <div>
          <input
            type="number"
            min={lastOdometer ?? 0}
            aria-label={t('sales.invoiceCart.odometerLabel')}
            aria-invalid={odometerTooLow}
            value={value.odometer}
            onChange={(e) => onChange({ ...value, odometer: e.target.value })}
            placeholder={
              lastOdometer != null
                ? t('workshop.workOrders.lastOdometer', { km: lastOdometer })
                : t('sales.invoiceCart.odometerPlaceholder')
            }
            className={`${inputCls} ${odometerTooLow ? '!border-red-300' : ''}`}
          />
          {odometerTooLow && (
            <p className="text-xs text-red-600 mt-1">{t('common.odometerTooLow', { km: lastOdometer ?? 0 })}</p>
          )}
        </div>
      )}
      <textarea
        rows={2}
        aria-label={t('sales.quotationWorkshop.complaint')}
        value={value.complaint}
        onChange={(e) => onChange({ ...value, complaint: e.target.value })}
        placeholder={t('sales.quotationWorkshop.complaintPlaceholder')}
        className={`${inputCls} resize-none`}
      />
    </div>
  );
}

// The quotation request's workshop fields; null clears them.
export function workshopPayload(w: WorkshopQuote) {
  const odometer = Number(w.odometer);
  return {
    vehicleId: w.vehicleId,
    odometer: w.vehicleId && w.odometer.trim() && Number.isFinite(odometer) ? odometer : null,
    complaint: w.complaint.trim() || null,
  };
}
