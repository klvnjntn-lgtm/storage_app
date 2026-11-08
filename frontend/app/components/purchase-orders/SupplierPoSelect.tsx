'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { SupplierPicker } from './SupplierPicker';
import type { Supplier } from '@/app/components/suppliers/types';

export type PoOption = {
  id: string;
  poNumber: string | null;
  status: string;
  total: string;
  orderDate: string | null;
  createdAt: string;
  supplierId: string | null;
};

// Pick a supplier, then one of their purchase orders — the start of recording a supplier's bill or
// paying them. Drafts and cancelled orders are left out: neither can be billed or paid.
export function SupplierPoSelect({
  supplier,
  onSupplierChange,
  poId,
  onPoChange,
}: {
  supplier: Supplier | null;
  onSupplierChange: (s: Supplier | null) => void;
  poId: string;
  onPoChange: (po: PoOption | null) => void;
}) {
  const { t } = useLanguage();
  const [pos, setPos] = useState<PoOption[] | null>(null);

  useEffect(() => {
    if (!supplier) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPos(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await apiFetch(`/purchase-orders?${new URLSearchParams({ supplierId: supplier.id, pageSize: '200' })}`);
      const body = res.ok ? await res.json() : { data: [] };
      if (cancelled) return;
      setPos((body.data as PoOption[]).filter((p) => p.status !== 'DRAFT' && p.status !== 'CANCELLED'));
    })();
    return () => {
      cancelled = true;
    };
  }, [supplier]);

  const select =
    'w-full border border-blue-500/20 rounded-lg p-2 text-sm bg-white outline-none focus:border-blue-500/50 disabled:bg-gray-50 disabled:text-gray-400';

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('purchasing.bills.supplier')}</label>
        <SupplierPicker
          supplier={supplier}
          onChange={(s) => {
            onSupplierChange(s);
            onPoChange(null);
          }}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('purchasing.returns.colPo')}</label>
        <select
          value={poId}
          disabled={!supplier || !pos}
          onChange={(e) => onPoChange(pos?.find((p) => p.id === e.target.value) ?? null)}
          className={select}
        >
          <option value="">
            {!supplier
              ? t('purchasing.billNew.pickSupplierFirst')
              : pos && pos.length === 0
                ? t('purchasing.billNew.noOrders')
                : t('purchasing.billNew.pickOrder')}
          </option>
          {pos?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.poNumber ?? '—'} · {formatDMY(new Date(p.orderDate ?? p.createdAt))} · {formatIDR(Number(p.total))}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
