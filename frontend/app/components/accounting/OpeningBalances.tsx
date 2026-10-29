'use client';

import { useState } from 'react';
import { AlertTriangle, BookOpenCheck } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { readErrorMessage } from '@/lib/api-error';
import { formatIDR } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';

// POST /accounting/opening-balances/sync, also returned by the Accurate
// import: the AR/AP opening entry for documents that never posted.
type Side = {
  amount: number;
  date: string | null; // YYYY-MM-DD
  action: 'posted' | 'replaced' | 'removed' | 'unchanged' | 'none';
  futureDated: number;
  error?: string;
};
export type OpeningBalancesResult = { AR: Side; AP: Side };

const SIDES = ['AR', 'AP'] as const;

function dmy(date: string) {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function OpeningBalancesNotice({ result }: { result: OpeningBalancesResult }) {
  const { t } = useLanguage();
  const future = result.AR.futureDated + result.AP.futureDated;
  return (
    <div className="border border-blue-200 rounded-xl p-3 text-sm space-y-1.5 bg-blue-50/50">
      <div className="flex items-center gap-2 font-semibold text-blue-900">
        <BookOpenCheck size={16} strokeWidth={2} className="shrink-0" />
        {t('accounting.openingBalances.heading')}
      </div>
      {SIDES.map((side) => {
        const r = result[side];
        const label = t(`accounting.openingBalances.side.${side}`);
        if (r.error) {
          return (
            <p key={side} className="flex items-start gap-1.5 text-red-700">
              <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
              {t('accounting.openingBalances.failed', { side: label, error: r.error })}
            </p>
          );
        }
        return (
          <p key={side} className="text-gray-700">
            {r.date
              ? t('accounting.openingBalances.line', {
                  side: label,
                  amount: formatIDR(r.amount),
                  date: dmy(r.date),
                  action: t(`accounting.openingBalances.action.${r.action}`),
                })
              : t('accounting.openingBalances.lineNone', { side: label })}
          </p>
        );
      })}
      {future > 0 && (
        <p className="flex items-start gap-1.5 text-amber-800">
          <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          {t('accounting.openingBalances.futureDated', { count: future })}
        </p>
      )}
    </div>
  );
}

// Offered on the aging reports when they don't reconcile: posts (or
// refreshes) the opening entries, then lets the page reload its report.
export function SyncOpeningBalancesButton({ onDone }: { onDone: (result: OpeningBalancesResult) => void }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sync() {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/accounting/opening-balances/sync', { method: 'POST' });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      onDone(await res.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs text-gray-600">{t('accounting.openingBalances.syncHint')}</p>
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? t('accounting.openingBalances.syncing') : t('accounting.openingBalances.syncButton')}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
