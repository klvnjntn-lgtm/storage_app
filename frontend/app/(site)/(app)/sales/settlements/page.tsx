'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { HandCoins, Receipt, Search, ShoppingCart, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, TabBar, thCls, tdCls } from '@/app/components/shared/PageFrame';
import { RecordPaymentDialog } from '@/app/components/invoices/RecordPaymentDialog';
import { SupplierPaymentsPanel } from '@/app/components/purchase-orders/SupplierPaymentsPanel';

type Receivable = {
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  total: number;
  amountPaid: number;
  outstanding: number;
};

type Payable = {
  purchaseOrderId: string;
  poNumber: string | null;
  supplierName: string | null;
  orderDate: string | null;
  dueDate: string | null;
  totalOwed: number;
  amountPaid: number;
  outstanding: number;
};

// One row, whichever side it's on.
type Row = {
  id: string;
  number: string;
  party: string;
  date: string | null;
  dueDate: string | null;
  total: number;
  paid: number;
  outstanding: number;
  href: string;
};

type Tab = 'receivable' | 'payable';

export default function SettlementsPage() {
  return (
    <Suspense fallback={null}>
      <Settlements />
    </Suspense>
  );
}

// Days past the due date, counted in calendar days (0 = due today, negative = not yet due).
function daysOverdue(due: string | null): number | null {
  if (!due) return null;
  const d = new Date(due);
  const today = new Date();
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((b - a) / 86_400_000);
}

// Pelunasan: every invoice customers still owe on and every purchase order still owed to a
// supplier, oldest due first, each with a button to record a payment right there.
function Settlements() {
  const { authorized } = useRequireAdmin();
  const { t } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = params.get('tab') === 'payable' ? 'payable' : 'receivable';
  const [receivables, setReceivables] = useState<Receivable[] | null>(null);
  const [payables, setPayables] = useState<Payable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [paying, setPaying] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch('/settlements');
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('settlements.loadFailed'));
      return;
    }
    setError(null);
    setReceivables(body.receivables);
    setPayables(body.payables);
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (authorized) load();
  }, [authorized, load]);

  const rows: Row[] | null = useMemo(() => {
    if (tab === 'receivable') {
      return (
        receivables?.map((r) => ({
          id: r.invoiceId,
          number: r.invoiceNumber ?? '—',
          party: r.customerName ?? '—',
          date: r.invoiceDate,
          dueDate: r.dueDate,
          total: r.total,
          paid: r.amountPaid,
          outstanding: r.outstanding,
          href: `/sales/invoices/${r.invoiceId}`,
        })) ?? null
      );
    }
    return (
      payables?.map((p) => ({
        id: p.purchaseOrderId,
        number: p.poNumber ?? '—',
        party: p.supplierName ?? '—',
        date: p.orderDate,
        dueDate: p.dueDate,
        total: p.totalOwed,
        paid: p.amountPaid,
        outstanding: p.outstanding,
        href: `/purchasing/purchase-orders/${p.purchaseOrderId}`,
      })) ?? null
    );
  }, [tab, receivables, payables]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => !q || r.number.toLowerCase().includes(q) || r.party.toLowerCase().includes(q))
      .filter((r) => !overdueOnly || (daysOverdue(r.dueDate) ?? 0) > 0);
  }, [rows, search, overdueOnly]);

  if (!authorized) return null;

  const totalOutstanding = shown.reduce((s, r) => s + r.outstanding, 0);
  const setTab = (next: Tab) => router.replace(next === 'payable' ? '?tab=payable' : '?', { scroll: false });

  return (
    <PageFrame
      icon={HandCoins}
      title={t('settlements.title')}
      subtitle={t('settlements.subtitle')}
      width="max-w-6xl"
      below={
        <TabBar
          tabs={[
            { key: 'receivable', label: t('settlements.tabReceivable'), icon: Receipt },
            { key: 'payable', label: t('settlements.tabPayable'), icon: ShoppingCart },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      <ErrorNote message={error} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('settlements.search')}
              className="w-full border border-gray-300 rounded-md pl-8 pr-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            {t('settlements.overdueOnly')}
          </label>
        </div>

        {rows === null ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">
            {tab === 'receivable' ? t('settlements.emptyReceivable') : t('settlements.emptyPayable')}
          </p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-gray-500">{t('settlements.noMatch')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}>{t('settlements.colNumber')}</th>
                  <th className={thCls}>{tab === 'receivable' ? t('settlements.colCustomer') : t('settlements.colSupplier')}</th>
                  <th className={thCls}>{t('settlements.colDate')}</th>
                  <th className={thCls}>{t('settlements.colDue')}</th>
                  <th className={`${thCls} text-right`}>{t('settlements.colTotal')}</th>
                  <th className={`${thCls} text-right`}>{t('settlements.colPaid')}</th>
                  <th className={`${thCls} text-right`}>{t('settlements.colOutstanding')}</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const days = daysOverdue(r.dueDate);
                  return (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className={`${tdCls} font-medium whitespace-nowrap`}>
                        <Link href={r.href} className="text-blue-700 hover:underline">
                          {r.number}
                        </Link>
                      </td>
                      <td className={tdCls}>{r.party}</td>
                      <td className={`${tdCls} whitespace-nowrap`}>{r.date ? formatDMY(new Date(r.date)) : '—'}</td>
                      <td className={`${tdCls} whitespace-nowrap`}>
                        {r.dueDate ? formatDMY(new Date(r.dueDate)) : '—'}
                        {days !== null && days > 0 && (
                          <div className="text-xs font-semibold text-red-700">{t('settlements.overdueDays', { days })}</div>
                        )}
                        {days === 0 && <div className="text-xs font-semibold text-amber-700">{t('settlements.dueToday')}</div>}
                      </td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(r.total)}</td>
                      <td className={`${tdCls} text-right tabular-nums text-gray-600`}>{formatIDR(r.paid)}</td>
                      <td className={`${tdCls} text-right tabular-nums font-semibold`}>{formatIDR(r.outstanding)}</td>
                      <td className={`${tdCls} text-right whitespace-nowrap`}>
                        <button
                          onClick={() => setPaying(r)}
                          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                        >
                          {t('settlements.recordPayment')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={2} className={`${tdCls} text-gray-500`}>{t('settlements.count', { count: shown.length })}</td>
                  <td colSpan={4} className={`${tdCls} text-right font-semibold`}>{t('settlements.totalOutstanding')}</td>
                  <td className={`${tdCls} text-right font-semibold tabular-nums`}>{formatIDR(totalOutstanding)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {tab === 'payable' && payables?.length === 0 && (
          <p className="text-xs text-gray-400 mt-2">{t('settlements.payableNeedsBooks')}</p>
        )}
      </Card>

      {paying && tab === 'receivable' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div role="dialog" aria-modal="true" className="bg-white rounded-md shadow-lg w-full max-w-sm">
            <div className="px-4 pt-4 font-semibold">{t('settlements.payTitle', { number: paying.number })}</div>
            <RecordPaymentDialog
              invoiceId={paying.id}
              balanceDue={paying.outstanding}
              onRecorded={load}
              onClose={() => setPaying(null)}
            />
          </div>
        </div>
      )}

      {paying && tab === 'payable' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div role="dialog" aria-modal="true" className="bg-white rounded-md shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 pt-4">
              <span className="font-semibold">{t('settlements.payTitle', { number: paying.number })}</span>
              <button onClick={() => setPaying(null)} aria-label={t('settlements.close')} className="text-gray-500 hover:text-gray-800">
                <X size={18} />
              </button>
            </div>
            <div className="p-4">
              <SupplierPaymentsPanel purchaseOrderId={paying.id} refreshKey={0} onChanged={load} />
            </div>
          </div>
        </div>
      )}
    </PageFrame>
  );
}
