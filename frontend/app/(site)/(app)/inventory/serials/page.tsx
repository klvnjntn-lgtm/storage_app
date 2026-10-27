'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Hash, Search } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatDMY } from '@/lib/dates';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useWarehouseOps } from '@/lib/hooks/useWarehouseOps';
import { defaultLocation } from '@/lib/locations';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, btnPrimary, btnSecondary, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';
import { ProductPicker, useLocations, type PickedProduct } from '@/app/components/shared/ProductPicker';

type Status = 'IN_STOCK' | 'IN_TRANSIT' | 'SOLD' | 'RETURNED_TO_SUPPLIER' | 'WRITTEN_OFF';
const STATUSES: Status[] = ['IN_STOCK', 'IN_TRANSIT', 'SOLD', 'RETURNED_TO_SUPPLIER', 'WRITTEN_OFF'];

type Row = {
  id: string;
  serialNumber: string;
  status: Status;
  updatedAt: string;
  product: { id: string; name: string; sku: string | null };
  location: { name: string } | null;
};

type History = Row & {
  note: string | null;
  soldAt: string | null;
  receipt: { id: string; receiptNumber: string | null; createdAt: string; purchaseOrder: { id: string; poNumber: string | null; supplier: { name: string } | null } } | null;
  invoice: { id: string; invoiceNumber: string | null; issuedAt: string | null; customerName: string | null; customerPhone: string | null } | null;
  purchaseReturn: { id: string; returnNumber: string | null; createdAt: string } | null;
  transfer: { id: string; transferNumber: string | null; status: string } | null;
};

const STATUS_STYLE: Record<Status, string> = {
  IN_STOCK: 'bg-green-100 text-green-800',
  IN_TRANSIT: 'bg-blue-100 text-blue-800',
  SOLD: 'bg-gray-100 text-gray-700',
  RETURNED_TO_SUPPLIER: 'bg-amber-100 text-amber-800',
  WRITTEN_OFF: 'bg-red-100 text-red-700',
};

// Look a unit up by serial number — where it is, who bought it and when —
// for warranty and service desks; plus registering units already on the
// shelf and admin corrections (customer returns, count differences).
export default function SerialsPage() {
  const { t } = useLanguage();
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const locations = useLocations();
  // Only warehouse orgs see or choose locations; the rest use CENTRE.
  const warehouseOps = useWarehouseOps();
  const hiddenLocationId = defaultLocation(locations)?.id ?? '';

  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fix, setFix] = useState<{ status: Status; locationId: string; note: string }>({ status: 'IN_STOCK', locationId: '', note: '' });
  const [reg, setReg] = useState<{ product: PickedProduct | null; locationId: string; serials: string }>({ product: null, locationId: '', serials: '' });
  const [tracking, setTracking] = useState<PickedProduct | null>(null);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setError(null);
    const res = await apiFetch(`/serials?q=${encodeURIComponent(q.trim())}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.message ?? t('serials.loadFailed'));
    else setRows(body);
  }

  async function open(id: string) {
    setNotice(null);
    const res = await apiFetch(`/serials/${id}`);
    if (res.ok) {
      const h: History = await res.json();
      setSelected(h);
      setFix({ status: h.status, locationId: '', note: '' });
    }
  }

  async function saveFix(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const res = await apiFetch(`/serials/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: fix.status,
        locationId: (warehouseOps ? fix.locationId : fix.status === 'IN_STOCK' ? hiddenLocationId : '') || undefined,
        note: fix.note.trim(),
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('serials.saveFailed'));
      return;
    }
    await open(selected.id);
    search();
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!reg.product) return;
    const serialNumbers = reg.serials.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const res = await apiFetch('/serials', {
      method: 'POST',
      body: JSON.stringify({
        productId: reg.product.id,
        locationId: warehouseOps ? reg.locationId : hiddenLocationId,
        serialNumbers,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('serials.saveFailed'));
      return;
    }
    setNotice(t('serials.registered', { n: body.created }));
    setReg({ product: null, locationId: reg.locationId, serials: '' });
  }

  async function setTrack(p: PickedProduct, on: boolean) {
    const res = await apiFetch(`/serials/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ trackSerials: on }) });
    setNotice(res.ok ? t(on ? 'serials.trackingOn' : 'serials.trackingOff', { name: p.name }) : t('serials.saveFailed'));
    setTracking(null);
  }

  return (
    <PageFrame icon={Hash} title={t('serials.title')} subtitle={t('serials.subtitle')}>
      <ErrorNote message={error} />
      {notice && <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-md px-3 py-2">{notice}</div>}

      <Card>
        <form onSubmit={search} className="flex gap-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('serials.searchPlaceholder')} className={`${inputCls} font-mono`} />
          <button className={btnPrimary}>
            <Search size={14} /> {t('common.search')}
          </button>
        </form>
        {rows && rows.length === 0 && <p className="mt-3 text-sm text-gray-500">{t('serials.notFound')}</p>}
        {rows && rows.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}>{t('serials.serial')}</th>
                  <th className={thCls}>{t('serials.product')}</th>
                  <th className={thCls}>{t('common.status')}</th>
                  {warehouseOps && <th className={thCls}>{t('serials.location')}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 cursor-pointer hover:bg-blue-50/50" onClick={() => open(r.id)}>
                    <td className={`${tdCls} font-mono`}>{r.serialNumber}</td>
                    <td className={tdCls}>{r.product.name}</td>
                    <td className={tdCls}>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>{t(`serials.status.${r.status}`)}</span>
                    </td>
                    {warehouseOps && <td className={tdCls}>{r.location?.name ?? '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <Card title={`${selected.product.name} · ${selected.serialNumber}`}>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[selected.status]}`}>{t(`serials.status.${selected.status}`)}</span>
          {warehouseOps && selected.location && <span className="ml-2 text-sm text-gray-600">{selected.location.name}</span>}
          <ol className="mt-3 space-y-2 text-sm">
            {selected.receipt && (
              <li>
                {t('serials.receivedOn', { date: formatDMY(new Date(selected.receipt.createdAt)) })}{' '}
                <Link className="text-blue-700 underline" href={`/purchasing/purchase-orders/${selected.receipt.purchaseOrder.id}`}>
                  {selected.receipt.purchaseOrder.poNumber ?? selected.receipt.receiptNumber}
                </Link>
                {selected.receipt.purchaseOrder.supplier && ` · ${selected.receipt.purchaseOrder.supplier.name}`}
              </li>
            )}
            {selected.invoice && (
              <li>
                {t('serials.soldOn', { date: selected.soldAt ? formatDMY(new Date(selected.soldAt)) : '—' })}{' '}
                <Link className="text-blue-700 underline" href={`/sales/invoices/${selected.invoice.id}`}>
                  {selected.invoice.invoiceNumber}
                </Link>
                {selected.invoice.customerName && ` · ${selected.invoice.customerName}`}
                {selected.invoice.customerPhone && ` · ${selected.invoice.customerPhone}`}
              </li>
            )}
            {selected.purchaseReturn && (
              <li>{t('serials.returnedOn', { date: formatDMY(new Date(selected.purchaseReturn.createdAt)), number: selected.purchaseReturn.returnNumber ?? '' })}</li>
            )}
            {selected.transfer && <li>{t('serials.onTransfer', { number: selected.transfer.transferNumber ?? '' })}</li>}
            {selected.note && <li className="text-gray-500 italic">{selected.note}</li>}
          </ol>

          {isAdmin && (
            <form onSubmit={saveFix} className="mt-4 border-t border-gray-100 pt-3 grid sm:grid-cols-3 gap-2">
              <p className="sm:col-span-3 text-xs text-gray-500">{t('serials.correctHint')}</p>
              <select value={fix.status} onChange={(e) => setFix({ ...fix, status: e.target.value as Status })} className={inputCls}>
                {STATUSES.filter((s) => s !== 'IN_TRANSIT').map((s) => (
                  <option key={s} value={s}>
                    {t(`serials.status.${s}`)}
                  </option>
                ))}
              </select>
              {warehouseOps && fix.status === 'IN_STOCK' && (
                <select required value={fix.locationId} onChange={(e) => setFix({ ...fix, locationId: e.target.value })} className={inputCls}>
                  <option value="">{t('serials.location')}</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              <input required maxLength={500} placeholder={t('serials.reason')} value={fix.note} onChange={(e) => setFix({ ...fix, note: e.target.value })} className={inputCls} />
              <div className="sm:col-span-3">
                <button className={btnSecondary}>{t('serials.saveCorrection')}</button>
              </div>
            </form>
          )}
        </Card>
      )}

      {isAdmin && (
        <>
          <Card title={t('serials.trackTitle')}>
            <p className="text-xs text-gray-500 mb-2">{t('serials.trackHint')}</p>
            {tracking ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{tracking.name}</span>
                <button className={btnPrimary} onClick={() => setTrack(tracking, true)}>
                  {t('serials.trackOn')}
                </button>
                <button className={btnSecondary} onClick={() => setTrack(tracking, false)}>
                  {t('serials.trackOff')}
                </button>
              </div>
            ) : (
              <ProductPicker onPick={setTracking} placeholder={t('serials.pickProduct')} />
            )}
          </Card>

          <Card title={t('serials.registerTitle')}>
            <form onSubmit={register} className="space-y-2">
              <p className="text-xs text-gray-500">{t('serials.registerHint')}</p>
              {reg.product ? (
                <p className="text-sm font-medium">
                  {reg.product.name}{' '}
                  <button type="button" className="text-xs text-blue-700 underline" onClick={() => setReg({ ...reg, product: null })}>
                    {t('batches.change')}
                  </button>
                </p>
              ) : (
                <ProductPicker onPick={(p) => setReg({ ...reg, product: p })} placeholder={t('serials.pickProduct')} />
              )}
              {warehouseOps && (
                <select required value={reg.locationId} onChange={(e) => setReg({ ...reg, locationId: e.target.value })} className={inputCls}>
                  <option value="">{t('serials.location')}</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              <textarea
                required
                rows={4}
                value={reg.serials}
                onChange={(e) => setReg({ ...reg, serials: e.target.value })}
                placeholder={t('serials.onePerLine')}
                className={`${inputCls} font-mono`}
              />
              <button className={btnPrimary} disabled={!reg.product}>
                {t('serials.register')}
              </button>
            </form>
          </Card>
        </>
      )}
    </PageFrame>
  );
}
