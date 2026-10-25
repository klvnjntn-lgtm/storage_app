'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from './useCurrentUser';

/**
 * Gates a page to ADMIN only (or to the roles given). Redirects to
 * /no-access once we know for sure the user isn't allowed (i.e. after
 * loading finishes).
 * `authorized` stays false during the check, so pages can hold off
 * rendering protected content until it flips true — avoids a flash
 * of admin UI before the redirect kicks in.
 */
export function useRequireAdmin(roles: readonly string[] = ['ADMIN']) {
  const router = useRouter();
  const { user, loading } = useCurrentUser();
  const allowed = !!user && roles.includes(user.role);

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace('/no-access');
    }
  }, [loading, allowed, router]);

  const authorized = !loading && allowed;

  return { user, loading, authorized };
}