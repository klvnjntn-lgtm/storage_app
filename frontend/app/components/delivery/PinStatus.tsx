'use client';

import { Lock, MapPin, MapPinOff, AlertTriangle, LocateFixed } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

// A GPS pin vaguer than this is flagged to the office as weak. Matches the
// backend's WEAK_PIN_ACCURACY_METERS.
export const WEAK_PIN_ACCURACY_M = 50;

// The pin fields a Customer / CustomerAddress comes back with. Prisma
// Decimal fields serialize as strings over JSON.
export type PinFields = {
  latitude?: string | null;
  longitude?: string | null;
  pinSource?: 'MANUAL' | 'GPS' | null;
  pinAccuracy?: number | null;
  pinSetAt?: string | null;
};

export type PinStatus = 'NONE' | 'MANUAL' | 'GPS' | 'WEAK_GPS';

export function pinStatus(p: PinFields): PinStatus {
  if (!p.latitude || !p.longitude) return 'NONE';
  // A pin with no recorded source predates sources: the office set it.
  if (p.pinSource !== 'GPS') return 'MANUAL';
  return p.pinAccuracy != null && p.pinAccuracy > WEAK_PIN_ACCURACY_M ? 'WEAK_GPS' : 'GPS';
}

const TONE: Record<PinStatus, string> = {
  NONE: 'text-amber-700',
  MANUAL: 'text-green-700',
  GPS: 'text-green-700',
  WEAK_GPS: 'text-red-700',
};

// One-line pin label for lists: "Set by office" / "Driver GPS ±12 m" /
// "Weak GPS ±80 m" / "No pin".
export function PinStatusBadge({ pin, className = '' }: { pin: PinFields; className?: string }) {
  const { t } = useLanguage();
  const status = pinStatus(pin);
  const m = Math.round(pin.pinAccuracy ?? 0);
  const Icon = status === 'NONE' ? MapPinOff : status === 'MANUAL' ? Lock : status === 'WEAK_GPS' ? AlertTriangle : MapPin;
  const label =
    status === 'NONE'
      ? t('delivery.pin.none')
      : status === 'MANUAL'
        ? t('delivery.pin.manual')
        : t(status === 'WEAK_GPS' ? 'delivery.pin.weakGps' : 'delivery.pin.gps', { m });
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${TONE[status]} ${className}`}>
      <Icon size={13} className="shrink-0" />
      {label}
    </span>
  );
}

// Explains where a pin came from and what happens to it next.
export function pinHint(
  pin: PinFields,
  t: (key: string, vars?: Record<string, string | number>) => string,
  language: string,
): string | null {
  const status = pinStatus(pin);
  if (status === 'NONE') return null;
  if (status === 'MANUAL') return t('delivery.pin.manualHint');
  const date = pin.pinSetAt
    ? new Date(pin.pinSetAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';
  const m = Math.round(pin.pinAccuracy ?? 0);
  return t(status === 'WEAK_GPS' ? 'delivery.pin.weakHint' : 'delivery.pin.gpsHint', { date, m });
}

// Where a delivery was marked done, and how good that GPS fix was.
export function DeliveryFixBadge({ accuracy }: { accuracy: number | null | undefined }) {
  const { t } = useLanguage();
  if (accuracy == null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <MapPinOff size={13} className="shrink-0" />
        {t('delivery.pin.deliveredNoGps')}
      </span>
    );
  }
  const m = Math.round(accuracy);
  const weak = accuracy > WEAK_PIN_ACCURACY_M;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${weak ? 'text-red-700' : 'text-green-700'}`}>
      <LocateFixed size={13} className="shrink-0" />
      {t(weak ? 'delivery.pin.deliveredAtWeak' : 'delivery.pin.deliveredAt', { m })}
    </span>
  );
}
