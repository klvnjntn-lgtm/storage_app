// lib/useHasModule.ts
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';

type ModuleStatus = {
  module: string;
  purchased: boolean;
  enabled: boolean;
};

export function useHasModule(moduleKey: string): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/organizations/modules/status');
        if (!res.ok) return;
        const statuses: ModuleStatus[] = await res.json();
        if (!cancelled) {
          setEnabled(statuses.some((s) => s.module === moduleKey && s.enabled));
        }
      } catch (err) {
        console.error('Module status fetch failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleKey]);

  return enabled;
}