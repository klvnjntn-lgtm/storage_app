'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch } from '@/lib/apifetch';

type Profile = {
  email: string;
  role: string;
  avatarUrl?: string | null;
  organization: { name: string };
  [key: string]: any;
};

type AuthContextValue = {
  profile: Profile | null;
  loading: boolean;
  // FIX — was missing entirely. apiFetch() already throws+redirects on a
  // genuine 401, so by the time this reaches `if (res.ok)`, a non-ok
  // response here is always something else (a transient 500, a network
  // blip) — NOT "not logged in." Without this, `profile === null` was
  // the only signal consumers had, and they treated every such failure
  // as "log this admin out," silently bouncing a valid user to /login on
  // a server hiccup. See settings/page.tsx and fiscal-periods/page.tsx's
  // access-gate effects, which now check this before redirecting.
  error: boolean;
  // Re-fetches /auth/me and updates `profile` in place — lets any consumer
  // (e.g. the AppShell avatar picker) push a server-side profile change
  // (like a new avatarUrl) out to every place `profile` is read, without
  // each of them keeping its own copy of the profile in local state.
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  profile: null,
  loading: true,
  error: false,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchProfile = async () => {
    try {
      const res = await apiFetch('/auth/me');
      if (res.ok) {
        setProfile(await res.json());
      } else {
        setError(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    (async () => {
      await fetchProfile();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ profile, loading, error, refreshProfile: fetchProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}