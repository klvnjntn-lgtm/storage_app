'use client';

import { Lock, MapPin, MapPinOff, AlertTriangle, LocateFixed } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

// GPS quality, the same three levels the driver sees on their phone:
// good up to 30 m, OK up to 50 m, weak beyond. A pin vaguer than 50 m is
// flagged to the office — matches the backend's WEAK_PIN_ACCURACY_METERS.
export const GOOD_GPS_ACCURACY_M = 30;
export const WEAK_PIN_ACCURACY_M = 50;

export type GpsQuality = 'GOOD' | 'OK' | 'WEAK';

export function gpsQuality(accuracy: number): GpsQuality {
  if (accuracy <= GOOD_GPS_ACCURACY_M) return 'GOOD';
  return accuracy <= WEAK_PIN_ACCURACY_M ? 'OK' : 'WEAK';
}

const QUALITY_TONE: Record<GpsQuality, string> = {
  GOOD: 'text-green-700',
  OK: 'text-amber-700',
  WEAK: 'text-red-700',
};

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

// One-line pin label for lists: "Set by office" / "Driver GPS ±12 m · good"
// / "Driver GPS ±40 m · OK" / "Weak GPS ±80 m" / "No pin".
export function PinStatusBadge({ pin, className = '' }: { pin: PinFields; className?: string }) {
  const { t } = useLanguage();
  const status = pinStatus(pin);
  const m = Math.round(pin.pinAccuracy ?? 0);
  const quality = gpsQuality(pin.pinAccuracy ?? 0);
  const Icon = status === 'NONE' ? MapPinOff : status === 'MANUAL' ? Lock : status === 'WEAK_GPS' ? AlertTriangle : MapPin;
  const label =
    status === 'NONE'
      ? t('delivery.pin.none')
      : status === 'MANUAL'
        ? t('delivery.pin.manual')
        : status === 'WEAK_GPS'
          ? t('delivery.pin.weakGps', { m })
          : t(quality === 'GOOD' ? 'delivery.pin.gpsGood' : 'delivery.pin.gpsOk', { m });
  const tone =
    status === 'NONE' ? 'text-amber-700' : status === 'MANUAL' ? 'text-green-700' : QUALITY_TONE[quality];
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${tone} ${className}`}>
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

// Where a delivery was marked done, and how good that GPS fix was:
// "Delivered at ±12 m (good signal)".
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
  const quality = gpsQuality(accuracy);
  const key = { GOOD: 'delivery.pin.deliveredAtGood', OK: 'delivery.pin.deliveredAtOk', WEAK: 'delivery.pin.deliveredAtWeak' }[quality];
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${QUALITY_TONE[quality]}`}>
      <LocateFixed size={13} className="shrink-0" />
      {t(key, { m })}
    </span>
  );
}
