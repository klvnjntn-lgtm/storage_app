import type { MapStop } from './DeliveryMapInner';

// One color per team on a map. No reds or plain status colors would be ideal,
// but eight clearly different ones matter more; outcomes are marked separately.
export const TEAM_COLORS = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#4b5563'];

// The mark on a finished stop's dot when its color says something else, so the
// team color doesn't hide whether it was delivered. Kept out of the map files:
// the Google one must not import the Leaflet one, which touches `window`.
export function outcomeMark(stop: MapStop) {
  if (!stop.showOutcome || stop.status === 'PENDING') return '';
  return stop.status === 'DELIVERED' ? '✓' : '✕';
}
