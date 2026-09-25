'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';

export type NotificationType =
  | 'DELIVERY_ASSIGNED'
  | 'ROUTE_REASSIGNED'
  | 'ROUTE_REOPTIMIZED'
  | 'DELIVERY_FAILED'
  | 'DELIVERY_AT_RISK'
  | 'ROUTE_STOPS_CHANGED'
  | 'DEVICE_PENDING_APPROVAL'
  | 'DEVICE_APPROVED'
  | 'DEVICE_REJECTED'
  | 'DEVICE_REVOKED'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_UNLOCKED';

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

const POLL_INTERVAL_MS = 45_000;

// Polling, not websockets — the codebase has no realtime/broker infra
// (see docker-compose.yml) and every other delivery screen already
// fetches on-demand rather than subscribing to updates, so this matches
// the existing baseline rather than introducing new infrastructure.
export function useNotifications(enabled: boolean) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const loadedOnce = useRef(false);

  const refreshUnreadCount = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch('/notifications/unread-count');
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(data.count ?? 0);
    } catch {
      // best-effort — a failed poll just tries again next interval
    }
  }, [enabled]);

  const loadList = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await apiFetch('/notifications?pageSize=20');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(Array.isArray(data.data) ? data.data : []);
    } catch {
      // best-effort
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, refreshUnreadCount]);

  const ensureListLoaded = useCallback(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    loadList();
  }, [loadList]);

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
    } catch {
      // best-effort — next poll reconciles if this failed
    }
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await apiFetch('/notifications/read-all', { method: 'PATCH' });
    } catch {
      // best-effort
    }
  }

  return { unreadCount, notifications, ensureListLoaded, markRead, markAllRead, reload: loadList };
}
