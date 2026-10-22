'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY, toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import DatePicker from '@/app/components/shared/DatePicker';
import { useDialog } from '@/app/components/shared/DialogProvider';

type Method = 'CASH' | 'TRANSFER' | 'QRIS' | 'OTHER';
type Payment = {
  id: string;
  amount: string;
  method: Method;
  paidAt: string;
  note: string | null;
  // Set on payments imported from Accurate; those are corrected in Accurate, not voided here.
  externalId: string | null;
};
type BankAccountOption = { id: string; bankName: string; accountNumber: string; isDefault?: boolean; archivedAt?: string | null };

// What's still owed on this PO, the payments made against it, and recording
// a new one. Admin-only, like the supplier-payments API behind it.
export function SupplierPaymentsPanel({ purchaseOrderId, refreshKey }: { purchaseOrderId: string; refreshKey: number }) {
  const dialog = useDialog();
  const { t } = useLanguage();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [outstanding, setOutstanding] = useState(0);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ amount: '', method: 'TRANSFER' as Method, bankAccountId: '', paidAt: toCalendarDateString(new Date()), note: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [listRes, outRes] = await Promise.all([
      apiFetch(`/supplier-payments?purchaseOrderId=${purchaseOrderId}`),
      apiFetch(`/supplier-payments/outstanding/${purchaseOrderId}`),
    ]);
    if (listRes.ok) setPayments(await listRes.json());
    if (outRes.ok) setOutstanding(Number((await outRes.json()).outstanding ?? 0));
  }, [purchaseOrderId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);

  async function openForm() {
    setError(null);
    setForm((f) => ({ ...f, amount: outstanding > 0 ? String(outstanding) : '' }));
    setAdding(true);
    if (bankAccounts.length === 0) {
      const res = await apiFetch('/organization/bank-accounts');
      if (!res.ok) return;
      const accounts: BankAccountOption[] = (await res.json()).filter((a: BankAccountOption) => !a.archivedAt);
      setBankAccounts(accounts);
      const preferred = accounts.find((a) => a.isDefault) ?? accounts[0];
      if (preferred) setForm((f) => ({ ...f, bankAccountId: f.bankAccountId || preferred.id }));
    }
  }

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount.replace(/[^\d.]/g, ''));
    if (!(amount > 0) || amount > outstanding) {
      setError(t('purchasing.supplierPayments.amountInvalid'));
      return;
    }
    if (form.method !== 'CASH' && !form.bankAccountId) {
      setError(t('purchasing.supplierPayments.bankAccountRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiFetch('/supplier-payments', {
      method: 'POST',
      body: JSON.stringify({
        purchaseOrderId,
        amount,
        method: form.method,
        paidAt: form.paidAt || undefined,
        note: form.note.trim() || undefined,
        ...(form.method !== 'CASH' ? { bankAccountId: form.bankAccountId } : {}),
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(body?.message ?? t('purchasing.supplierPayments.saveFailed'));
      return;
    }
    setAdding(false);
    setForm((f) => ({ ...f, amount: '', note: '' }));
    load();
  }

  async function voidPayment(id: string) {
    if (!(await dialog.confirm(t('purchasing.supplierPayments.voidConfirm'), { danger: true }))) return;
    const res = await apiFetch(`/supplier-payments/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.message ?? t('purchasing.supplierPayments.voidFailed'));
      return;
    }
    load();
  }

  if (!payments) return null;

  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const input = 'w-full border-2 border-gray-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500';

  return (
    <section className="bg-white border-2 border-gray-200 rounded-md p-3">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        <Wallet size={14} /> {t('purchasing.supplierPayments.title')}
      </h2>

      <div className="grid grid-cols-2 gap-2 text-center mb-3">
        <div className="rounded-md bg-gray-50 p-2">
          <div className="text-[11px] text-gray-500 uppercase">{t('purchasing.supplierPayments.paid')}</div>
          <div className="text-sm font-semibold tabular-nums">{formatIDR(paid)}</div>
        </div>
        <div className={`rounded-md p-2 ${outstanding > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
          <div className="text-[11px] text-gray-500 uppercase">{t('purchasing.supplierPayments.outstanding')}</div>
          <div className={`text-sm font-semibold tabular-nums ${outstanding > 0 ? 'text-amber-800' : ''}`}>{formatIDR(Math.max(outstanding, 0))}</div>
        </div>
      </div>

      {payments.length === 0 ? (
        <p className="text-xs text-gray-500 mb-2">{t('purchasing.supplierPayments.empty')}</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm mb-2">
          {payments.map((p) => (
            <li key={p.id} className="py-1.5 flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="text-xs text-gray-500">
                  {formatDMY(new Date(p.paidAt))} · {t(`purchasing.supplierPayments.methods.${p.method}`)}
                </span>
                {p.externalId && (
                  <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {t('purchasing.supplierPayments.imported')}
                  </span>
                )}
                {p.note && <span className="block text-xs text-gray-600 truncate">{p.note}</span>}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className={`tabular-nums ${Number(p.amount) < 0 ? 'text-red-700' : ''}`}>{formatIDR(Number(p.amount))}</span>
                {!p.externalId && (
                  <button onClick={() => voidPayment(p.id)} className="text-gray-400 hover:text-red-600" aria-label={t('purchasing.supplierPayments.void')}>
                    <Trash2 size={14} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && !adding && <p className="text-xs text-red-700 mb-2">{error}</p>}

      {adding ? (
        <form onSubmit={record} className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            {t('purchasing.supplierPayments.amount')}
            <input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={input} />
          </label>
          <label className="text-xs text-gray-500">
            {t('purchasing.supplierPayments.method')}
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as Method })} className={input}>
              {(['CASH', 'TRANSFER', 'QRIS', 'OTHER'] as const).map((m) => (
                <option key={m} value={m}>{t(`purchasing.supplierPayments.methods.${m}`)}</option>
              ))}
            </select>
          </label>
          {form.method !== 'CASH' && (
            <label className="col-span-2 text-xs text-gray-500">
              {t('purchasing.supplierPayments.bankAccount')}
              <select value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })} className={input}>
                <option value="">{t('purchasing.supplierPayments.selectBankAccount')}</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.bankName} · {a.accountNumber}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs text-gray-500">
            {t('purchasing.supplierPayments.paidAt')}
            <DatePicker aria-label={t('purchasing.supplierPayments.paidAt')} value={form.paidAt} onChange={(v) => setForm({ ...form, paidAt: v })} />
          </label>
          <label className="text-xs text-gray-500">
            {t('purchasing.supplierPayments.note')}
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={input} />
          </label>
          {error && <p className="col-span-2 text-xs text-red-700">{error}</p>}
          <div className="col-span-2 flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className="flex-1 text-sm px-3 py-1.5 rounded-md border-2 border-gray-300 font-semibold">
              {t('common.cancel')}
            </button>
            <button disabled={busy} className="flex-1 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white font-semibold disabled:opacity-50">
              {t('common.save')}
            </button>
          </div>
        </form>
      ) : outstanding > 0 ? (
        <button onClick={openForm} className="flex items-center gap-1 text-sm font-semibold text-blue-700">
          <Plus size={14} /> {t('purchasing.supplierPayments.record')}
        </button>
      ) : (
        payments.length > 0 && <p className="text-xs text-gray-500">{t('purchasing.supplierPayments.nothingOutstanding')}</p>
      )}
    </section>
  );
}
