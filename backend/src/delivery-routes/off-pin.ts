// src/delivery-routes/off-pin.ts
import { distanceMeters } from '../customers/customer-pin-backfill';

// A delivery recorded further than this from the stop's pin (beyond what
// the reading's own accuracy explains) is flagged for the office: the pin
// is wrong, the driver went to the wrong place, or recorded the delivery
// somewhere else (at the depot, on the way back).
export const OFF_PIN_METERS = 200;
// Accuracy only excuses so much: a ±2 km cell-tower reading says nothing.
const MAX_ACCURACY_ALLOWANCE_METERS = 100;

type Coord = { toString(): string } | number | null | undefined;

// Metres between where the driver recorded the delivery and the stop's pin,
// and whether that's far enough to look at. Null when either is missing or
// the result was set from the office (the driver wasn't there).
export function offPin(input: {
  completedLatitude: Coord;
  completedLongitude: Coord;
  completedAccuracy: number | null | undefined;
  destinationLatitude: Coord;
  destinationLongitude: Coord;
  markedByOffice: boolean;
}): { meters: number; far: boolean } | null {
  const { completedLatitude: cLat, completedLongitude: cLng, destinationLatitude: dLat, destinationLongitude: dLng } = input;
  if (input.markedByOffice || cLat == null || cLng == null || dLat == null || dLng == null) return null;
  const meters = Math.round(
    distanceMeters(
      { latitude: Number(cLat), longitude: Number(cLng) },
      { latitude: Number(dLat), longitude: Number(dLng) },
    ),
  );
  if (!Number.isFinite(meters)) return null;
  const allowance = Math.min(input.completedAccuracy ?? 0, MAX_ACCURACY_ALLOWANCE_METERS);
  return { meters, far: meters - allowance > OFF_PIN_METERS };
}
