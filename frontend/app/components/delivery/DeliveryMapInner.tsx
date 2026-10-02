'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

export type MapStop = {
  id: string;
  status: StopStatus;
  latitude: number;
  longitude: number;
  label: string;
  // Second line of the marker popup (e.g. the address).
  detail?: string | null;
  // Overrides the status color (e.g. one color per driver in a plan preview).
  color?: string;
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

// Flies to the focused stop and opens its popup. `nonce` changes on every
// request so focusing the same stop twice still re-centers the map.
function FocusStop({
  focus,
  stops,
  markers,
}: {
  focus: { stopId: string; nonce: number } | null;
  stops: MapStop[];
  markers: React.RefObject<Record<string, L.Marker>>;
}) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    const stop = stops.find((s) => s.id === focus.stopId);
    if (!stop) return;
    try {
      map.flyTo([stop.latitude, stop.longitude], Math.max(map.getZoom(), 16), { duration: 0.6 });
      markers.current[stop.id]?.openPopup();
    } catch {
      // ignore — same teardown race as FitBounds
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);
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
  focus = null,
}: {
  stops: MapStop[];
  height?: number;
  pickMode?: boolean;
  pickedPosition?: { lat: number; lng: number } | null;
  onPick?: (lat: number, lng: number) => void;
  focus?: { stopId: string; nonce: number } | null;
}) {
  const markers = useRef<Record<string, L.Marker>>({});
  const positions: [number, number][] = stops.map((s) => [s.latitude, s.longitude]);
  const center = positions[0] ?? FALLBACK_CENTER;

  return (
    // `isolate` gives the map its own stacking context: Leaflet's panes and
    // controls use z-index 400–1000, which would otherwise paint over the
    // app's drawers, sticky headers and dropdowns (z-10…z-50).
    <div style={{ height }} className="isolate rounded-lg overflow-hidden border border-gray-200">
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds positions={pickedPosition ? [...positions, [pickedPosition.lat, pickedPosition.lng]] : positions} />
        <FocusStop focus={focus} stops={stops} markers={markers} />
        {pickMode && onPick && <ClickToPick onPick={onPick} />}
        {stops.map((stop) => (
          <Marker
            key={stop.id}
            position={[stop.latitude, stop.longitude]}
            icon={dotIcon(stop.color ?? STATUS_COLOR[stop.status])}
            ref={(m) => {
              if (m) markers.current[stop.id] = m;
              else delete markers.current[stop.id];
            }}
          >
            <Popup>
              <div className="text-sm font-semibold">{stop.label}</div>
              {stop.detail && <div className="text-xs text-gray-500 mt-0.5">{stop.detail}</div>}
            </Popup>
          </Marker>
        ))}
        {pickedPosition && <Marker position={[pickedPosition.lat, pickedPosition.lng]} icon={pickedIcon} />}
      </MapContainer>
    </div>
  );
}
