// src/routing/maps-link.ts
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';

// Turning a Google Maps link — copied from the app, shared on WhatsApp,
// long or short (maps.app.goo.gl) — into coordinates, so the office can
// paste what a customer sends instead of copying numbers by hand.

export type LinkCoords = {
  latitude: number;
  longitude: number;
  // false: only the map's centre was in the link (the "@lat,lng" part), which
  // is where the screen was looking, not necessarily the place.
  exact: boolean;
};

// Only Google's own hosts are ever fetched (short links redirect), so this
// can't be used to make the server call anywhere else.
const ALLOWED_HOST = /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.(com|co\.id|[a-z]{2,3}(\.[a-z]{2})?))$/i;
const SHORT_HOST = /^(maps\.app\.goo\.gl|goo\.gl)$/i;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 8_000;

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
const PAIR = new RegExp(`^\\s*(?:loc:)?\\s*${NUM}\\s*,\\s*\\+?${NUM}\\s*$`);

function valid(lat: number, lng: number) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
  );
}

function pair(text: string | null): { latitude: number; longitude: number } | null {
  const m = text?.match(PAIR);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  return valid(latitude, longitude) ? { latitude, longitude } : null;
}

// Coordinates written into a Google Maps URL, best first: the place's own pin
// (!3d…!4d…), a query or destination that is a coordinate pair, a pair in the
// path (/place/-1.1,104.0), and last the map's centre (@lat,lng,zoom).
export function coordsFromMapsUrl(raw: string): LinkCoords | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const full = decodeURIComponent(url.href);

  const pins = [...full.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)];
  const pin = pins[pins.length - 1];
  if (pin && valid(Number(pin[1]), Number(pin[2]))) {
    return { latitude: Number(pin[1]), longitude: Number(pin[2]), exact: true };
  }

  for (const key of ['q', 'query', 'destination', 'daddr', 'll', 'sll', 'center']) {
    const p = pair(url.searchParams.get(key));
    if (p) return { ...p, exact: key !== 'center' };
  }

  for (const segment of decodeURIComponent(url.pathname).split('/')) {
    const p = pair(segment.replace(/\+/g, ' '));
    if (p) return { ...p, exact: true };
  }

  const at = full.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at && valid(Number(at[1]), Number(at[2]))) {
    return { latitude: Number(at[1]), longitude: Number(at[2]), exact: false };
  }
  return null;
}

function parseAllowed(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BadRequestException('That is not a link');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException('That is not a link');
  }
  if (!ALLOWED_HOST.test(url.hostname)) {
    throw new BadRequestException('Only Google Maps links can be read');
  }
  return url;
}

// Follows a short link's redirects (Google hosts only) to the full URL, then
// reads its coordinates.
export async function resolveMapsLink(raw: string): Promise<LinkCoords> {
  let url = parseAllowed(raw);
  for (let hop = 0; hop < MAX_REDIRECTS && SHORT_HOST.test(url.hostname); hop++) {
    let res: Response;
    try {
      res = await fetch(url.href, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      throw new UnprocessableEntityException('Could not open the link — check the connection and try again');
    }
    const next = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !next) break;
    url = parseAllowed(new URL(next, url).href);
  }
  const coords = coordsFromMapsUrl(url.href);
  if (!coords) {
    throw new UnprocessableEntityException(
      'This link names a place but has no coordinates. In Google Maps, press and hold on the exact spot, then share or copy that pin instead.',
    );
  }
  return coords;
}
