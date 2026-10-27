'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Undo2, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useWarehouseOps } from '@/lib/hooks/useWarehouseOps';
import { defaultLocation } from '@/lib/locations';
import { useLanguage } from '@/app/context/LanguageContext';
import { PurchaseOrderDetail } from './types';
import { SerialButton, SerialPicker } from '@/app/components/shared/SerialPicker';

type ReturnableItem = {
  purchaseOrderItemId: string;
  productId: string | null;
  received: number;
  returned: number;
  returnable: number;
  trackSerials?: boolean;
};

// Sends received goods back to the supplier: stock leaves the chosen
// location and what's owed to the supplier drops by what those units cost
// (backend PurchaseReturnService). Lines start at 0.
export function PurchaseReturnDialog({
  po,
  onReturned,
  onClose,
}: {
  po: PurchaseOrderDetail;
  onReturned: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [items, setItems] = useState<ReturnableItem[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [pickedLocationId, setLocationId] = useState(po.locationId ?? '');
  // Only warehouse orgs choose a location; the rest always use CENTRE.
  const warehouseOps = useWarehouseOps();
  const locationId = warehouseOps ? pickedLocationId : (defaultLocation(locations)?.id ?? '');
  const [reason, setReason] = useState('');
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [picking, setPicking] = useState<ReturnableItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [res, locRes] = await Promise.all([apiFetch(`/purchase-orders/${po.id}/returnable`), apiFetch('/locations')]);
        if (locRes.ok) setLocations(await locRes.json());
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(body?.message ?? t('purchasing.returns.loadFailed'));
          return;
        }
        setItems((body.items as ReturnableItem[]).filter((i) => i.returnable > 0));
      } catch {
        setError(t('purchasing.purchaseOrderDetail.serverError'));
      }
    })();
  }, [po.id, t]);

  const nameOf = (poItemId: string) =>
    po.items.find((i) => i.id === poItemId)?.product?.name ?? t('purchasing.purchaseOrderDetail.unknownItem');

  async function submit() {
    if (!items) return;
    if (!locationId) {
      setError(t('purchasing.purchaseOrderDetail.chooseLocation'));
      return;
    }
    const lines: { purchaseOrderItemId: string; quantity: number; serialNumbers?: string[] }[] = [];
    for (const [idx, item] of items.entries()) {
      const raw = (qty[item.purchaseOrderItemId] ?? '').trim().replace(',', '.');
      const n = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setError(t('purchasing.purchaseOrderDetail.invalidReceiveQty', { line: idx + 1 }));
        return;
      }
      if (n > item.returnable) {
        setError(t('purchasing.returns.tooMuch', { line: idx + 1, max: item.returnable }));
        return;
      }
      const picked = serials[item.purchaseOrderItemId] ?? [];
      if (n > 0 && item.trackSerials && picked.length !== n) {
        setError(t('serials.pickCountMismatch', { line: idx + 1, n }));
        return;
      }
      if (n > 0)
        lines.push({
          purchaseOrderItemId: item.purchaseOrderItemId,
          quantity: Math.round(n * 100) / 100,
          ...(item.trackSerials && { serialNumbers: picked }),
        });
    }
    if (lines.length === 0) {
      setError(t('purchasing.returns.nothing'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`/purchase-orders/${po.id}/returns`, {
        method: 'POST',
        body: JSON.stringify({ locationId, reason: reason.trim() || undefined, items: lines }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? t('purchasing.returns.failed'));
      }
      onReturned();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('purchasing.purchaseOrderDetail.serverError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      {picking && picking.productId && (
        <SerialPicker
          productId={picking.productId}
          productName={nameOf(picking.purchaseOrderItemId)}
          locationId={locationId}
          quantity={Math.floor(Number(qty[picking.purchaseOrderItemId] || 0))}
          value={serials[picking.purchaseOrderItemId] ?? []}
          onChange={(list) => setSerials((s) => ({ ...s, [picking.purchaseOrderItemId]: list }))}
          onClose={() => setPicking(null)}
        />
      )}
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
          <Undo2 size={16} strokeWidth={2} />
          {t('purchasing.returns.dialogTitle')}
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-black" aria-label={t('common.cancel')}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3">{t('purchasing.returns.dialogDescription')}</p>

      {warehouseOps && (
        <>
          <label className="text-xs text-gray-500 mb-1 block">{t('purchasing.returns.fromLocation')}</label>
          <select
            value={pickedLocationId}
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
        </>
      )}

      {items && items.length === 0 && <p className="text-sm text-gray-500 mb-3">{t('purchasing.returns.noneReturnable')}</p>}
      {items && items.length > 0 && (
        <div className="border-2 border-gray-200 rounded-md mb-3 max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left font-semibold px-2 py-1.5">{t('purchasing.purchaseOrderDetail.colItem')}</th>
                <th className="text-right font-semibold px-2 py-1.5">{t('purchasing.returns.colReturnable')}</th>
                <th className="text-right font-semibold px-2 py-1.5">{t('purchasing.returns.colReturnNow')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.purchaseOrderItemId} className="border-t border-gray-100">
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{nameOf(item.purchaseOrderItemId)}</div>
                    {item.returned > 0 && (
                      <div className="text-[11px] text-gray-500">{t('purchasing.returns.alreadyReturned', { n: item.returned })}</div>
                    )}
                    {item.trackSerials && Number(qty[item.purchaseOrderItemId] || 0) > 0 && (
                      <div className="mt-1">
                        <SerialButton
                          count={(serials[item.purchaseOrderItemId] ?? []).length}
                          quantity={Number(qty[item.purchaseOrderItemId] || 0)}
                          onClick={() => (locationId ? setPicking(item) : setError(t('purchasing.purchaseOrderDetail.chooseLocation')))}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-600">{item.returnable}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      value={qty[item.purchaseOrderItemId] ?? ''}
                      onChange={(e) => setQty((prev) => ({ ...prev, [item.purchaseOrderItemId]: e.target.value }))}
                      inputMode="decimal"
                      placeholder="0"
                      className="w-20 border-2 border-gray-300 rounded-md px-2 py-1 text-right outline-none focus:border-blue-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <label className="text-xs text-gray-500 mb-1 block">{t('purchasing.returns.reason')}</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={500}
        className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 resize-none mb-3"
      />

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-2.5 text-xs mb-3">
          <AlertCircle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 text-sm px-3 py-2 rounded-md border-2 border-gray-300 font-semibold hover:bg-gray-100">
          {t('common.cancel')}
        </button>
        <button
          onClick={submit}
          disabled={saving || !items || items.length === 0}
          className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:bg-gray-300"
        >
          <Undo2 size={14} strokeWidth={2} />
          {saving ? t('common.saving') : t('purchasing.returns.confirm')}
        </button>
      </div>
    </div>
  );
}
