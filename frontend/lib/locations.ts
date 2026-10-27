// Locations are a WAREHOUSE_OPS feature. Every other org keeps all its stock
// on one location named CENTRE, which the UI never shows: forms that need a
// location use this one silently instead of asking.
export const CENTRE_LOCATION_NAME = 'CENTRE';

// The location to use when the user isn't asked: CENTRE, or the first one
// (an org that hasn't been merged into CENTRE yet).
export function defaultLocation<T extends { id: string; name: string }>(locations: T[]): T | undefined {
  return locations.find((l) => l.name.trim().toUpperCase() === CENTRE_LOCATION_NAME) ?? locations[0];
}
