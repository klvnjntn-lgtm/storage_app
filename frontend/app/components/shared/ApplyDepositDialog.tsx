'use client';

import { useState } from 'react';
import { formatIDR } from '@/lib/format';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import MoneyInput from '@/app/components/shared/MoneyInput';

export type OpenDeposit = { id: string; depositNumber: string; remaining: number };

// Pays a document from one of its customer's or supplier's down payments. Same
// shape as ApplyCreditDialog, the counterpart for credit held on another invoice.
export function ApplyDepositDialog({
  apiBase,
  target,
  i18nPrefix,
  balance,
  deposits,
  onApplied,
  onClose,
}: {
  apiBase: string;
  // What it's being used on, as the API wants it: { invoiceId } or { purchaseOrderId }.
  target: Record<string, string>;
  i18nPrefix: string;
  balance: number;
  deposits: OpenDeposit[];
  onApplied: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [depositId, setDepositId] = useState(deposits[0]?.id ?? '');
  const deposit = deposits.find((d) => d.id === depositId);
  const limit = deposit ? Math.min(balance, deposit.remaining) : 0;
  const [amount, setAmount] = useState(limit);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function pick(id: string) {
    setDepositId(id);
    const next = deposits.find((d) => d.id === id);
    setAmount(next ? Math.min(balance, next.remaining) : 0);
  }

  async function submit() {
    if (!depositId || amount <= 0 || amount > limit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`${apiBase}/${depositId}/apply`, {
        method: 'POST',
        body: JSON.stringify({ ...target, amount }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t(`${i18nPrefix}.serverError`));
        return;
      }
      onApplied();
      onClose();
    } catch {
      setError(t(`${i18nPrefix}.serverError`));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <p className="font-semibold">{t(`${i18nPrefix}.applyTitle`)}</p>
      <label className="block">
        <span className="text-sm">{t(`${i18nPrefix}.applyWhich`)}</span>
        <select value={depositId} onChange={(e) => pick(e.target.value)} className="w-full border rounded px-2 py-1">
          {deposits.map((d) => (
            <option key={d.id} value={d.id}>
              {d.depositNumber} · {formatIDR(d.remaining)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm">{t('sales.invoiceDetail.applyCreditAmount')}</span>
        <MoneyInput
          min={1}
          max={limit}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className={`w-full border rounded px-2 py-1 ${amount > limit ? 'border-red-400' : ''}`}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1">{t('common.cancel')}</button>
        <button
          onClick={submit}
          disabled={submitting || !depositId || amount <= 0 || amount > limit}
          className="px-3 py-1 bg-black text-white rounded disabled:bg-gray-300"
        >
          {submitting ? t('sales.invoiceDetail.applying') : t(`${i18nPrefix}.apply`)}
        </button>
      </div>
    </div>
  );
}
