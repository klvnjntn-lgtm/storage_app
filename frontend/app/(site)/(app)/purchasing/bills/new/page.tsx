'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FilePlus2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { toCalendarDateString } from '@/lib/dates';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useConfirmPastDates } from '@/lib/hooks/useConfirmPastDates';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, thCls, tdCls } from '@/app/components/shared/PageFrame';
import DatePicker from '@/app/components/shared/DatePicker';
import MoneyInput from '@/app/components/shared/MoneyInput';
import { SupplierPoSelect, type PoOption } from '@/app/components/purchase-orders/SupplierPoSelect';
import type { Supplier } from '@/app/components/suppliers/types';

type Match = {
  received: number;
  billed: number;
  lines: {
    purchaseOrderItemId: string;
    description: string | null;
    sku: string | null;
    ordered: number;
    received: number;
    returned: number;
    unitCost: number;
  }[];
};

export default function NewSupplierBillPage() {
  return (
    <Suspense fallback={null}>
      <NewSupplierBill />
    </Suspense>
  );
}

// A supplier's invoice (faktur pembelian), laid out like a sales invoice: who it's from, its
// number and dates, then the goods it charges for — the PO's lines as received — and the amount.
// Every bill belongs to a purchase order, since that's what it's matched and paid against.
function NewSupplierBill() {
  const { authorized } = useRequireAdmin();
  const { t } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const confirmPastDates = useConfirmPastDates();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [po, setPo] = useState<PoOption | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [form, setForm] = useState(() => ({
    billNumber: '',
    billDate: toCalendarDateString(new Date()),
    dueDate: '',
    amount: '',
    notes: '',
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Opened from a PO (?po=…): start on that order.
  useEffect(() => {
    const id = params.get('po');
    if (!authorized || !id) return;
    (async () => {
      const res = await apiFetch(`/purchase-orders/${id}`);
      if (!res.ok) return;
      const order = await res.json();
      if (order.supplierId) {
        const s = await apiFetch(`/suppliers/${order.supplierId}`);
        if (s.ok) setSupplier(await s.json());
      }
      setPo(order);
    })();
  }, [authorized, params]);

  useEffect(() => {
    if (!po) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatch(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await apiFetch(`/purchase-orders/${po.id}/match`);
      if (!res.ok || cancelled) return;
      const m: Match = await res.json();
      setMatch(m);
      // What's been received and not billed yet is what this bill most likely charges for.
      const open = Math.max(Math.round((m.received - m.billed) * 100) / 100, 0);
      setForm((f) => ({ ...f, amount: open > 0 ? String(open) : f.amount }));
    })();
    return () => {
      cancelled = true;
    };
  }, [po]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!po) {
      setError(t('purchasing.billNew.pickOrder'));
      return;
    }
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      setError(t('purchasing.billNew.amountRequired'));
      return;
    }
    if (!(await confirmPastDates({ document: form.billDate }))) return;
    setBusy(true);
    const res = await apiFetch(`/purchase-orders/${po.id}/bills`, {
      method: 'POST',
      body: JSON.stringify({
        billNumber: form.billNumber.trim(),
        billDate: form.billDate,
        dueDate: form.dueDate || undefined,
        amount,
        notes: form.notes.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(body?.message ?? t('purchasing.bills.saveFailed'));
      return;
    }
    // Straight on to paying it.
    router.push(`/purchasing/payments?po=${po.id}`);
  }

  if (!authorized) return null;

  const lines = match?.lines ?? [];
  const lineQty = (l: Match['lines'][number]) => Math.max(l.received - l.returned, 0);
  const linesTotal = lines.reduce((s, l) => s + lineQty(l) * l.unitCost, 0);
  const input =
    'w-full border border-blue-500/20 rounded-lg p-2 text-sm bg-white outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]';

  return (
    <PageFrame icon={FilePlus2} title={t('purchasing.billNew.title')} subtitle={t('purchasing.billNew.subtitle')}>
      <form onSubmit={save} className="space-y-4">
        <Card>
          <div className="space-y-3">
            <SupplierPoSelect
              supplier={supplier}
              onSupplierChange={setSupplier}
              poId={po?.id ?? ''}
              onPoChange={setPo}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs text-gray-500">
                {t('purchasing.bills.billNumber')}
                <input
                  required
                  maxLength={100}
                  value={form.billNumber}
                  onChange={(e) => setForm({ ...form, billNumber: e.target.value })}
                  className={`${input} mt-1`}
                />
              </label>
              <label className="block text-xs text-gray-500">
                {t('purchasing.bills.billDate')}
                <DatePicker value={form.billDate} onChange={(v) => setForm({ ...form, billDate: v })} className="w-full mt-1" />
              </label>
              <label className="block text-xs text-gray-500">
                {t('purchasing.bills.dueDate')}
                <DatePicker
                  clearable
                  min={form.billDate || undefined}
                  value={form.dueDate}
                  onChange={(v) => setForm({ ...form, dueDate: v })}
                  className="w-full mt-1"
                />
              </label>
            </div>
          </div>
        </Card>

        <Card title={t('purchasing.billNew.itemsTitle')}>
          {!po ? (
            <p className="text-sm text-gray-500">{t('purchasing.billNew.itemsEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={thCls}>{t('purchasing.purchaseOrderDetail.colItem')}</th>
                    <th className={`${thCls} text-right`}>{t('purchasing.billNew.colQty')}</th>
                    <th className={`${thCls} text-right`}>{t('purchasing.billNew.colPrice')}</th>
                    <th className={`${thCls} text-right`}>{t('purchasing.billNew.colTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.purchaseOrderItemId} className="border-t border-gray-100">
                      <td className={tdCls}>
                        <span className="font-medium">{l.description ?? '—'}</span>
                        {l.sku && <span className="block text-xs text-gray-500">{l.sku}</span>}
                      </td>
                      <td className={`${tdCls} text-right tabular-nums`}>
                        {lineQty(l)}
                        {lineQty(l) !== l.ordered && (
                          <span className="block text-[11px] text-gray-400">
                            {t('purchasing.billNew.ofOrdered', { qty: l.ordered })}
                          </span>
                        )}
                      </td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(l.unitCost)}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(lineQty(l) * l.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td colSpan={3} className={`${tdCls} text-right font-semibold`}>{t('purchasing.billNew.receivedValue')}</td>
                    <td className={`${tdCls} text-right font-semibold tabular-nums`}>{formatIDR(linesTotal)}</td>
                  </tr>
                  {!!match?.billed && (
                    <tr>
                      <td colSpan={3} className={`${tdCls} text-right text-gray-500`}>{t('purchasing.billNew.alreadyBilled')}</td>
                      <td className={`${tdCls} text-right tabular-nums text-gray-500`}>{formatIDR(match.billed)}</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr]">
            <label className="block text-xs text-gray-500">
              {t('purchasing.billNew.billAmount')}
              <MoneyInput required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={`${input} mt-1 text-right font-semibold`} />
            </label>
            <label className="block text-xs text-gray-500">
              {t('purchasing.supplierPayments.note')}
              <input value={form.notes} maxLength={1000} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${input} mt-1`} />
            </label>
          </div>
          <div className="mt-3 space-y-2">
            <ErrorNote message={error} />
            <button
              disabled={busy || !po}
              className="w-full bg-blue-700 hover:bg-blue-800 text-white rounded-lg p-3 text-sm font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? t('purchasing.billNew.saving') : t('purchasing.billNew.save')}
            </button>
          </div>
        </Card>
      </form>
    </PageFrame>
  );
}
