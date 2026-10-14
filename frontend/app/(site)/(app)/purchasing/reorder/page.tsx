'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageSearch, ShoppingCart } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, btnPrimary, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';
import { ProductPicker, useLocations, useSuppliers, type PickedProduct } from '@/app/components/shared/ProductPicker';

type Line = {
  productId: string;
  name: string;
  sku: string | null;
  unit: string | null;
  onHand: number;
  onOrder: number;
  reorderPoint: number;
  reorderQuantity: number | null;
  suggestedQuantity: number;
  unitCost: number | null;
  preferredSupplier: { id: string; name: string } | null;
};

type Pick = { selected: boolean; quantity: string; supplierId: string };

export default function ReorderPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const suppliers = useSuppliers();
  const locations = useLocations();

  const [showAll, setShowAll] = useState(false);
  const [rows, setRows] = useState<Line[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PickedProduct | null>(null);
  const [settings, setSettings] = useState({ reorderPoint: '', reorderQuantity: '', preferredSupplierId: '' });

  const load = useCallback(async () => {
    const res = await apiFetch(`/reorder${showAll ? '?all=true' : ''}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('reorder.loadFailed'));
      return;
    }
    const lines: Line[] = body;
    setRows(lines);
    setPicks(
      Object.fromEntries(
        lines.map((l) => [
          l.productId,
          { selected: l.onHand + l.onOrder <= l.reorderPoint, quantity: String(l.suggestedQuantity), supplierId: l.preferredSupplier?.id ?? '' },
        ]),
      ),
    );
  }, [showAll, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const selected = (rows ?? []).filter((r) => picks[r.productId]?.selected);

  async function createPos() {
    setError(null);
    const items = selected.map((r) => ({
      productId: r.productId,
      quantity: Number(picks[r.productId].quantity.replace(',', '.')),
      supplierId: picks[r.productId].supplierId,
    }));
    if (items.some((i) => !i.supplierId)) {
      setError(t('reorder.needSupplier'));
      return;
    }
    if (items.some((i) => !(i.quantity > 0))) {
      setError(t('reorder.invalidQty'));
      return;
    }
    setBusy(true);
    const res = await apiFetch('/reorder/purchase-orders', {
      method: 'POST',
      body: JSON.stringify({ locationId: locationId || undefined, items }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(body?.message ?? t('reorder.createFailed'));
      return;
    }
    router.push(body.length === 1 ? `/purchasing/purchase-orders/${body[0].id}` : '/purchasing/purchase-orders');
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
    const res = await apiFetch(`/reorder/products/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        reorderPoint: num(settings.reorderPoint),
        reorderQuantity: num(settings.reorderQuantity),
        preferredSupplierId: settings.preferredSupplierId || null,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('reorder.saveFailed'));
      return;
    }
    setEditing(null);
    setSettings({ reorderPoint: '', reorderQuantity: '', preferredSupplierId: '' });
    load();
  }

  const setPick = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  return (
    <PageFrame icon={PackageSearch} title={t('reorder.title')} subtitle={t('reorder.subtitle')} width="max-w-6xl">
      <ErrorNote message={error} />

      {isAdmin && (
        <Card title={t('reorder.settingsTitle')}>
          {editing ? (
            <form onSubmit={saveSettings} className="space-y-3">
              <p className="text-sm font-medium">{editing.name}</p>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="text-sm">
                  <span className="block text-xs text-gray-500 mb-1">{t('reorder.reorderPoint')}</span>
                  <input inputMode="decimal" value={settings.reorderPoint} onChange={(e) => setSettings({ ...settings, reorderPoint: e.target.value })} placeholder={t('reorder.notWatched')} className={inputCls} />
                </label>
                <label className="text-sm">
                  <span className="block text-xs text-gray-500 mb-1">{t('reorder.reorderQuantity')}</span>
                  <input inputMode="decimal" value={settings.reorderQuantity} onChange={(e) => setSettings({ ...settings, reorderQuantity: e.target.value })} placeholder={t('reorder.auto')} className={inputCls} />
                </label>
                <label className="text-sm">
                  <span className="block text-xs text-gray-500 mb-1">{t('reorder.preferredSupplier')}</span>
                  <select value={settings.preferredSupplierId} onChange={(e) => setSettings({ ...settings, preferredSupplierId: e.target.value })} className={inputCls}>
                    <option value="">—</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" className="text-sm underline" onClick={() => setEditing(null)}>
                  {t('common.cancel')}
                </button>
                <button className={btnPrimary}>{t('common.save')}</button>
              </div>
            </form>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-2">{t('reorder.settingsHint')}</p>
              <ProductPicker onPick={setEditing} placeholder={t('reorder.pickProduct')} />
            </>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {t('reorder.showAll')}
        </label>
        <div className="flex items-center gap-2">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={`${inputCls} w-auto`} aria-label={t('reorder.deliverTo')}>
            <option value="">{t('reorder.deliverTo')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button className={btnPrimary} disabled={busy || selected.length === 0} onClick={createPos}>
            <ShoppingCart size={14} /> {t('reorder.createPos', { n: selected.length })}
          </button>
        </div>
      </div>

      <Card>
        {rows && rows.length === 0 ? (
          <p className="text-sm text-gray-500">{showAll ? t('reorder.noneWatched') : t('reorder.noneLow')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls} />
                  <th className={thCls}>{t('reorder.product')}</th>
                  <th className={`${thCls} text-right`}>{t('reorder.onHand')}</th>
                  <th className={`${thCls} text-right`}>{t('reorder.onOrder')}</th>
                  <th className={`${thCls} text-right`}>{t('reorder.reorderPoint')}</th>
                  <th className={thCls}>{t('reorder.orderQty')}</th>
                  <th className={thCls}>{t('reorder.supplier')}</th>
                  <th className={`${thCls} text-right`}>{t('reorder.estCost')}</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => {
                  const p = picks[r.productId];
                  if (!p) return null;
                  const low = r.onHand + r.onOrder <= r.reorderPoint;
                  return (
                    <tr key={r.productId} className="border-t border-gray-100">
                      <td className={tdCls}>
                        <input type="checkbox" checked={p.selected} onChange={(e) => setPick(r.productId, { selected: e.target.checked })} aria-label={r.name} />
                      </td>
                      <td className={tdCls}>
                        <span className={low ? 'font-semibold text-red-700' : ''}>{r.name}</span>
                        {r.sku && <span className="block text-xs text-gray-500">{r.sku}</span>}
                      </td>
                      <td className={`${tdCls} text-right tabular-nums`}>{r.onHand}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{r.onOrder || '—'}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{r.reorderPoint}</td>
                      <td className={tdCls}>
                        <input inputMode="decimal" value={p.quantity} onChange={(e) => setPick(r.productId, { quantity: e.target.value })} className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right" />
                      </td>
                      <td className={tdCls}>
                        <select value={p.supplierId} onChange={(e) => setPick(r.productId, { supplierId: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1 text-sm max-w-40">
                          <option value="">—</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`${tdCls} text-right tabular-nums text-gray-600`}>
                        {r.unitCost != null ? formatIDR(r.unitCost * Number(p.quantity || 0)) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageFrame>
  );
}
