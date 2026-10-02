'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type GpsFix = { latitude: number; longitude: number; accuracy?: number; at: number };

// unsupported: no Geolocation API. insecure: page not on https/localhost,
// so the browser blocks location without ever prompting. denied: the user
// (or a past "Block") refused permission.
export type GpsStatus = 'unsupported' | 'insecure' | 'denied' | 'searching' | 'ok';

// Readings older than this are ignored — the driver may have moved on.
const FRESH_MS = 20_000;

// Keeps GPS warm while `enabled`, so tapping Mark delivered uses a fix the
// phone has been refining for a while instead of a cold first answer
// (often a coarse WiFi/cell estimate). bestFix() returns the most
// accurate reading from the last FRESH_MS, or null if there is none.
// Environments where location can never work, known without asking.
function blockedEnvironment(): GpsStatus | null {
  if (typeof window === 'undefined') return null;
  if (!window.isSecureContext) return 'insecure';
  if (!('geolocation' in navigator)) return 'unsupported';
  return null;
}

export function useGpsWatch(enabled: boolean) {
  const [watchStatus, setStatus] = useState<GpsStatus>('searching');
  const [best, setBest] = useState<GpsFix | null>(null);
  const fixes = useRef<GpsFix[]>([]);
  // Bumped when permission comes back after a denial: a watch that hit
  // PERMISSION_DENIED is dead for good, so a new one has to be started.
  const [attempt, setAttempt] = useState(0);

  const bestFix = useCallback((): GpsFix | null => {
    const cutoff = Date.now() - FRESH_MS;
    fixes.current = fixes.current.filter((f) => f.at >= cutoff);
    let pick: GpsFix | null = null;
    for (const f of fixes.current) {
      if (!pick || (f.accuracy ?? Infinity) < (pick.accuracy ?? Infinity)) pick = f;
    }
    return pick;
  }, []);

  useEffect(() => {
    if (!enabled || blockedEnvironment()) return;

    let denied = false;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        fixes.current.push({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
          at: Date.now(),
        });
        setBest(bestFix());
        setStatus('ok');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          denied = true;
          setStatus('denied');
        }
        // Timeouts / no signal: keep watching, the next reading may land.
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );

    // Readings age out even when the phone sends no new ones (standing
    // still), so re-evaluate what's displayed every few seconds.
    const tick = setInterval(() => {
      const b = bestFix();
      setBest(b);
      setStatus((s) => (s === 'ok' && !b ? 'searching' : s));
    }, 5_000);

    // Picks up the driver re-allowing location in browser settings
    // without needing a reload (where the Permissions API exists).
    let perm: PermissionStatus | null = null;
    const onPermChange = () => {
      if (perm?.state === 'denied') {
        denied = true;
        setStatus('denied');
      } else if (perm?.state === 'granted' && denied) {
        setStatus('searching');
        setAttempt((a) => a + 1);
      }
    };
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => {
        perm = p;
        onPermChange();
        p.addEventListener('change', onPermChange);
      })
      .catch(() => {});

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(tick);
      perm?.removeEventListener('change', onPermChange);
    };
  }, [enabled, bestFix, attempt]);

  const status = blockedEnvironment() ?? watchStatus;
  return { status, best, bestFix };
}
