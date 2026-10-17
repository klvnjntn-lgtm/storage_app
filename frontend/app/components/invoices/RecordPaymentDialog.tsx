// components/invoices/RecordPaymentDialog.tsx
'use client';

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { formatIDR } from '@/lib/format';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

type BankAccountOption = { id: string; bankName: string; accountNumber: string; isDefault?: boolean; archivedAt?: string | null };
type Part = { key: number; amount: number; method: string; bankAccountId: string };

let partSeq = 0;

// Records money in (a payment) or out (a refund of the customer's credit).
// A payment can be split across methods — e.g. part cash, part QRIS — and
// is then recorded all at once. Any method other than cash needs the bank
// account the money moved through.
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
  const [parts, setParts] = useState<Part[]>([{ key: ++partSeq, amount: balanceDue, method: 'CASH', bankAccountId: '' }]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [defaultBank, setDefaultBank] = useState('');
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
      if (preferred) {
        setDefaultBank(preferred.id);
        setParts((prev) => prev.map((p) => (p.bankAccountId ? p : { ...p, bankAccountId: preferred.id })));
      }
    })();
  }, []);

  const total = Math.round(parts.reduce((s, p) => s + (p.amount || 0), 0) * 100) / 100;
  const remaining = Math.round((balanceDue - total) * 100) / 100;
  const exceedsLimit = total > balanceDue;

  function update(key: number, patch: Partial<Part>) {
    setParts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addPart() {
    setParts((prev) => [
      ...prev,
      { key: ++partSeq, amount: Math.max(0, remaining), method: 'TRANSFER', bankAccountId: defaultBank },
    ]);
  }

  function problem(): string | null {
    if (parts.some((p) => !(p.amount > 0))) return t('sales.recordPayment.amountMustBeGreaterThanZero');
    if (exceedsLimit) {
      return refund
        ? t('sales.recordPayment.amountExceedsCredit', { credit: formatIDR(balanceDue) })
        : t('sales.recordPayment.amountExceedsBalance', { balance: formatIDR(balanceDue) });
    }
    if (parts.some((p) => p.method !== 'CASH' && !p.bankAccountId)) {
      return t('sales.recordPayment.bankAccountRequired');
    }
    return null;
  }

  async function submit() {
    const issue = problem();
    if (issue) {
      setError(issue);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = parts.map((p) => ({
        amount: p.amount,
        method: p.method,
        note: note || undefined,
        ...(p.method !== 'CASH' ? { bankAccountId: p.bankAccountId } : {}),
      }));
      const res =
        parts.length === 1
          ? await apiFetch(`/invoices/${invoiceId}/payments${refund ? '/refund' : ''}`, {
              method: 'POST',
              body: JSON.stringify(body[0]),
            })
          : await apiFetch(`/invoices/${invoiceId}/payments/split`, {
              method: 'POST',
              body: JSON.stringify({ parts: body }),
            });
      if (!res.ok) {
        const resBody = await res.json().catch(() => ({}));
        throw new Error(
          resBody.message ?? (refund ? t('sales.recordPayment.failedToRefund') : t('sales.recordPayment.failedToRecordPayment')),
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

      {parts.map((p, i) => (
        <div key={p.key} className={parts.length > 1 ? 'border border-gray-200 rounded p-2 space-y-2' : 'space-y-3'}>
          {parts.length > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600">{t('sales.recordPayment.partLabel', { n: i + 1 })}</span>
              <button
                type="button"
                onClick={() => setParts((prev) => prev.filter((x) => x.key !== p.key))}
                aria-label={t('sales.recordPayment.removePart')}
                className="text-gray-400 hover:text-red-600"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <label className="block">
            <span className="text-sm">{t('sales.recordPayment.amountLabel')}</span>
            <input
              type="number"
              min={1}
              max={balanceDue}
              value={p.amount}
              onChange={(e) => update(p.key, { amount: Number(e.target.value) })}
              className={`w-full border rounded px-2 py-1 ${exceedsLimit ? 'border-red-400' : ''}`}
            />
          </label>
          <label className="block">
            <span className="text-sm">{t('sales.recordPayment.methodLabel')}</span>
            <select
              value={p.method}
              onChange={(e) => update(p.key, { method: e.target.value })}
              className="w-full border rounded px-2 py-1"
            >
              <option value="CASH">{t('sales.recordPayment.methodCash')}</option>
              <option value="TRANSFER">{t('sales.recordPayment.methodTransfer')}</option>
              <option value="QRIS">{t('sales.recordPayment.methodQris')}</option>
              <option value="OTHER">{t('sales.recordPayment.methodOther')}</option>
            </select>
          </label>
          {p.method !== 'CASH' && (
            <label className="block">
              <span className="text-sm">{t('sales.recordPayment.bankAccountLabel')}</span>
              <select
                value={p.bankAccountId}
                onChange={(e) => update(p.key, { bankAccountId: e.target.value })}
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
        </div>
      ))}

      {!refund && (
        <div className="flex items-center justify-between text-xs">
          <button type="button" onClick={addPart} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
            <Plus size={12} />
            {t('sales.recordPayment.splitPayment')}
          </button>
          {parts.length > 1 && (
            <span className={remaining < 0 ? 'text-red-600' : 'text-gray-500'}>
              {t('sales.recordPayment.remaining', { amount: formatIDR(remaining) })}
            </span>
          )}
        </div>
      )}
      {exceedsLimit && (
        <span className="text-xs text-red-600">
          {refund ? t('sales.recordPayment.exceedsCredit') : t('sales.recordPayment.exceedsBalance')}
        </span>
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
          disabled={submitting || total <= 0 || exceedsLimit}
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
