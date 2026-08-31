'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';

export type CurrentUser = {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER';
};

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Adjust to your actual "who am I" endpoint if it's not this one
        const res = await apiFetch('/auth/me');
        if (!res.ok) {
          if (!cancelled) setUser(null);
          return;
        }
        const data = await res.json();
        if (!cancelled) setUser(data);
      } catch (err) {
        console.error(err);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}