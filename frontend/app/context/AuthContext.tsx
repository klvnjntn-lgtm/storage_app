'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch } from '@/lib/apifetch';

type Profile = {
  email: string;
  role: string;
  organization: { name: string };
  [key: string]: any;
};

type AuthContextValue = {
  profile: Profile | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ profile: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/auth/me');
        if (res.ok) {
          setProfile(await res.json());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AuthContext.Provider value={{ profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}