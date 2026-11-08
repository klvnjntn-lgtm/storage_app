'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, thCls, tdCls } from '@/app/components/shared/PageFrame';
import { SupplierPoSelect, type PoOption } from '@/app/components/purchase-orders/SupplierPoSelect';
import { SupplierPaymentsPanel } from '@/app/components/purchase-orders/SupplierPaymentsPanel';
import type { Supplier } from '@/app/components/suppliers/types';

type PaymentRow = {
  id: string;
  amount: string;
  method: 'CASH' | 'TRANSFER' | 'QRIS' | 'OTHER';
  paidAt: string;
  note: string | null;
  purchaseOrderId: string;
  purchaseOrder: { poNumber: string | null; supplier: { name: string } | null } | null;
};

export default function SupplierPaymentsPage() {
  return (
    <Suspense fallback={null}>
      <SupplierPayments />
    </Suspense>
  );
}

// Paying suppliers, in one place: pick the supplier and order to pay, and every payment made so
// far with the date it was paid.
function SupplierPayments() {
  const { authorized } = useRequireAdmin();
  const { t } = useLanguage();
  const params = useSearchParams();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [po, setPo] = useState<PoOption | null>(null);
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    const res = await apiFetch('/supplier-payments');
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.message ?? t('purchasing.payments.loadFailed'));
    else setRows(body);
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (authorized) load();
  }, [authorized, load, refreshKey]);

  // Arrived from a bill or a PO (?po=…): open that order ready to pay.
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

  if (!authorized) return null;

  const total = rows?.reduce((s, r) => s + Number(r.amount), 0) ?? 0;

  return (
    <PageFrame icon={Wallet} title={t('purchasing.payments.title')} subtitle={t('purchasing.payments.subtitle')}>
      <ErrorNote message={error} />
      <Card title={t('purchasing.payments.payTitle')}>
        <div className="space-y-3">
          <SupplierPoSelect supplier={supplier} onSupplierChange={setSupplier} poId={po?.id ?? ''} onPoChange={setPo} />
          {po && <SupplierPaymentsPanel purchaseOrderId={po.id} refreshKey={refreshKey} onChanged={load} />}
        </div>
      </Card>

      <Card
        title={t('purchasing.payments.historyTitle')}
        actions={
          <button onClick={() => setRefreshKey((k) => k + 1)} className="text-xs text-blue-700 font-semibold hover:underline">
            {t('common.refresh')}
          </button>
        }
      >
        {rows && rows.length === 0 ? (
          <p className="text-sm text-gray-500">{t('purchasing.supplierPayments.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}>{t('purchasing.supplierPayments.paidAt')}</th>
                  <th className={thCls}>{t('purchasing.bills.supplier')}</th>
                  <th className={thCls}>{t('purchasing.returns.colPo')}</th>
                  <th className={thCls}>{t('purchasing.supplierPayments.method')}</th>
                  <th className={thCls}>{t('purchasing.supplierPayments.note')}</th>
                  <th className={`${thCls} text-right`}>{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className={`${tdCls} font-medium whitespace-nowrap`}>{formatDMY(new Date(r.paidAt))}</td>
                    <td className={tdCls}>{r.purchaseOrder?.supplier?.name ?? '—'}</td>
                    <td className={tdCls}>
                      <Link href={`/purchasing/purchase-orders/${r.purchaseOrderId}`} className="text-blue-700 hover:underline">
                        {r.purchaseOrder?.poNumber ?? '—'}
                      </Link>
                    </td>
                    <td className={tdCls}>{t(`purchasing.supplierPayments.methods.${r.method}`)}</td>
                    <td className={`${tdCls} text-gray-600`}>{r.note ?? ''}</td>
                    <td className={`${tdCls} text-right tabular-nums ${Number(r.amount) < 0 ? 'text-red-700' : ''}`}>
                      {formatIDR(Number(r.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
              {!!rows?.length && (
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td colSpan={5} className={`${tdCls} text-right font-semibold`}>{t('purchasing.payments.total')}</td>
                    <td className={`${tdCls} text-right font-semibold tabular-nums`}>{formatIDR(total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </PageFrame>
  );
}
