// One-off GPS reading from the device, shared by the driver app and the
// office screens that take a location or photo on the spot. Comes from the
// device, never from a photo's EXIF. accuracy (metres) goes along so the
// backend and the UI can judge how much to trust it.

export type Fix = { latitude?: number; longitude?: number; accuracy?: number };

// How long to wait for a GPS reading when one is wanted. Any accuracy will
// do — a weak reading beats none.
export const GPS_WAIT_MS = 30_000;

// Resolves {} on permission denied, no API or no answer in time; callers
// decide whether that's allowed. The browser's own timeout only starts once
// permission is settled, and some phones never answer at all while a
// watch is running, so it's hard-capped here.
export function captureLocation(capMs: number = GPS_WAIT_MS): Promise<Fix> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      resolve({});
      return;
    }
    setTimeout(() => resolve({}), capMs);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
        }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

// The lines burned into a photo taken on the spot (shrinkPhoto's stamp):
// date with weekday, time with zone, and the GPS reading.
export function photoStampLines(at: Date, fix: Fix, language: string, noGpsLabel: string): string[] {
  const locale = language === 'id' ? 'id-ID' : 'en-GB';
  const date = at.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  const where =
    fix.latitude != null && fix.longitude != null
      ? `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}${fix.accuracy != null ? ` (±${Math.round(fix.accuracy)} m)` : ''}`
      : noGpsLabel;
  return [date, time, where];
}

// Why no reading came, when it can be told: the page isn't on https, the
// browser has no Geolocation API, or location permission was refused.
// null means it simply didn't answer in time (indoors, no signal).
export type LocationProblem = 'insecure' | 'unsupported' | 'denied';
export async function locationProblem(): Promise<LocationProblem | null> {
  if (typeof window === 'undefined') return null;
  if (!window.isSecureContext) return 'insecure';
  if (!('geolocation' in navigator)) return 'unsupported';
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'denied') return 'denied';
  } catch {
    // Permissions API missing (older Safari) — can't tell.
  }
  return null;
}

// What to tell the user when no reading came (delivery.* i18n keys).
export async function noFixMessage(t: (key: string) => string): Promise<string> {
  const problem = await locationProblem();
  if (problem === 'insecure') return t('delivery.driver.gps.insecure');
  if (problem === 'unsupported') return t('delivery.driver.gps.unsupported');
  if (problem === 'denied') return t('delivery.coordinates.gpsDenied');
  return t('delivery.coordinates.gpsFailed');
}
