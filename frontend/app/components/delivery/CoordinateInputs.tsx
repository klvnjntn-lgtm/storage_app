'use client';

import { useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import GoogleMapsLink from '@/app/components/delivery/GoogleMapsLink';
import { gpsQuality } from '@/app/components/delivery/PinStatus';
import { captureLocation, locationProblem } from '@/lib/captureLocation';

type Position = { lat: number; lng: number };

function fmt(n: number) {
  return String(Number(n.toFixed(6)));
}

// Parses "lat, lng" as copied from Google Maps (comma or whitespace separated).
function parsePair(text: string): Position | null {
  const parts = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  return isValidLat(lat) && isValidLng(lng) ? { lat, lng } : null;
}

const isValidLat = (n: number) => Number.isFinite(n) && n >= -90 && n <= 90;
const isValidLng = (n: number) => Number.isFinite(n) && n >= -180 && n <= 180;

const GPS_TONE = { GOOD: 'text-green-700', OK: 'text-amber-700', WEAK: 'text-red-700' } as const;

// Manual latitude/longitude entry that stays in sync with the map picker:
// a map click fills the fields, and valid typed values move the map marker.
// "Use my current location" fills them from this device's GPS, the same
// reading the driver app takes — for staff standing at the place.
export default function CoordinateInputs({
  value,
  onChange,
  showMapsLink = true,
}: {
  value: Position | null;
  onChange: (pos: Position | null) => void;
  showMapsLink?: boolean;
}) {
  const { t } = useLanguage();
  const [locating, setLocating] = useState(false);
  // Accuracy of the GPS reading now in the fields; cleared once they change.
  const [gpsAccuracy, setGpsAccuracy] = useState<{ pos: Position; m: number | null } | null>(null);
  const [gpsError, setGpsError] = useState('');

  async function fillFromGps() {
    setLocating(true);
    setGpsError('');
    try {
      const fix = await captureLocation();
      if (fix.latitude == null || fix.longitude == null) {
        const problem = await locationProblem();
        setGpsError(
          problem === 'insecure'
            ? t('delivery.driver.gps.insecure')
            : problem === 'unsupported'
              ? t('delivery.driver.gps.unsupported')
              : problem === 'denied'
                ? t('delivery.coordinates.gpsDenied')
                : t('delivery.coordinates.gpsFailed'),
        );
        return;
      }
      const pos = { lat: Number(fix.latitude.toFixed(6)), lng: Number(fix.longitude.toFixed(6)) };
      setLatText(fmt(pos.lat));
      setLngText(fmt(pos.lng));
      setGpsAccuracy({ pos, m: fix.accuracy ?? null });
      onChange(pos);
    } finally {
      setLocating(false);
    }
  }
  const shownAccuracy =
    gpsAccuracy && value && value.lat === gpsAccuracy.pos.lat && value.lng === gpsAccuracy.pos.lng ? gpsAccuracy : null;
  const [latText, setLatText] = useState(value ? fmt(value.lat) : '');
  const [lngText, setLngText] = useState(value ? fmt(value.lng) : '');

  const [seen, setSeen] = useState(value);

  // Pull in positions coming from the map, but don't clobber what the user is
  // typing when the parsed value already matches.
  if (value !== seen) {
    setSeen(value);
    if (value) {
      if (Number(latText) !== value.lat) setLatText(fmt(value.lat));
      if (Number(lngText) !== value.lng) setLngText(fmt(value.lng));
    }
  }

  function update(nextLat: string, nextLng: string) {
    // Pasting "lat, lng" into either field fills both.
    const pair = parsePair(nextLat) ?? parsePair(nextLng);
    if (pair && (nextLat.includes(',') || nextLng.includes(','))) {
      setLatText(fmt(pair.lat));
      setLngText(fmt(pair.lng));
      onChange(pair);
      return;
    }
    setLatText(nextLat);
    setLngText(nextLng);
    const lat = Number(nextLat);
    const lng = Number(nextLng);
    onChange(nextLat.trim() && nextLng.trim() && isValidLat(lat) && isValidLng(lng) ? { lat, lng } : null);
  }

  const latInvalid = latText.trim() !== '' && !isValidLat(Number(latText));
  const lngInvalid = lngText.trim() !== '' && !isValidLng(Number(lngText));
  const inputClass = (invalid: boolean) =>
    `w-full border rounded-md px-2 py-1.5 text-sm tabular-nums ${invalid ? 'border-red-400' : 'border-gray-300'}`;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-gray-600">{t('delivery.coordinates.latitude')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={latText}
            onChange={(e) => update(e.target.value, lngText)}
            placeholder="-6.200000"
            className={inputClass(latInvalid)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">{t('delivery.coordinates.longitude')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={lngText}
            onChange={(e) => update(latText, e.target.value)}
            placeholder="106.816666"
            className={inputClass(lngInvalid)}
          />
        </label>
      </div>
      {latInvalid || lngInvalid ? (
        <p className="text-xs text-red-600">{t('delivery.coordinates.invalid')}</p>
      ) : (
        <p className="text-xs text-gray-500">{t('delivery.coordinates.hint')}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={fillFromGps}
          disabled={locating}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-blue-300 text-blue-700 bg-blue-50 font-semibold hover:bg-blue-100 disabled:opacity-50"
        >
          <LocateFixed size={14} className={locating ? 'animate-pulse motion-reduce:animate-none' : ''} />
          {locating ? t('delivery.driver.gps.searching') : t('delivery.coordinates.useMyLocation')}
        </button>
        {shownAccuracy && (
          <span className={`text-xs font-medium ${shownAccuracy.m == null ? 'text-gray-600' : GPS_TONE[gpsQuality(shownAccuracy.m)]}`}>
            {shownAccuracy.m == null
              ? t('delivery.coordinates.gpsFilled')
              : gpsQuality(shownAccuracy.m) === 'WEAK'
                ? t('delivery.coordinates.gpsFilledWeak', { m: Math.round(shownAccuracy.m) })
                : t('delivery.coordinates.gpsFilledAccuracy', { m: Math.round(shownAccuracy.m) })}
          </span>
        )}
      </div>
      {gpsError && <p className="text-xs text-red-600">{gpsError}</p>}
      {showMapsLink && value && <GoogleMapsLink lat={value.lat} lng={value.lng} />}
    </div>
  );
}
