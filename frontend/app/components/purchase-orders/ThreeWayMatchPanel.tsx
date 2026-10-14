'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileCheck2, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

type Bill = { id: string; billNumber: string; billDate: string; dueDate: string | null; amount: string; notes: string | null };
type Match = {
  ordered: number;
  received: number;
  billed: number;
  difference: number;
  status: 'NOT_BILLED' | 'MATCHED' | 'UNDER_BILLED' | 'OVER_BILLED';
  bills: Bill[];
  lines: { purchaseOrderItemId: string; description: string | null; ordered: number; received: number; returned: number }[];
};

export const MATCH_STYLE: Record<Match['status'], string> = {
  NOT_BILLED: 'bg-gray-100 text-gray-700',
  MATCHED: 'bg-green-100 text-green-800',
  UNDER_BILLED: 'bg-amber-100 text-amber-800',
  OVER_BILLED: 'bg-red-100 text-red-800',
};

// The supplier's bills for this PO and the three-way match: ordered vs
// received (net of returns) vs billed. Admin-only, like supplier payments.
export function ThreeWayMatchPanel({ purchaseOrderId, refreshKey }: { purchaseOrderId: string; refreshKey: number }) {
  const { t } = useLanguage();
  const [match, setMatch] = useState<Match | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ billNumber: '', billDate: '', dueDate: '', amount: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/purchase-orders/${purchaseOrderId}/match`);
    if (res.ok) setMatch(await res.json());
  }, [purchaseOrderId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);

  async function addBill(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/purchase-orders/${purchaseOrderId}/bills`, {
      method: 'POST',
      body: JSON.stringify({
        billNumber: form.billNumber.trim(),
        billDate: form.billDate,
        dueDate: form.dueDate || undefined,
        amount: Number(form.amount.replace(/[^\d.]/g, '')),
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(body?.message ?? t('purchasing.bills.saveFailed'));
      return;
    }
    setAdding(false);
    setForm({ billNumber: '', billDate: '', dueDate: '', amount: '' });
    load();
  }

  async function voidBill(id: string) {
    if (!confirm(t('purchasing.bills.voidConfirm'))) return;
    const res = await apiFetch(`/supplier-bills/${id}/void`, { method: 'POST' });
    if (res.ok) load();
  }

  if (!match) return null;

  const input = 'border-2 border-gray-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500';

  return (
    <section className="bg-white border-2 border-gray-200 rounded-md p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">
          <FileCheck2 size={14} /> {t('purchasing.bills.matchTitle')}
        </h2>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${MATCH_STYLE[match.status]}`}>
          {t(`purchasing.bills.status.${match.status}`)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        {(['ordered', 'received', 'billed'] as const).map((k) => (
          <div key={k} className="rounded-md bg-gray-50 p-2">
            <div className="text-[11px] text-gray-500 uppercase">{t(`purchasing.bills.${k}`)}</div>
            <div className="text-sm font-semibold tabular-nums">{formatIDR(match[k])}</div>
          </div>
        ))}
      </div>
      {match.status !== 'NOT_BILLED' && match.status !== 'MATCHED' && (
        <p className="text-xs text-red-700 mb-2">{t('purchasing.bills.difference', { amount: formatIDR(match.difference) })}</p>
      )}

      <table className="w-full text-xs mb-3">
        <thead className="text-gray-500">
          <tr>
            <th className="text-left font-semibold py-1">{t('purchasing.purchaseOrderDetail.colItem')}</th>
            <th className="text-right font-semibold py-1">{t('purchasing.bills.qtyOrdered')}</th>
            <th className="text-right font-semibold py-1">{t('purchasing.bills.qtyReceived')}</th>
            <th className="text-right font-semibold py-1">{t('purchasing.bills.qtyReturned')}</th>
          </tr>
        </thead>
        <tbody>
          {match.lines.map((l) => (
            <tr key={l.purchaseOrderItemId} className="border-t border-gray-100">
              <td className="py-1">{l.description ?? '—'}</td>
              <td className={`py-1 text-right ${l.received < l.ordered ? 'text-amber-700' : ''}`}>{l.ordered}</td>
              <td className="py-1 text-right">{l.received}</td>
              <td className="py-1 text-right">{l.returned || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {match.bills.length > 0 && (
        <ul className="divide-y divide-gray-100 text-sm mb-2">
          {match.bills.map((b) => (
            <li key={b.id} className="py-1.5 flex items-center justify-between gap-2">
              <span>
                <span className="font-medium">{b.billNumber}</span>{' '}
                <span className="text-xs text-gray-500">
                  {formatDMY(new Date(b.billDate))}
                  {b.dueDate && ` · ${t('purchasing.bills.due', { date: formatDMY(new Date(b.dueDate)) })}`}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{formatIDR(Number(b.amount))}</span>
                <button onClick={() => voidBill(b.id)} className="text-gray-400 hover:text-red-600" aria-label={t('purchasing.bills.void')}>
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={addBill} className="grid grid-cols-2 gap-2">
          <input required placeholder={t('purchasing.bills.billNumber')} value={form.billNumber} onChange={(e) => setForm({ ...form, billNumber: e.target.value })} className={input} />
          <input required inputMode="decimal" placeholder={t('common.amount')} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={input} />
          <label className="text-xs text-gray-500">
            {t('purchasing.bills.billDate')}
            <input required type="date" value={form.billDate} onChange={(e) => setForm({ ...form, billDate: e.target.value })} className={`${input} w-full`} />
          </label>
          <label className="text-xs text-gray-500">
            {t('purchasing.bills.dueDate')}
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={`${input} w-full`} />
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
      ) : (
        <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-sm font-semibold text-blue-700">
          <Plus size={14} /> {t('purchasing.bills.record')}
        </button>
      )}
    </section>
  );
}
