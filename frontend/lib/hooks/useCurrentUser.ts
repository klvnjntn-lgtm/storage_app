'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';
import { getSessionMarker } from '@/lib/session';

export type CurrentUser = {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER' | 'DRIVER';
};

// Every component that asks shares one request: pages, guards and widgets
// all call this, and separate fetches per instance used to send several
// /auth/me requests per page load — enough for an office behind one IP to
// hit the API's per-IP rate limit. Keyed on the session marker, which is
// new on every sign-in, so signing in as someone else never sees the
// previous user.
const CACHE_MS = 30_000;
let cached: { at: number; marker: string | null; promise: Promise<CurrentUser | null> } | null = null;

function fetchCurrentUser(): Promise<CurrentUser | null> {
  const marker = getSessionMarker();
  if (cached && cached.marker === marker && Date.now() - cached.at < CACHE_MS) return cached.promise;
  const promise = apiFetch('/auth/me')
    .then(async (res) => (res.ok ? ((await res.json()) as CurrentUser) : null))
    .catch((err) => {
      console.error(err);
      return null;
    });
  cached = { at: Date.now(), marker, promise };
  // A failure isn't worth remembering; the next caller retries.
  promise.then((u) => {
    if (!u && cached?.promise === promise) cached = null;
  });
  return promise;
}

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const data = await fetchCurrentUser();
      if (!cancelled) {
        setUser(data);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}