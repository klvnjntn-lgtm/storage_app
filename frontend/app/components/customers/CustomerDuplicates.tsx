'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CopyX } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

// Mirrors the backend's customer-duplicates.ts: an exact copy (same name and
// address, or same NPWP) can't be saved; a similar customer can, once the
// person confirms.
export type DuplicateReason = 'SAME_NAME_ADDRESS' | 'SAME_NPWP' | 'SAME_NAME' | 'SIMILAR_NAME' | 'SAME_PHONE';
export type DuplicateMatch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  reason: DuplicateReason;
};
export type DuplicateCheck = { exact: DuplicateMatch[]; similar: DuplicateMatch[] };
export type DuplicateCandidate = { name: string; address?: string; phone?: string; npwp?: string };

export const NO_DUPLICATES: DuplicateCheck = { exact: [], similar: [] };

const CHECK_DEBOUNCE_MS = 400;

// Looks up rows against the org's customers; throws on a failed request.
export async function checkCustomerDuplicates(rows: DuplicateCandidate[], excludeId?: string): Promise<DuplicateCheck[]> {
  const res = await apiFetch('/customers/check-duplicates', {
    method: 'POST',
    body: JSON.stringify({ rows, excludeId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Live check while a new customer is typed in. A failed check just shows
// nothing — the server still refuses an exact copy on save.
export function useCustomerDuplicates(candidate: DuplicateCandidate, enabled: boolean) {
  const name = candidate.name.trim();
  const address = candidate.address?.trim() || undefined;
  const phone = candidate.phone?.trim() || undefined;
  const npwp = candidate.npwp?.trim() || undefined;
  const active = enabled && name.length >= 2;
  // The result remembers what it was checked for, so a stale one is never shown.
  const key = JSON.stringify([name, address, phone, npwp]);
  const [state, setState] = useState<{ key: string; result: DuplicateCheck } | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let result = NO_DUPLICATES;
      try {
        [result = NO_DUPLICATES] = await checkCustomerDuplicates([{ name, address, phone, npwp }]);
      } catch {
        // nothing to show
      }
      if (!cancelled) setState({ key, result });
    }, CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, key, name, address, phone, npwp]);

  const current = active && state?.key === key ? state.result : NO_DUPLICATES;
  return { ...current, checking: active && state?.key !== key };
}

function MatchList({ matches }: { matches: DuplicateMatch[] }) {
  const { t } = useLanguage();
  return (
    <ul className="mt-1.5 space-y-1">
      {matches.map((m) => (
        <li key={m.id} className="text-xs leading-snug">
          <span className="font-semibold text-gray-900">{m.name}</span>
          {m.address && <span className="text-gray-600"> · {m.address}</span>}
          <span className="block text-[11px] text-gray-500">{t(`customers.duplicates.reason.${m.reason}`)}</span>
        </li>
      ))}
    </ul>
  );
}

// Shown under the name/address fields of a new customer.
export function DuplicateCustomerNotice({ check }: { check: DuplicateCheck }) {
  const { t } = useLanguage();
  if (check.exact.length > 0) {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-red-800">
          <CopyX size={15} className="shrink-0" />
          {t('customers.duplicates.existsTitle')}
        </p>
        <p className="mt-0.5 text-xs text-red-700">{t('customers.duplicates.existsHint')}</p>
        <MatchList matches={check.exact} />
      </div>
    );
  }
  if (check.similar.length > 0) {
    return (
      <div role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
          <AlertTriangle size={15} className="shrink-0" />
          {t('customers.duplicates.similarTitle', { count: check.similar.length })}
        </p>
        <p className="mt-0.5 text-xs text-amber-800">{t('customers.duplicates.similarHint')}</p>
        <MatchList matches={check.similar} />
      </div>
    );
  }
  return null;
}

// The confirm text for saving next to similar customers.
export function similarConfirmMessage(t: (key: string, vars?: Record<string, string | number>) => string, matches: DuplicateMatch[]) {
  const list = matches.map((m) => `• ${m.name}${m.address ? ` — ${m.address}` : ''}`).join('\n');
  return t('customers.duplicates.confirmSave', { count: matches.length, list });
}

// A 409 from POST /customers carries the matches; null when it isn't one.
export function duplicateConflict(body: unknown): { code: 'CUSTOMER_EXISTS' | 'SIMILAR_CUSTOMERS'; matches: DuplicateMatch[] } | null {
  const b = body as { code?: string; matches?: DuplicateMatch[] } | null;
  if ((b?.code === 'CUSTOMER_EXISTS' || b?.code === 'SIMILAR_CUSTOMERS') && Array.isArray(b.matches)) {
    return { code: b.code, matches: b.matches };
  }
  return null;
}
