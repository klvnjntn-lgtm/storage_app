'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, PackageCheck, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { PurchaseOrderDetail } from './types';

type SummaryItem = {
  purchaseOrderItemId: string;
  productId: string | null;
  ordered: number;
  previouslyReceived: number;
  remaining: number;
};

// Receives stock against a sent PO: adds it at the chosen location, moves the
// PO to partially/fully received and records the amount owed to the supplier
// (what supplier payments are then paid against). Each line starts at what's
// still outstanding; set a line to 0 to leave it for a later delivery.
export function ReceiveGoodsDialog({
  po,
  onReceived,
  onClose,
}: {
  po: PurchaseOrderDetail;
  onReceived: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [items, setItems] = useState<SummaryItem[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [locationId, setLocationId] = useState(po.locationId ?? '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [summaryRes, locRes] = await Promise.all([
          apiFetch(`/purchase-orders/${po.id}/receiving-summary`),
          apiFetch('/locations'),
        ]);
        if (locRes.ok) setLocations(await locRes.json());
        const body = await summaryRes.json().catch(() => null);
        if (!summaryRes.ok) {
          setError(body?.message ?? t('purchasing.purchaseOrderDetail.requestFailed', { status: summaryRes.status }));
          return;
        }
        const open = (body.items as SummaryItem[]).filter((i) => i.remaining > 0);
        setItems(open);
        setQty(Object.fromEntries(open.map((i) => [i.purchaseOrderItemId, String(i.remaining)])));
      } catch {
        setError(t('purchasing.purchaseOrderDetail.serverError'));
      }
    })();
  }, [po.id, t]);

  const nameOf = (poItemId: string) => {
    const item = po.items.find((i) => i.id === poItemId);
    return item?.product?.name ?? t('purchasing.purchaseOrderDetail.unknownItem');
  };

  async function handleReceive() {
    if (!items) return;
    if (!locationId) {
      setError(t('purchasing.purchaseOrderDetail.chooseLocation'));
      return;
    }
    const lines: { purchaseOrderItemId: string; quantity: number }[] = [];
    for (const [idx, item] of items.entries()) {
      const raw = (qty[item.purchaseOrderItemId] ?? '').trim().replace(',', '.');
      const n = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(n) || n < 0 || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
        setError(t('purchasing.purchaseOrderDetail.invalidReceiveQty', { line: idx + 1 }));
        return;
      }
      if (n > item.remaining) {
        setError(t('purchasing.purchaseOrderDetail.receiveTooMuch', { line: idx + 1, remaining: item.remaining }));
        return;
      }
      if (n > 0) lines.push({ purchaseOrderItemId: item.purchaseOrderItemId, quantity: Math.round(n * 100) / 100 });
    }
    if (lines.length === 0) {
      setError(t('purchasing.purchaseOrderDetail.nothingToReceive'));
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`/purchase-orders/${po.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({ locationId, notes: notes.trim() || undefined, items: lines }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? t('purchasing.purchaseOrderDetail.requestFailed', { status: res.status }));
      }
      onReceived();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('purchasing.purchaseOrderDetail.serverError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-blue-700">
          <PackageCheck size={16} strokeWidth={2} />
          {t('purchasing.purchaseOrderDetail.receiveTitle')}
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-black" aria-label={t('common.cancel')}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-3">{t('purchasing.purchaseOrderDetail.receiveDescription')}</p>

      <label className="text-xs text-gray-500 mb-1 block">{t('purchasing.purchaseOrderDetail.receiveLocation')}</label>
      <select
        value={locationId}
        onChange={(e) => setLocationId(e.target.value)}
        className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 mb-3"
      >
        <option value="">—</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      {items === null && !error && (
        <p className="text-sm text-gray-500 mb-3">{t('purchasing.purchaseOrderDetail.loading')}</p>
      )}

      {items && (
        <div className="border-2 border-gray-200 rounded-md mb-3 max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left font-semibold px-2 py-1.5">{t('purchasing.purchaseOrderDetail.colItem')}</th>
                <th className="text-right font-semibold px-2 py-1.5">{t('purchasing.purchaseOrderDetail.colRemaining')}</th>
                <th className="text-right font-semibold px-2 py-1.5">{t('purchasing.purchaseOrderDetail.colReceiveNow')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.purchaseOrderItemId} className="border-t border-gray-100">
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{nameOf(item.purchaseOrderItemId)}</div>
                    {item.previouslyReceived > 0 && (
                      <div className="text-[11px] text-gray-500">
                        {t('purchasing.purchaseOrderDetail.alreadyReceived', {
                          received: item.previouslyReceived,
                          ordered: item.ordered,
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-600">{item.remaining}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      value={qty[item.purchaseOrderItemId] ?? ''}
                      onChange={(e) => setQty((prev) => ({ ...prev, [item.purchaseOrderItemId]: e.target.value }))}
                      onFocus={(e) => e.target.select()}
                      inputMode="decimal"
                      className="w-20 border-2 border-gray-300 rounded-md px-2 py-1 text-right outline-none focus:border-blue-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <label className="text-xs text-gray-500 mb-1 block">{t('purchasing.purchaseOrderDetail.receiveNotes')}</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 resize-none mb-3"
      />

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-2.5 text-xs mb-3">
          <AlertCircle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 text-sm px-3 py-2 rounded-md border-2 border-gray-300 font-semibold hover:bg-gray-100"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={handleReceive}
          disabled={saving || !items || items.length === 0}
          className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-gray-300"
        >
          <PackageCheck size={14} strokeWidth={2} />
          {saving ? t('purchasing.purchaseOrderDetail.receiving') : t('purchasing.purchaseOrderDetail.confirmReceive')}
        </button>
      </div>
    </div>
  );
}
