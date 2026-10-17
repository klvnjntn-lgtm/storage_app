'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileCheck2, Landmark } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, thCls, tdCls } from '@/app/components/shared/PageFrame';
import { MATCH_STYLE } from '@/app/components/purchase-orders/ThreeWayMatchPanel';

type MatchStatus = 'NOT_BILLED' | 'MATCHED' | 'UNDER_BILLED' | 'OVER_BILLED';
type Row = {
  id: string;
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  amount: string;
  purchaseOrder: { id: string; poNumber: string | null };
  supplier: { name: string } | null;
  match: { status: MatchStatus; received: number; billed: number; difference: number };
};

// Supplier bills across all POs, filterable by match result — the list to
// clear before paying suppliers. Bills are recorded on the PO's page.
export default function SupplierBillsPage() {
  const { authorized } = useRequireAdmin();
  const { t } = useLanguage();
  const [status, setStatus] = useState<MatchStatus | ''>('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorized) return;
    (async () => {
      const res = await apiFetch(`/supplier-bills${status ? `?status=${status}` : ''}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.message ?? t('purchasing.bills.loadFailed'));
      else setRows(body);
    })();
  }, [authorized, status, t]);

  if (!authorized) return null;

  return (
    <PageFrame
      icon={FileCheck2}
      title={t('purchasing.bills.pageTitle')}
      subtitle={t('purchasing.bills.pageSubtitle')}
      actions={
        <Link
          href="/accounting/cash-statement/new"
          className="flex items-center justify-center gap-1.5 text-sm px-3.5 py-2.5 rounded-lg border border-blue-500/25 text-blue-700 font-semibold hover:bg-blue-50 active:bg-blue-100 transition-colors"
        >
          <Landmark size={16} strokeWidth={2} />
          <span className="hidden sm:inline">{t('accounting.cashStatement.generateButton')}</span>
        </Link>
      }
    >
      <ErrorNote message={error} />
      <div className="flex flex-wrap gap-1.5">
        {(['', 'MATCHED', 'UNDER_BILLED', 'OVER_BILLED'] as const).map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={`text-sm px-3 py-1.5 rounded-full border ${status === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300'}`}
          >
            {s ? t(`purchasing.bills.status.${s}`) : t('purchasing.bills.all')}
          </button>
        ))}
      </div>
      <Card>
        {rows && rows.length === 0 ? (
          <p className="text-sm text-gray-500">{t('purchasing.bills.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}>{t('purchasing.bills.billNumber')}</th>
                  <th className={thCls}>{t('purchasing.bills.supplier')}</th>
                  <th className={thCls}>{t('purchasing.returns.colPo')}</th>
                  <th className={thCls}>{t('purchasing.bills.billDate')}</th>
                  <th className={thCls}>{t('purchasing.bills.dueDate')}</th>
                  <th className={`${thCls} text-right`}>{t('common.amount')}</th>
                  <th className={thCls}>{t('purchasing.bills.matchTitle')}</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className={`${tdCls} font-medium`}>{r.billNumber}</td>
                    <td className={tdCls}>{r.supplier?.name ?? '—'}</td>
                    <td className={tdCls}>
                      <Link href={`/purchasing/purchase-orders/${r.purchaseOrder.id}`} className="text-blue-700 hover:underline">
                        {r.purchaseOrder.poNumber ?? '—'}
                      </Link>
                    </td>
                    <td className={tdCls}>{formatDMY(new Date(r.billDate))}</td>
                    <td className={tdCls}>{r.dueDate ? formatDMY(new Date(r.dueDate)) : '—'}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(Number(r.amount))}</td>
                    <td className={tdCls}>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${MATCH_STYLE[r.match.status]}`}>
                        {t(`purchasing.bills.status.${r.match.status}`)}
                      </span>
                    </td>
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
