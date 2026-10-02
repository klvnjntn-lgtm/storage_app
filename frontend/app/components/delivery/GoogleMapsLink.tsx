'use client';

import { MapPinned } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

type Coord = number | string | null | undefined;

// Google Maps search URL that drops a pin on the exact coordinates.
export function googleMapsUrl(lat: Coord, lng: Coord): string | null {
  if (lat == null || lng == null || lat === '' || lng === '') return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${la},${ln}`;
}

// "Open in Google Maps" link; renders nothing when coordinates are missing.
export default function GoogleMapsLink({
  lat,
  lng,
  className = '',
}: {
  lat: Coord;
  lng: Coord;
  className?: string;
}) {
  const { t } = useLanguage();
  const href = googleMapsUrl(lat, lng);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-blue-600 text-white shadow-sm px-3 py-1.5 hover:bg-blue-700 ${className}`}
    >
      <MapPinned size={14} />
      {t('delivery.coordinates.openInMaps')}
    </a>
  );
}
