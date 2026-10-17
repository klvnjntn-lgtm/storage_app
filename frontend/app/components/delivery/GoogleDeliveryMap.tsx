'use client';

import { useEffect, useState } from 'react';
import { AdvancedMarker, APIProvider, InfoWindow, Map, useMap } from '@vis.gl/react-google-maps';
import type { MapDriver, MapStop, StopStatus } from './DeliveryMapInner';

// Google Maps version of DeliveryMapInner — same props, so pages don't
// know which one they get (DeliveryMap picks). Used whenever
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set; Leaflet/OpenStreetMap remains
// the fallback (desktop app, dev without a key).
//
// Billing is per map load (each time a map is created). reuseMaps keeps
// one map instance alive across pages, and the monitoring page's 30s
// refresh only updates markers, so neither adds loads.

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
// Advanced markers need a Map ID (Google Cloud console → Map Management).
// DEMO_MAP_ID works for development only.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

const FALLBACK_CENTER = { lat: -6.2088, lng: 106.8456 };

const STATUS_COLOR: Record<StopStatus, string> = {
  PENDING: '#f59e0b',
  DELIVERED: '#16a34a',
  FAILED: '#dc2626',
};

type Popup = { key: string; lat: number; lng: number; label: string; detail?: string | null };

function FitBounds({ positions }: { positions: google.maps.LatLngLiteral[] }) {
  const map = useMap();
  const key = JSON.stringify(positions);
  useEffect(() => {
    if (!map || positions.length === 0) return;
    if (positions.length === 1) {
      map.setCenter(positions[0]);
      map.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const p of positions) bounds.extend(p);
    map.fitBounds(bounds, 32);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

// Pans to the focused stop and opens its popup. `nonce` changes on every
// request so focusing the same stop twice still re-centers the map.
function FocusStop({
  focus,
  stops,
  onOpen,
}: {
  focus: { stopId: string; nonce: number } | null;
  stops: MapStop[];
  onOpen: (popup: Popup) => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || !focus) return;
    const stop = stops.find((s) => s.id === focus.stopId);
    if (!stop) return;
    map.panTo({ lat: stop.latitude, lng: stop.longitude });
    map.setZoom(Math.max(map.getZoom() ?? 0, 16));
    onOpen({ key: stop.id, lat: stop.latitude, lng: stop.longitude, label: stop.label, detail: stop.detail });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus?.nonce]);
  return null;
}

const dotStyle = (color: string, size: number, border: number) => ({
  background: color,
  width: size,
  height: size,
  borderRadius: '50%',
  border: `${border}px solid white`,
  boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
});

export default function GoogleDeliveryMap({
  stops,
  drivers = [],
  height = 320,
  pickMode = false,
  pickedPosition = null,
  onPick,
  focus = null,
}: {
  stops: MapStop[];
  drivers?: MapDriver[];
  height?: number;
  pickMode?: boolean;
  pickedPosition?: { lat: number; lng: number } | null;
  onPick?: (lat: number, lng: number) => void;
  focus?: { stopId: string; nonce: number } | null;
}) {
  const [popup, setPopup] = useState<Popup | null>(null);
  const positions = [
    ...stops.map((s) => ({ lat: s.latitude, lng: s.longitude })),
    ...drivers.map((d) => ({ lat: d.latitude, lng: d.longitude })),
    ...(pickedPosition ? [pickedPosition] : []),
  ];

  return (
    <div style={{ height }} className="isolate rounded-lg overflow-hidden border border-gray-200">
      <APIProvider apiKey={API_KEY}>
        <Map
          mapId={MAP_ID}
          reuseMaps
          defaultCenter={positions[0] ?? FALLBACK_CENTER}
          defaultZoom={12}
          gestureHandling="cooperative"
          clickableIcons={false}
          streetViewControl={false}
          mapTypeControl={false}
          style={{ height: '100%', width: '100%' }}
          onClick={(e) => {
            const p = e.detail.latLng;
            if (pickMode && onPick && p) onPick(p.lat, p.lng);
          }}
        >
          <FitBounds positions={positions} />
          <FocusStop focus={focus} stops={stops} onOpen={setPopup} />
          {stops.map((stop) => (
            <AdvancedMarker
              key={stop.id}
              position={{ lat: stop.latitude, lng: stop.longitude }}
              anchorLeft="-50%"
              anchorTop="-50%"
              onClick={() =>
                setPopup({ key: stop.id, lat: stop.latitude, lng: stop.longitude, label: stop.label, detail: stop.detail })
              }
            >
              <div style={dotStyle(stop.color ?? STATUS_COLOR[stop.status], 16, 2)} />
            </AdvancedMarker>
          ))}
          {drivers.map((driver) => (
            <AdvancedMarker
              key={`driver-${driver.id}`}
              position={{ lat: driver.latitude, lng: driver.longitude }}
              anchorLeft="-50%"
              anchorTop="-50%"
              zIndex={1000}
              onClick={() =>
                setPopup({
                  key: `driver-${driver.id}`,
                  lat: driver.latitude,
                  lng: driver.longitude,
                  label: driver.label,
                  detail: driver.detail,
                })
              }
            >
              <div
                style={{
                  background: driver.muted ? '#6b7280' : '#1d4ed8',
                  color: 'white',
                  font: '600 11px/1 system-ui, sans-serif',
                  minWidth: 28,
                  height: 28,
                  padding: '0 6px',
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid white',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                }}
              >
                {driver.badge}
              </div>
            </AdvancedMarker>
          ))}
          {pickedPosition && (
            <AdvancedMarker position={pickedPosition} anchorLeft="-50%" anchorTop="-50%">
              <div style={dotStyle('#2563eb', 18, 3)} />
            </AdvancedMarker>
          )}
          {popup && (
            <InfoWindow
              position={{ lat: popup.lat, lng: popup.lng }}
              pixelOffset={[0, -12]}
              headerDisabled
              onCloseClick={() => setPopup(null)}
            >
              <div className="text-sm font-semibold text-black">{popup.label}</div>
              {popup.detail && <div className="text-xs text-gray-500 mt-0.5">{popup.detail}</div>}
            </InfoWindow>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
