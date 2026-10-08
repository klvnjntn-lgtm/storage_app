'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';

type CostHistoryRow = {
  id: string;
  createdAt: string;
  source: 'GOODS_RECEIPT' | 'SALES_RETURN' | 'SALE_REVERSAL' | 'OPENING_IMPORT' | 'MANUAL';
  sourceId: string | null;
  previousCost: number | null;
  newCost: number | null;
  quantityBefore: number;
  quantityIn: number;
  unitCostIn: number | null;
  user: string | null;
};

// Why a product's weighted-average cost is what it is (admin only — cost is
// admin data). Every receipt, return, opening import or manual edit that
// fed the average, newest first.
export function CostHistoryPanel({ productId, currentCost }: { productId: string; currentCost: number | null }) {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<CostHistoryRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiFetch(`/products/${productId}/cost-history`);
      if (!cancelled) setRows(res.ok ? await res.json() : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const money = (n: number | null) => (n == null ? '—' : formatIDR(n));

  return (
    <section>
      <h2 className="text-lg font-bold mb-1">{t('inventory.stockDetail.costHistory')}</h2>
      <p className="text-xs text-gray-500 mb-1">{t('inventory.stockDetail.costHistoryHint')}</p>
      <p className="text-sm font-semibold mb-3">
        {currentCost != null
          ? t('inventory.stockDetail.currentCost', { cost: formatIDR(currentCost) })
          : t('inventory.stockDetail.noCostYet')}
      </p>

      <div className="border-2 border-gray-300 rounded-md overflow-x-auto bg-white">
        <table className="w-full text-sm">
          <thead className="bg-blue-50/60 border-b-2 border-gray-300 text-left">
            <tr>
              <th className="p-3 font-semibold">{t('inventory.stockDetail.colDate')}</th>
              <th className="p-3 font-semibold">{t('inventory.stockDetail.colCostSource')}</th>
              <th className="p-3 font-semibold">{t('inventory.stockDetail.colOnHandBefore')}</th>
              <th className="p-3 font-semibold">{t('inventory.stockDetail.colCostIn')}</th>
              <th className="p-3 font-semibold">{t('inventory.stockDetail.colCostChange')}</th>
              <th className="p-3 font-semibold">{t('inventory.stockDetail.colUser')}</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r, idx) => (
              <tr key={r.id} className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}>
                <td className="p-3 text-gray-500 text-xs whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleString(language === 'id' ? 'id-ID' : 'en-US')}
                </td>
                <td className="p-3">{t(`inventory.stockDetail.costSource.${r.source}`)}</td>
                <td className="p-3">{r.quantityBefore}</td>
                <td className="p-3 whitespace-nowrap">
                  {r.quantityIn > 0
                    ? t('inventory.stockDetail.costInDetail', { qty: r.quantityIn, cost: money(r.unitCostIn) })
                    : '—'}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {money(r.previousCost)} → <span className="font-semibold">{money(r.newCost)}</span>
                </td>
                <td className="p-3 text-gray-700">{r.user ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-500">{t('inventory.stockDetail.noCostHistory')}</div>
        )}
      </div>
    </section>
  );
}
