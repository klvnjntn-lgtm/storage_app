// lib/hooks/useHasModule.ts
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';

type ModuleStatus = {
  module: string;
  purchased: boolean;
  enabled: boolean;
};

// Shared across every caller: a page asks about several modules (and many
// components ask about WAREHOUSE_OPS), so one request serves them all, and
// a page opened shortly after knows the answer from its first render —
// instead of briefly treating a warehouse org as one without locations.
const CACHE_MS = 30_000;
let cached: { at: number; statuses: ModuleStatus[] } | null = null;
let inflight: Promise<ModuleStatus[]> | null = null;

function fresh() {
  return cached && Date.now() - cached.at < CACHE_MS ? cached.statuses : null;
}

function fetchStatuses(): Promise<ModuleStatus[]> {
  const hit = fresh();
  if (hit) return Promise.resolve(hit);
  if (!inflight) {
    inflight = apiFetch('/organizations/modules/status')
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const statuses: ModuleStatus[] = await res.json();
        cached = { at: Date.now(), statuses };
        return statuses;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useHasModule(moduleKey: string): boolean {
  const [enabled, setEnabled] = useState(
    () => fresh()?.some((s) => s.module === moduleKey && s.enabled) ?? false,
  );

  useEffect(() => {
    let cancelled = false;
    fetchStatuses()
      .then((statuses) => {
        if (!cancelled) setEnabled(statuses.some((s) => s.module === moduleKey && s.enabled));
      })
      .catch((err) => console.error('Module status fetch failed:', err));
    return () => {
      cancelled = true;
    };
  }, [moduleKey]);

  return enabled;
}
