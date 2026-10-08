// components/invoices/RecordPaymentDialog.tsx
'use client';

import { useEffect, useState } from 'react';
import { formatIDR } from '@/lib/format';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

type BankAccountOption = { id: string; bankName: string; accountNumber: string; isDefault?: boolean; archivedAt?: string | null };

// Records money in (a payment) or out (a refund of the customer's credit).
// Any method other than cash needs the bank account the money moved through
// — the backend refuses it otherwise, so it's asked for here.
export function RecordPaymentDialog({
  invoiceId,
  balanceDue,
  mode = 'payment',
  onRecorded,
  onClose,
}: {
  invoiceId: string;
  // Payment: the balance due. Refund: the credit available.
  balanceDue: number;
  mode?: 'payment' | 'refund';
  onRecorded: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const refund = mode === 'refund';
  const [amount, setAmount] = useState(balanceDue);
  const [method, setMethod] = useState('CASH');
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/organization/bank-accounts');
      if (!res.ok) return;
      const accounts: BankAccountOption[] = (await res.json()).filter((a: BankAccountOption) => !a.archivedAt);
      setBankAccounts(accounts);
      const preferred = accounts.find((a) => a.isDefault) ?? accounts[0];
      if (preferred) setBankAccountId(preferred.id);
    })();
  }, []);

  const exceedsLimit = amount > balanceDue;
  const needsBank = method !== 'CASH';

  async function submit() {
    if (amount <= 0) {
      setError(t('sales.recordPayment.amountMustBeGreaterThanZero'));
      return;
    }
    if (exceedsLimit) {
      setError(
        refund
          ? t('sales.recordPayment.amountExceedsCredit', { credit: formatIDR(balanceDue) })
          : t('sales.recordPayment.amountExceedsBalance', { balance: formatIDR(balanceDue) }),
      );
      return;
    }
    if (needsBank && !bankAccountId) {
      setError(t('sales.recordPayment.bankAccountRequired'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/invoices/${invoiceId}/payments${refund ? '/refund' : ''}`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          method,
          note: note || undefined,
          ...(needsBank ? { bankAccountId } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.message ?? (refund ? t('sales.recordPayment.failedToRefund') : t('sales.recordPayment.failedToRecordPayment')),
        );
      }
      onRecorded();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : refund
            ? t('sales.recordPayment.failedToRefund')
            : t('sales.recordPayment.failedToRecordPayment'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-gray-500">
        {refund
          ? t('sales.recordPayment.creditAvailable', { credit: formatIDR(balanceDue) })
          : t('sales.recordPayment.balanceDue', { balance: formatIDR(balanceDue) })}
      </p>
      <label className="block">
        <span className="text-sm">{t('sales.recordPayment.amountLabel')}</span>
        <input
          type="number"
          min={1}
          max={balanceDue}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className={`w-full border rounded px-2 py-1 ${exceedsLimit ? 'border-red-400' : ''}`}
        />
        {exceedsLimit && (
          <span className="text-xs text-red-600">
            {refund ? t('sales.recordPayment.exceedsCredit') : t('sales.recordPayment.exceedsBalance')}
          </span>
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
      {needsBank && (
        <label className="block">
          <span className="text-sm">{t('sales.recordPayment.bankAccountLabel')}</span>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="w-full border rounded px-2 py-1"
          >
            <option value="">{t('sales.recordPayment.selectBankAccount')}</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName} · {a.accountNumber}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="text-sm">{t('sales.recordPayment.noteLabel')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded px-2 py-1" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1">{t('common.cancel')}</button>
        <button
          onClick={submit}
          disabled={submitting || amount <= 0 || exceedsLimit || (needsBank && !bankAccountId)}
          className="px-3 py-1 bg-black text-white rounded disabled:bg-gray-300"
        >
          {submitting
            ? refund
              ? t('sales.recordPayment.refunding')
              : t('sales.recordPayment.recording')
            : refund
              ? t('sales.recordPayment.refund')
              : t('sales.recordPayment.recordPayment')}
        </button>
      </div>
    </div>
  );
}
