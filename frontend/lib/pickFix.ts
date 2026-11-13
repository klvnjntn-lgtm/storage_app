export type TimedFix = { latitude: number; longitude: number; accuracy?: number; at: number };

// Metres between two points (haversine) — plenty for comparing GPS readings
// a few metres apart.
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// The reading for where the driver is now. Starts from the latest one: the
// most accurate reading of the last few seconds may be from somewhere the
// driver has since left — the open road behind a customer reads tighter than
// a gate between buildings, and that reading once became the customer's pin.
// An earlier reading only wins if it is more accurate, from the last
// SAME_SPOT_MS, AND within SAME_SPOT_METERS of the latest reading: the same
// spot, measured better. Not "inside the latest reading's circle": a weak
// latest reading (±70 m at a gate between buildings) has a circle wide
// enough to take in the road behind, and that tight road reading would win.
// It keeps the latest reading's time, since that's when the driver was
// confirmed to be there.
export const SAME_SPOT_MS = 6_000;
export const SAME_SPOT_METERS = 25;
export function pickFix(fixes: TimedFix[]): TimedFix | null {
  let latest: TimedFix | null = null;
  for (const f of fixes) if (!latest || f.at >= latest.at) latest = f;
  if (!latest || latest.accuracy == null) return latest;
  const reach = Math.min(latest.accuracy, SAME_SPOT_METERS);
  let pick = latest;
  for (const f of fixes) {
    if (f.accuracy == null || f.accuracy >= (pick.accuracy ?? Infinity)) continue;
    if (latest.at - f.at > SAME_SPOT_MS) continue;
    if (distanceMeters(f, latest) <= reach) pick = f;
  }
  return pick === latest ? latest : { ...pick, at: latest.at };
}
