'use client';

import { useEffect } from 'react';
import { flushClientErrors } from '@/lib/pageRecovery';

// Tells the recovery script (lib/pageRecovery.ts) that the app's code loaded
// and started, and sends any error reports waiting on this phone.
export default function PageReady() {
  useEffect(() => {
    window.__waresysPageReady?.();
    void flushClientErrors();
    window.addEventListener('online', flushClientErrors);
    return () => window.removeEventListener('online', flushClientErrors);
  }, []);
  return null;
}
