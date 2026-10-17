'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatDMY } from '@/lib/dates';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, btnPrimary, btnSecondary, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';
import { ProductPicker, type PickedProduct } from '@/app/components/shared/ProductPicker';
import DatePicker from '@/app/components/shared/DatePicker';

type Batch = {
  id: string;
  product: { id: string; name: string; sku: string | null; unit: string | null };
  batchNumber: string;
  expiryDate: string | null;
  received: number;
  remaining: number;
  daysToExpiry: number | null;
};

function expiryStyle(days: number | null) {
  if (days === null) return 'text-gray-500';
  if (days < 0) return 'text-red-700 font-semibold';
  if (days <= 30) return 'text-amber-700 font-semibold';
  return 'text-gray-700';
}

export default function BatchesPage() {
  const { t } = useLanguage();
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const [filter, setFilter] = useState<'expiring' | 'all'>('expiring');
  const [rows, setRows] = useState<Batch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [form, setForm] = useState({ batchNumber: '', expiryDate: '', quantity: '' });
  const [tracking, setTracking] = useState<PickedProduct | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/batches${filter === 'expiring' ? '?expiringWithinDays=60' : ''}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.message ?? t('batches.loadFailed'));
    else setRows(body.batches);
  }, [filter, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function addBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    setError(null);
    const res = await apiFetch('/batches', {
      method: 'POST',
      body: JSON.stringify({
        productId: product.id,
        batchNumber: form.batchNumber.trim(),
        expiryDate: form.expiryDate || undefined,
        quantity: Number(form.quantity.replace(',', '.')),
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('batches.saveFailed'));
      return;
    }
    setAdding(false);
    setProduct(null);
    setForm({ batchNumber: '', expiryDate: '', quantity: '' });
    load();
  }

  async function setTrack(p: PickedProduct, on: boolean) {
    const res = await apiFetch(`/batches/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ trackBatches: on }) });
    setNotice(res.ok ? t(on ? 'batches.trackingOn' : 'batches.trackingOff', { name: p.name }) : t('batches.saveFailed'));
    setTracking(null);
  }

  return (
    <PageFrame
      icon={CalendarClock}
      title={t('batches.title')}
      subtitle={t('batches.subtitle')}
      actions={
        isAdmin && (
          <button className={btnPrimary} onClick={() => setAdding((v) => !v)}>
            <Plus size={14} /> <span className="hidden sm:inline">{t('batches.add')}</span>
          </button>
        )
      }
    >
      <ErrorNote message={error} />
      {notice && <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-md px-3 py-2">{notice}</div>}

      {isAdmin && (
        <Card title={t('batches.trackTitle')}>
          <p className="text-xs text-gray-500 mb-2">{t('batches.trackHint')}</p>
          {tracking ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{tracking.name}</span>
              <button className={btnPrimary} onClick={() => setTrack(tracking, true)}>
                {t('batches.trackOn')}
              </button>
              <button className={btnSecondary} onClick={() => setTrack(tracking, false)}>
                {t('batches.trackOff')}
              </button>
            </div>
          ) : (
            <ProductPicker onPick={setTracking} placeholder={t('batches.pickProduct')} />
          )}
        </Card>
      )}

      {adding && (
        <Card title={t('batches.add')}>
          <form onSubmit={addBatch} className="space-y-3">
            {product ? (
              <p className="text-sm">
                <span className="font-medium">{product.name}</span>{' '}
                <button type="button" className="text-xs text-blue-700 underline" onClick={() => setProduct(null)}>
                  {t('batches.change')}
                </button>
              </p>
            ) : (
              <ProductPicker onPick={setProduct} placeholder={t('batches.pickProduct')} />
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              <input required placeholder={t('batches.batchNumber')} value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} className={inputCls} />
              <DatePicker clearable aria-label={t('batches.expiryDate')} placeholder={t('batches.expiryDate')} value={form.expiryDate} onChange={(v) => setForm({ ...form, expiryDate: v })} />
              <input required inputMode="decimal" placeholder={t('batches.quantity')} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={inputCls} />
            </div>
            <p className="text-xs text-gray-500">{t('batches.addHint')}</p>
            <button className={btnPrimary} disabled={!product}>
              {t('common.save')}
            </button>
          </form>
        </Card>
      )}

      <div className="flex gap-1.5">
        {(['expiring', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-sm px-3 py-1.5 rounded-full border ${filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300'}`}
          >
            {t(`batches.filter.${f}`)}
          </button>
        ))}
      </div>

      <Card>
        {rows && rows.length === 0 ? (
          <p className="text-sm text-gray-500">{filter === 'expiring' ? t('batches.noneExpiring') : t('batches.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}>{t('batches.product')}</th>
                  <th className={thCls}>{t('batches.batchNumber')}</th>
                  <th className={thCls}>{t('batches.expiryDate')}</th>
                  <th className={`${thCls} text-right`}>{t('batches.remaining')}</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((b) => (
                  <tr key={b.id} className="border-t border-gray-100">
                    <td className={tdCls}>
                      {b.product.name} {b.product.sku && <span className="text-xs text-gray-500">{b.product.sku}</span>}
                    </td>
                    <td className={tdCls}>{b.batchNumber}</td>
                    <td className={`${tdCls} ${expiryStyle(b.daysToExpiry)}`}>
                      {b.expiryDate ? formatDMY(new Date(b.expiryDate)) : '—'}
                      {b.daysToExpiry !== null &&
                        ` · ${b.daysToExpiry < 0 ? t('batches.expiredAgo', { n: -b.daysToExpiry }) : t('batches.daysLeft', { n: b.daysToExpiry })}`}
                    </td>
                    <td className={`${tdCls} text-right tabular-nums`}>
                      {b.remaining} / {b.received} {b.product.unit ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500 mt-3">{t('batches.fefoNote')}</p>
      </Card>
    </PageFrame>
  );
}
