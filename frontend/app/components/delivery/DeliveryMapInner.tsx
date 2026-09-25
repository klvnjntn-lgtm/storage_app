'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

export type MapStop = {
  id: string;
  status: StopStatus;
  latitude: number;
  longitude: number;
  label: string;
};

// Jakarta — matches Organization.timezone's own "Asia/Jakarta" default,
// used only when there's nothing yet to center the map on.
const FALLBACK_CENTER: [number, number] = [-6.2088, 106.8456];

const STATUS_COLOR: Record<StopStatus, string> = {
  PENDING: '#f59e0b',
  DELIVERED: '#16a34a',
  FAILED: '#dc2626',
};

// Colored circle divIcons instead of Leaflet's default pin image —
// sidesteps the well-known bundler/default-marker-asset-404 issue
// entirely, and matches the existing status badge colors used elsewhere
// in the delivery module.
function dotIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.25)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const pickedIcon = L.divIcon({
  className: '',
  html: `<div style="background:#2563eb;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.3)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    // Guards a rare Leaflet internal-state race during fast unmount/remount
    // (e.g. client-side route navigation between two pages that each mount
    // their own map) — the container can be mid-teardown when this effect
    // fires; Leaflet's own pan/zoom internals then throw reading their
    // drag-position cache. Never seen affecting an already-settled map.
    try {
      if (positions.length === 1) {
        map.setView(positions[0], 14);
        return;
      }
      map.fitBounds(L.latLngBounds(positions), { padding: [32, 32] });
    } catch {
      // ignore — see comment above
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(positions)]);
  return null;
}

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function DeliveryMapInner({
  stops,
  height = 320,
  pickMode = false,
  pickedPosition = null,
  onPick,
}: {
  stops: MapStop[];
  height?: number;
  pickMode?: boolean;
  pickedPosition?: { lat: number; lng: number } | null;
  onPick?: (lat: number, lng: number) => void;
}) {
  const positions: [number, number][] = stops.map((s) => [s.latitude, s.longitude]);
  const center = positions[0] ?? FALLBACK_CENTER;

  return (
    <div style={{ height }} className="rounded-lg overflow-hidden border border-gray-200">
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds positions={pickedPosition ? [...positions, [pickedPosition.lat, pickedPosition.lng]] : positions} />
        {pickMode && onPick && <ClickToPick onPick={onPick} />}
        {stops.map((stop) => (
          <Marker key={stop.id} position={[stop.latitude, stop.longitude]} icon={dotIcon(STATUS_COLOR[stop.status])} />
        ))}
        {pickedPosition && <Marker position={[pickedPosition.lat, pickedPosition.lng]} icon={pickedIcon} />}
      </MapContainer>
    </div>
  );
}
