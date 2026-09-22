// components/invoices/RecordPaymentDialog.tsx
'use client';

import { useState } from 'react';
import { formatIDR } from '@/lib/format';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

export function RecordPaymentDialog({
  invoiceId,
  balanceDue,
  onRecorded,
  onClose,
}: {
  invoiceId: string;
  balanceDue: number;
  onRecorded: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [amount, setAmount] = useState(balanceDue);
  const [method, setMethod] = useState('CASH');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const exceedsBalance = amount > balanceDue;

  async function submit() {
    if (amount <= 0) {
      setError(t('sales.recordPayment.amountMustBeGreaterThanZero'));
      return;
    }
    if (exceedsBalance) {
      setError(t('sales.recordPayment.amountExceedsBalance', { balance: formatIDR(balanceDue) }));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount, method, note: note || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? t('sales.recordPayment.failedToRecordPayment'));
      }
      onRecorded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sales.recordPayment.failedToRecordPayment'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-gray-500">{t('sales.recordPayment.balanceDue', { balance: formatIDR(balanceDue) })}</p>
      <label className="block">
        <span className="text-sm">{t('sales.recordPayment.amountLabel')}</span>
        <input
          type="number"
          min={1}
          max={balanceDue}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className={`w-full border rounded px-2 py-1 ${exceedsBalance ? 'border-red-400' : ''}`}
        />
        {exceedsBalance && (
          <span className="text-xs text-red-600">{t('sales.recordPayment.exceedsBalance')}</span>
        )}
      </label>
      <label className="block">
        <span className="text-sm">{t('sales.recordPayment.methodLabel')}</span>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full border rounded px-2 py-1">
          <option value="CASH">{t('sales.recordPayment.methodCash')}</option>
          <option value="TRANSFER">{t('sales.recordPayment.methodTransfer')}</option>
          <option value="QRIS">{t('sales.recordPayment.methodQris')}</option>
          <option value="OTHER">{t('sales.recordPayment.methodOther')}</option>
        </select>
      </label>
      <label className="block">
        <span className="text-sm">{t('sales.recordPayment.noteLabel')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded px-2 py-1" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1">{t('common.cancel')}</button>
        <button
          onClick={submit}
          disabled={submitting || amount <= 0 || exceedsBalance}
          className="px-3 py-1 bg-black text-white rounded disabled:bg-gray-300"
        >
          {submitting ? t('sales.recordPayment.recording') : t('sales.recordPayment.recordPayment')}
        </button>
      </div>
    </div>
  );
}