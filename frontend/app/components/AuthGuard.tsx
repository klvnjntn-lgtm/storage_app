'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apifetch';

const PUBLIC_PATHS = ['/', '/login', '/register'];

const checkIsPublic = (pathname: string) =>
  PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/print/');

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  // Tracks whether we've already confirmed this token is valid, so we
  // don't re-hit /auth/me on every path change — only when the token
  // itself changes (login/logout), or once per app load.
  const verifiedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      const isPublic = checkIsPublic(pathname);
      const token = localStorage.getItem('accessToken');

      if (!token) {
        verifiedTokenRef.current = null;
        if (!isPublic) {
          router.replace('/login');
          return;
        }
        if (!cancelled) setChecked(true);
        return;
      }

      const isAuthPage = pathname === '/login' || pathname === '/register';

      // Already validated this exact token — skip the network round trip
      // on every route change, just resolve the public/private routing.
      if (verifiedTokenRef.current === token) {
        if (isAuthPage) {
          router.replace('/home');
          return;
        }
        if (!cancelled) setChecked(true);
        return;
      }

      // New or unverified token: confirm it's actually valid before
      // rendering protected content. apiFetch handles clearing storage
      // and redirecting to /login on a 401 — we just need to not render
      // the page shell while that's in flight.
      try {
        const res = await apiFetch('/auth/me');
        if (cancelled) return;

if (!res.ok) {
  if (!cancelled) {
    setChecked(true);
  }
  return;
}

        verifiedTokenRef.current = token;

        if (isAuthPage) {
          router.replace('/home');
          return;
        }
        if (!cancelled) setChecked(true);
      } catch {
        // apiFetch already cleared storage + redirected on 401.
        // Nothing further to do here.
      }
    }

    setChecked(false);
    verify();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  const isPublic = checkIsPublic(pathname);

  if (!checked && !isPublic) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </main>
    );
  }

  return <>{children}</>;
}