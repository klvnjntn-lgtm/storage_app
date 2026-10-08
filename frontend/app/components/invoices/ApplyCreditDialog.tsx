// components/invoices/ApplyCreditDialog.tsx
'use client';

import { useState } from 'react';
import { formatIDR } from '@/lib/format';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

export type CreditTarget = { invoiceId: string; invoiceNumber: string | null; balance: number };

// Moves credit held on one invoice (the source) to another invoice of the
// same customer that still has money owed.
export function ApplyCreditDialog({
  sourceInvoiceId,
  credit,
  targets,
  onApplied,
  onClose,
}: {
  sourceInvoiceId: string;
  credit: number;
  targets: CreditTarget[];
  onApplied: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [targetId, setTargetId] = useState(targets[0]?.invoiceId ?? '');
  const target = targets.find((x) => x.invoiceId === targetId);
  const limit = target ? Math.min(credit, target.balance) : credit;
  const [amount, setAmount] = useState(limit);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function pickTarget(id: string) {
    setTargetId(id);
    const next = targets.find((x) => x.invoiceId === id);
    setAmount(next ? Math.min(credit, next.balance) : credit);
  }

  async function submit() {
    if (!targetId || amount <= 0 || amount > limit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/invoices/${targetId}/payments/apply-credit`, {
        method: 'POST',
        body: JSON.stringify({ sourceInvoiceId, amount }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? t('sales.invoiceDetail.requestFailed', { status: res.status }));
      }
      onApplied();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <p className="font-semibold">{t('sales.invoiceDetail.applyCreditTitle')}</p>
      <p className="text-sm text-gray-500">{t('sales.recordPayment.creditAvailable', { credit: formatIDR(credit) })}</p>
      {targets.length === 0 ? (
        <p className="text-sm text-gray-600">{t('sales.invoiceDetail.applyCreditNoTargets')}</p>
      ) : (
        <>
          <label className="block">
            <span className="text-sm">{t('sales.invoiceDetail.applyCreditTarget')}</span>
            <select value={targetId} onChange={(e) => pickTarget(e.target.value)} className="w-full border rounded px-2 py-1">
              {targets.map((x) => (
                <option key={x.invoiceId} value={x.invoiceId}>
                  {t('sales.invoiceDetail.applyCreditOwes', {
                    number: x.invoiceNumber ?? t('sales.invoiceDetail.unnumberedInvoice'),
                    amount: formatIDR(x.balance),
                  })}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm">{t('sales.invoiceDetail.applyCreditAmount')}</span>
            <input
              type="number"
              min={1}
              max={limit}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className={`w-full border rounded px-2 py-1 ${amount > limit ? 'border-red-400' : ''}`}
            />
          </label>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1">{t('common.cancel')}</button>
        {targets.length > 0 && (
          <button
            onClick={submit}
            disabled={submitting || !targetId || amount <= 0 || amount > limit}
            className="px-3 py-1 bg-black text-white rounded disabled:bg-gray-300"
          >
            {submitting ? t('sales.invoiceDetail.applying') : t('sales.invoiceDetail.applyCredit')}
          </button>
        )}
      </div>
    </div>
  );
}
