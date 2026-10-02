'use client';

import { useState } from 'react';
import { useLanguage } from '@/app/context/LanguageContext';
import GoogleMapsLink from '@/app/components/delivery/GoogleMapsLink';

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

// Manual latitude/longitude entry that stays in sync with the map picker:
// a map click fills the fields, and valid typed values move the map marker.
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
      {showMapsLink && value && <GoogleMapsLink lat={value.lat} lng={value.lng} />}
    </div>
  );
}
