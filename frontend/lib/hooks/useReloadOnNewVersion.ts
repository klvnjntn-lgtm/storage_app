import { useEffect, useRef } from 'react';

async function currentVersion(): Promise<string | null> {
  try {
    const res = await fetch('/app-version', { cache: 'no-store' });
    if (!res.ok) return null;
    return ((await res.json()) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

// A phone keeps a page open for days, and Chrome can bring back a copy from
// before the last deploy — still running the old code. When the page comes
// back into view and the server has a newer version, reload it. Only when
// canReload() says nothing would be lost (no photo, upload or camera in
// progress); otherwise the next return tries again.
export function useReloadOnNewVersion(canReload: () => boolean) {
  const loadedFrom = useRef<string | null>(null);
  const canReloadRef = useRef(canReload);
  useEffect(() => {
    canReloadRef.current = canReload;
  });

  useEffect(() => {
    let checking = false;
    void currentVersion().then((v) => {
      loadedFrom.current = v;
    });
    const check = async () => {
      if (document.visibilityState !== 'visible' || checking) return;
      checking = true;
      try {
        const now = await currentVersion();
        if (!now) return;
        if (!loadedFrom.current) loadedFrom.current = now;
        else if (now !== loadedFrom.current && canReloadRef.current()) window.location.reload();
      } finally {
        checking = false;
      }
    };
    // pageshow: Chrome restoring the page from its back/forward cache.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check();
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
}
