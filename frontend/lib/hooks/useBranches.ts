'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';
import { useCurrentUser } from './useCurrentUser';

// Fired by the Branches page after a change, so every useBranches (the
// sidebar included) refetches without a reload.
export const BRANCHES_CHANGED = 'waresys:branches-changed';

export type Branch = { id: string; name: string; address: string | null; phone: string | null; archivedAt: string | null };

// The business's active branches. Branch choices (on invoices, expenses,
// assets, the P&L) only appear once there are two — a single-branch
// business never sees the idea at all — and only to MASTER: an ADMIN or
// USER always works in their own branch (the backend books it for them).
export function useBranches() {
  const { user } = useCurrentUser();
  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch('/branches')
        .then((res) => (res.ok ? res.json() : []))
        .then((list: Branch[]) => {
          if (!cancelled) setBranches(Array.isArray(list) ? list : []);
        })
        .catch(() => {});
    load();
    window.addEventListener(BRANCHES_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(BRANCHES_CHANGED, load);
    };
  }, []);
  return { branches, multiBranch: branches.length > 1 && user?.role === 'MASTER' };
}

// The branch this device last sold from, so a till at one branch stays on it.
const LAST_BRANCH_KEY = 'waresys:lastBranchId';

export function rememberedBranchId(): string {
  try {
    return localStorage.getItem(LAST_BRANCH_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberBranchId(id: string) {
  try {
    if (id) localStorage.setItem(LAST_BRANCH_KEY, id);
  } catch {
    // storage unavailable — just not remembered
  }
}
