'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { START_ICON_HEIGHT, START_ICON_HTML, START_ICON_WIDTH } from './startPointIcon';
import { outcomeMark } from './teamColors';

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
  // With a color that isn't the status: finished stops still show how they ended.
  showOutcome?: boolean;
};

// A driver's best-guess position (see DeliveryRoutesService.whereabouts) —
// drawn as a labelled badge so it stands apart from the stop dots.
export type MapDriver = {
  id: string;
  latitude: number;
  longitude: number;
  // Short text on the badge (e.g. the driver's initials).
  badge: string;
  label: string;
  detail?: string | null;
  // Grey when we only know the depot, not a stop they've reached.
  muted?: boolean;
  // Instead of the default blue (e.g. the driver's team color).
  color?: string;
};

// The way a driver has come so far (see DeliveryRoutesService.whereabouts):
// a line through the stops they finished, in the order they finished them.
export type MapTrail = {
  id: string;
  points: [number, number][];
  color?: string;
};

// Where the business's routes leave from.
export type MapStartPoint = {
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
function dotIcon(color: string, mark = '') {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.25);color:white;font:700 11px/16px system-ui,sans-serif;text-align:center">${mark}</div>`,
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

const startIcon = L.divIcon({
  className: '',
  html: START_ICON_HTML,
  iconSize: [START_ICON_WIDTH, START_ICON_HEIGHT],
  iconAnchor: [START_ICON_WIDTH / 2, START_ICON_HEIGHT],
  popupAnchor: [0, -START_ICON_HEIGHT],
});

// Lucide's "truck", inline: a divIcon is an HTML string, not React.
const TRUCK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';

// A truck and the team's initials, centred on where the driver was last
// seen. Zero-size icon with a centred child, so the badge can be as wide as
// its text and still sit exactly on the spot.
function driverIcon(badge: string, muted: boolean, color = '#1d4ed8') {
  const safe = badge.replace(/[&<>"']/g, '');
  return L.divIcon({
    className: '',
    html: `<div style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;background:${muted ? '#6b7280' : color};color:white;font:600 11px/1 system-ui,sans-serif;height:28px;padding:0 8px 0 7px;gap:4px;border-radius:14px;display:flex;align-items:center;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35)">${TRUCK_SVG}${safe ? `<span>${safe}</span>` : ''}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -16],
  });
}

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
  drivers = [],
  trails = [],
  startPoint = null,
  height = 320,
  pickMode = false,
  pickedPosition = null,
  onPick,
  focus = null,
}: {
  stops: MapStop[];
  drivers?: MapDriver[];
  trails?: MapTrail[];
  startPoint?: MapStartPoint | null;
  height?: number;
  pickMode?: boolean;
  pickedPosition?: { lat: number; lng: number } | null;
  onPick?: (lat: number, lng: number) => void;
  focus?: { stopId: string; nonce: number } | null;
}) {
  const markers = useRef<Record<string, L.Marker>>({});
  const positions: [number, number][] = [
    ...stops.map((s): [number, number] => [s.latitude, s.longitude]),
    ...drivers.map((d): [number, number] => [d.latitude, d.longitude]),
    ...(startPoint ? [[startPoint.latitude, startPoint.longitude] as [number, number]] : []),
  ];
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
        {/* Under the markers: a white casing, then the team's color on top,
            so the line reads on any map tiles. */}
        {trails
          .filter((trail) => trail.points.length > 1)
          .flatMap((trail) => [
            <Polyline
              key={`trail-casing-${trail.id}`}
              positions={trail.points}
              pathOptions={{ color: '#ffffff', weight: 7, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
              interactive={false}
            />,
            <Polyline
              key={`trail-${trail.id}`}
              positions={trail.points}
              pathOptions={{ color: trail.color ?? '#1d4ed8', weight: 4, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }}
              interactive={false}
            />,
          ])}
        {stops.map((stop) => (
          <Marker
            key={stop.id}
            position={[stop.latitude, stop.longitude]}
            icon={dotIcon(stop.color ?? STATUS_COLOR[stop.status], outcomeMark(stop))}
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
        {startPoint && (
          <Marker position={[startPoint.latitude, startPoint.longitude]} icon={startIcon} zIndexOffset={500}>
            <Popup>
              <div className="text-sm font-semibold">{startPoint.label}</div>
            </Popup>
          </Marker>
        )}
        {drivers.map((driver) => (
          <Marker
            key={`driver-${driver.id}`}
            position={[driver.latitude, driver.longitude]}
            icon={driverIcon(driver.badge, !!driver.muted, driver.color)}
            zIndexOffset={1000}
          >
            <Popup>
              <div className="text-sm font-semibold">{driver.label}</div>
              {driver.detail && <div className="text-xs text-gray-500 mt-0.5">{driver.detail}</div>}
            </Popup>
          </Marker>
        ))}
        {pickedPosition && <Marker position={[pickedPosition.lat, pickedPosition.lng]} icon={pickedIcon} />}
      </MapContainer>
    </div>
  );
}
