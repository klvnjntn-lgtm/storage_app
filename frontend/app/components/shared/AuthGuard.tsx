'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apifetch';
import { getSessionMarker } from '@/lib/session';
import { useLanguage } from '@/app/context/LanguageContext';

const PUBLIC_PATHS = ['/', '/login', '/register', '/forgot-password', '/reset-password'];

const checkIsPublic = (pathname: string) =>
  PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/print/');

// A DRIVER account only ever sees its own route page — no landing page,
// home, or other modules (the backend refuses them anyway, see
// DriverScopeGuard). Password reset stays reachable.
const DRIVER_PATHS = ['/driver', '/forgot-password', '/reset-password'];
const driverMayView = (pathname: string) =>
  DRIVER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

// Where a freshly verified session lands from an auth page or a page its
// role may not view; null = stay.
function redirectFor(role: string | null, pathname: string, isAuthPage: boolean): string | null {
  if (role === 'DRIVER') return driverMayView(pathname) ? null : '/driver';
  return isAuthPage ? '/home' : null;
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const [checked, setChecked] = useState(false);

  // Tracks whether we've already confirmed this token is valid, so we
  // don't re-hit /auth/me on every path change — only when the token
  // itself changes (login/logout), or once per app load.
  const verifiedTokenRef = useRef<string | null>(null);
  // Role of the verified token — drives the DRIVER-only routing above.
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isPublic = checkIsPublic(pathname);
    // The session itself is an httpOnly cookie; this marker only says the
    // browser signed in (lib/session.ts). /auth/me below is the real check.
    const token = getSessionMarker();
    const isAuthPage = pathname === '/login' || pathname === '/register';

    // FIX — was calling setChecked(false) unconditionally at the top of
    // every run of this effect, i.e. on every single route change, even
    // when the token was already verified and this branch was about to
    // resolve synchronously a few lines below. That briefly flashed the
    // full-page "Loading..." fallback on every in-app navigation for an
    // already-authenticated session, even though no network call was
    // ever needed. Resolving the already-verified fast path FIRST, before
    // touching `checked` at all, means a plain route change never
    // triggers the loading flash — only a genuinely new/unverified token
    // does (the branch below that still calls setChecked(false)).
    if (token && verifiedTokenRef.current === token) {
      const target = redirectFor(role, pathname, isAuthPage);
      if (target) {
        router.replace(target);
      } else {
        setChecked(true);
      }
      return;
    }

    if (!token) {
      verifiedTokenRef.current = null;
      setRole(null);
      if (!isPublic) {
        router.replace('/login');
        return;
      }
      setChecked(true);
      return;
    }

    // New or unverified token: confirm it's actually valid before
    // rendering protected content. apiFetch handles clearing storage
    // and redirecting to /login on a 401 — we just need to not render
    // the page shell while that's in flight.
    setChecked(false);

    async function verify() {
      try {
        const res = await apiFetch('/auth/me');
        if (cancelled) return;

        if (!res.ok) {
          if (!cancelled) {
            setChecked(true);
          }
          return;
        }

        const me = await res.json().catch(() => null);
        if (cancelled) return;
        verifiedTokenRef.current = token;
        setRole(me?.role ?? null);

        const target = redirectFor(me?.role ?? null, pathname, isAuthPage);
        if (target) {
          router.replace(target);
          return;
        }
        setChecked(true);
      } catch {
        // apiFetch already cleared storage + redirected on 401.
        // Nothing further to do here.
      }
    }

    verify();

    return () => {
      cancelled = true;
    };
  }, [pathname, router, role]);

  const isPublic = checkIsPublic(pathname);
  // Don't flash a page (landing, AppShell) a driver is being sent away from.
  const leavingAsDriver = role === 'DRIVER' && !driverMayView(pathname);

  if ((!checked && !isPublic) || leavingAsDriver) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </main>
    );
  }

  return <>{children}</>;
}