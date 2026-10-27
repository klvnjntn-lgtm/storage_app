'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';

// Fired by the Drivers page after approving/rejecting/revoking a phone, so
// the sidebar badge and the bell's reminders update without waiting for
// the next poll.
export const DEVICES_CHANGED_EVENT = 'waresys:devices-changed';

export type PendingDevice = {
  id: string;
  firstSeenAt: string;
  userAgent: string | null;
  user: { id: string; email: string; displayName: string | null };
};

const POLL_MS = 60_000;

// Drivers' new phones waiting for an admin or staff member — a reminder
// that stays until each is approved or rejected, unlike its notification,
// which is gone once read. Polls while the page is open and refreshes when
// the tab comes back into view.
export function usePendingDevices(enabled: boolean): PendingDevice[] {
  const [pending, setPending] = useState<PendingDevice[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/devices?status=PENDING');
      if (!res.ok) return;
      const rows = await res.json();
      setPending(Array.isArray(rows) ? rows : []);
    } catch {
      // keep what's shown; the next poll tries again
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const kick = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    const first = setTimeout(kick, 0);
    const timer = setInterval(kick, POLL_MS);
    window.addEventListener(DEVICES_CHANGED_EVENT, kick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener(DEVICES_CHANGED_EVENT, kick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  return enabled ? pending : [];
}
