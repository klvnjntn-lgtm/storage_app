'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';

export type Branch = { id: string; name: string; address: string | null; phone: string | null; archivedAt: string | null };

// The business's active branches. Branch choices (on invoices, expenses,
// assets, the P&L) only appear once there are two — a single-branch
// business never sees the idea at all.
export function useBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiFetch('/branches')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: Branch[]) => {
        if (!cancelled) setBranches(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return { branches, multiBranch: branches.length > 1 };
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
