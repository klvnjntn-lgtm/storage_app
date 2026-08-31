'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from './useCurrentUser';

/**
 * Gates a page to ADMIN only. Redirects to /no-access once we know
 * for sure the user isn't an admin (i.e. after loading finishes).
 * `authorized` stays false during the check, so pages can hold off
 * rendering protected content until it flips true — avoids a flash
 * of admin UI before the redirect kicks in.
 */
export function useRequireAdmin() {
  const router = useRouter();
  const { user, loading } = useCurrentUser();

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) {
      router.replace('/no-access');
    }
  }, [loading, user, router]);

  const authorized = !loading && user?.role === 'ADMIN';

  return { user, loading, authorized };
}