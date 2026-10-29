'use client';

import { useMechanics } from '@/app/components/workshop/WorkOrderForm';
import { BranchFilter } from '@/app/components/shared/BranchFilter';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardList, Plus, Search, Car, User } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { DocFlow, docRef } from '@/app/components/shared/DocFlow';
import { PageFrame, ErrorNote, btnPrimary, inputCls } from '@/app/components/shared/PageFrame';
import {
  WORK_ORDER_STATUSES,
  statusStyle,
  type WorkOrder,
  type WorkOrderStatus,
} from '@/app/components/workshop/workOrders';

// Open jobs first: everything not done or cancelled.
type Filter = 'OPEN' | WorkOrderStatus | 'ALL';

export default function WorkOrdersPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [rows, setRows] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [q, setQ] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  // The mechanic responsible for the job.
  const [mechanicFilter, setMechanicFilter] = useState('');
  const mechanics = useMechanics();

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        if (filter !== 'OPEN' && filter !== 'ALL') params.set('status', filter);
        if (branchFilter) params.set('branchId', branchFilter);
        if (mechanicFilter) params.set('mechanicId', mechanicFilter);
        const res = await apiFetch(`/work-orders?${params}`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.message ?? t('workshop.workOrders.loadFailed'));
          setRows([]);
          return;
        }
        const list: WorkOrder[] = body;
        setRows(
          filter === 'OPEN' ? list.filter((w) => w.status !== 'DONE' && w.status !== 'CANCELLED' && !w.invoicedId) : list,
        );
      } catch {
        if (!cancelled) setError(t('workshop.workOrders.serverError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [filter, q, branchFilter, mechanicFilter, t]);

  // Same order as the other sales lists: All first, then shortcuts.
  const filters: Filter[] = ['ALL', 'OPEN', ...WORK_ORDER_STATUSES];

  return (
    <PageFrame
      icon={ClipboardList}
      title={t('workshop.workOrders.title')}
      subtitle={t('workshop.workOrders.subtitle')}
      actions={
        <Link href="/workshop/work-orders/new" className={btnPrimary}>
          <Plus size={14} />
          <span className="hidden sm:inline">{t('workshop.workOrders.new')}</span>
        </Link>
      }
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className={`${inputCls} pl-8`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('workshop.workOrders.searchPlaceholder')}
          />
        </div>
        {mechanics.length > 0 && (
          <select
            aria-label={t('workshop.workOrders.mechanic')}
            value={mechanicFilter}
            onChange={(e) => setMechanicFilter(e.target.value)}
            className={`${inputCls} sm:w-48`}
          >
            <option value="">{t('workshop.workOrders.allMechanics')}</option>
            {mechanics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <BranchFilter value={branchFilter} onChange={setBranchFilter} selectClassName={`${inputCls} sm:w-48`} />
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              filter === f
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'
            }`}
          >
            {t(`workshop.workOrders.filter.${f}`)}
          </button>
        ))}
      </div>

      <ErrorNote message={error} />
      {loading && rows.length === 0 && <p className="text-sm text-gray-500">{t('workshop.workOrders.loading')}</p>}
      {!loading && rows.length === 0 && !error && <p className="text-sm text-gray-400">{t('workshop.workOrders.empty')}</p>}

      <div className="flex flex-col gap-2">
        {rows.map((w) => (
          // A div, not a <button>: the document links inside can't nest in one.
          <div
            key={w.id}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/workshop/work-orders/${w.id}`)}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                router.push(`/workshop/work-orders/${w.id}`);
              }
            }}
            className="text-left border border-blue-500/15 rounded-xl p-3 bg-white shadow-sm hover:border-blue-500/35 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-gray-500">{w.number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(w.status)}`}>
                    {t(`workshop.workOrders.status.${w.status}`)}
                  </span>
                </div>
                <p className="font-semibold mt-1 flex items-center gap-1.5 truncate">
                  <Car size={14} className="text-blue-600/60 shrink-0" />
                  {w.vehicle.plateNumber} · {w.vehicle.vehicleModel}
                </p>
                {w.complaint && <p className="text-sm text-gray-700 mt-0.5 line-clamp-2">{w.complaint}</p>}
                <p className="text-xs text-gray-400 mt-1 flex items-center gap-3 flex-wrap">
                  <span>{w.customer.name}</span>
                  {w.mechanic && (
                    <span className="inline-flex items-center gap-1">
                      <User size={11} />
                      {w.mechanic.name}
                    </span>
                  )}
                  <span>{formatDMY(new Date(w.createdAt))}</span>
                </p>
                {/* The quotation it was made from (and its additions), and the invoices it became. */}
                <DocFlow
                  from={(w.quotations ?? []).flatMap((q) => docRef('quotation', q, q.quotationNumber))}
                  to={w.invoices.flatMap((i) => docRef('invoice', i, i.invoiceNumber))}
                />
              </div>
              <span className="text-sm font-semibold shrink-0">{formatIDR(Number(w.estimatedTotal))}</span>
            </div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
