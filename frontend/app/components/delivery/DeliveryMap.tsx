'use client';

import dynamic from 'next/dynamic';

// Both maps touch `window` at import time, so neither can be part of the
// server-rendered bundle — standard Next.js map pattern.
const loading = () => <div className="h-[320px] rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />;

// Google Maps when a key is configured (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
// inlined at build time); otherwise Leaflet with OpenStreetMap tiles —
// e.g. the desktop app, or development without a key. Same props either way.
const DeliveryMap = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  ? dynamic(() => import('./GoogleDeliveryMap'), { ssr: false, loading })
  : dynamic(() => import('./DeliveryMapInner'), { ssr: false, loading });

export default DeliveryMap;
export type { MapStop, MapDriver, StopStatus } from './DeliveryMapInner';
