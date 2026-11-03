import { useEffect, useRef } from 'react';

// The deployment this copy of the page came from — Next stamps it on
// <html> when the build has one (see next.config.ts). None in dev.
function ownVersion(): string | null {
  return document.documentElement.dataset.dplId || null;
}

async function serverVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/app-version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return ((await res.json()) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

// Reloads for a version once at most: if the reload still brings back the
// old copy (a cache in the way), going round again wouldn't help.
const RELOADED_FOR_KEY = 'reloadedForVersion';

// A phone keeps a page open for days, and Chrome can bring back a copy from
// before the last deploy — still running the old code. On opening, and
// whenever the page comes back into view, compare this copy's version with
// the server's and reload when the server's is newer. Only when canReload()
// says nothing would be lost (no photo, upload or camera in progress);
// otherwise the next return tries again.
export function useReloadOnNewVersion(canReload: () => boolean) {
  const canReloadRef = useRef(canReload);
  useEffect(() => {
    canReloadRef.current = canReload;
  });

  useEffect(() => {
    const own = ownVersion();
    if (!own) return;
    let checking = false;
    const check = async () => {
      if (document.visibilityState !== 'visible' || checking) return;
      checking = true;
      try {
        const latest = await serverVersion();
        if (!latest || latest === own) return;
        try {
          if (sessionStorage.getItem(RELOADED_FOR_KEY) === latest) return;
          if (!canReloadRef.current()) return;
          sessionStorage.setItem(RELOADED_FOR_KEY, latest);
        } catch {
          return; // can't guard against a loop — leave it
        }
        window.location.reload();
      } finally {
        checking = false;
      }
    };
    // pageshow: Chrome restoring the page from its back/forward cache.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check();
    };
    void check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
}
