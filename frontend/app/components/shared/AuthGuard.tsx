'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

const PUBLIC_PATHS = ['/', '/login', '/register', '/forgot-password', '/reset-password'];

const checkIsPublic = (pathname: string) =>
  PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/print/');

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const [checked, setChecked] = useState(false);

  // Tracks whether we've already confirmed this token is valid, so we
  // don't re-hit /auth/me on every path change — only when the token
  // itself changes (login/logout), or once per app load.
  const verifiedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isPublic = checkIsPublic(pathname);
    const token = localStorage.getItem('accessToken');
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
      if (isAuthPage) {
        router.replace('/home');
      } else {
        setChecked(true);
      }
      return;
    }

    if (!token) {
      verifiedTokenRef.current = null;
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

    verify();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  const isPublic = checkIsPublic(pathname);

  if (!checked && !isPublic) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </main>
    );
  }

  return <>{children}</>;
}