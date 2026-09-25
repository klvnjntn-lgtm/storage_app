'use client';

import dynamic from 'next/dynamic';

// Leaflet touches `window` at import time, so it can't be part of the
// server-rendered bundle — standard Next.js + Leaflet pattern.
const DeliveryMapInner = dynamic(() => import('./DeliveryMapInner'), {
  ssr: false,
  loading: () => <div className="h-[320px] rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />,
});

export default DeliveryMapInner;
export type { MapStop, StopStatus } from './DeliveryMapInner';
