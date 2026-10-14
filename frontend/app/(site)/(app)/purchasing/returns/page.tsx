'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Undo2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, thCls, tdCls } from '@/app/components/shared/PageFrame';

type Row = {
  id: string;
  returnNumber: string | null;
  purchaseOrderId: string;
  createdAt: string;
  reason: string | null;
  total: string;
  location: { name: string };
  purchaseOrder: { poNumber: string | null; supplier: { name: string } | null };
  items: { id: string; quantity: number; product: { name: string } | null }[];
};

// Every purchase return. New returns start from a purchase order
// ("Return goods" on its page), since a return is always against what a PO
// delivered.
export default function PurchaseReturnsPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/purchase-returns');
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.message ?? t('purchasing.returns.loadFailed'));
      else setRows(body);
    })();
  }, [t]);

  return (
    <PageFrame icon={Undo2} title={t('purchasing.returns.pageTitle')} subtitle={t('purchasing.returns.pageSubtitle')}>
      <ErrorNote message={error} />
      <Card>
        {rows && rows.length === 0 ? (
          <p className="text-sm text-gray-500">{t('purchasing.returns.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}>{t('purchasing.returns.colNumber')}</th>
                  <th className={thCls}>{t('common.date')}</th>
                  <th className={thCls}>{t('purchasing.returns.colPo')}</th>
                  <th className={thCls}>{t('purchasing.returns.colItems')}</th>
                  <th className={`${thCls} text-right`}>{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 align-top">
                    <td className={`${tdCls} font-medium`}>{r.returnNumber}</td>
                    <td className={tdCls}>{formatDMY(new Date(r.createdAt))}</td>
                    <td className={tdCls}>
                      <Link href={`/purchasing/purchase-orders/${r.purchaseOrderId}`} className="text-blue-700 hover:underline">
                        {r.purchaseOrder.poNumber ?? '—'}
                      </Link>
                      <span className="block text-xs text-gray-500">{r.purchaseOrder.supplier?.name ?? '—'}</span>
                    </td>
                    <td className={tdCls}>
                      {r.items.map((i) => `${i.product?.name ?? '?'} × ${i.quantity}`).join(', ')}
                      {r.reason && <span className="block text-xs text-gray-500">{r.reason}</span>}
                    </td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(Number(r.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageFrame>
  );
}
