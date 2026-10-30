'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PackageCheck, ShoppingCart, MessageCircle, XCircle } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatDMY, parseCalendarDate } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { useDialog } from '@/app/components/shared/DialogProvider';
import { Card, ErrorNote, btnPrimary, btnSecondary, btnDanger, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';

type PartLine = {
  productId: string;
  locationId: string;
  locationName: string;
  name: string;
  sku: string | null;
  needed: number;
  heldElsewhere: number;
  available: number;
  short: number;
  onOrder: number;
  toOrder: number;
};

type PartsOrder = {
  id: string;
  poNumber: string | null;
  status: 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'FULLY_RECEIVED' | 'CANCELLED';
  expectedDate: string | null;
  createdAt: string;
  supplier: { id: string; name: string; phone: string | null } | null;
  lines: { productId: string; name: string; sku: string | null; quantity: number; unitCost: number; remaining: number }[];
};

type Parts = { lines: PartLine[]; orders: PartsOrder[] };

const OPEN = ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'];

// wa.me wants the number in international form without '+': 0812… and 812… become 62812….
function waNumber(phone: string | null | undefined) {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

// What the job is short of and the orders placed for it with the workshop's agent. Ordering is a
// WhatsApp message from the staff's own phone; the order is kept on the job (a draft purchase order)
// so "Parts arrived" can put the parts into stock at what was paid and resume the job.
export default function WorkOrderParts({
  workOrderId,
  plate,
  model,
  locked,
  onStatusChange,
}: {
  workOrderId: string;
  plate: string;
  model: string;
  locked: boolean;
  // Ordering or receiving can move the job between in progress and waiting for parts.
  onStatusChange: () => void;
}) {
  const { t } = useLanguage();
  const p = (key: string, vars?: Record<string, string | number>) => t(`workshop.workOrders.parts.${key}`, vars);
  const dialog = useDialog();

  const [parts, setParts] = useState<Parts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ordering, setOrdering] = useState<{ supplierId: string; expectedDate: string; qty: Record<string, string> } | null>(null);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; phone: string | null }[]>([]);
  const [arriving, setArriving] = useState<{ orderId: string; rows: Record<string, { qty: string; cost: string }> } | null>(null);

  const load = useCallback(() => {
    apiFetch(`/work-orders/${workOrderId}/parts`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (res.ok) setParts(body);
        else setError(body?.message ?? p('loadFailed'));
      })
      .catch(() => setError(t('workshop.workOrders.serverError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId, t]);

  useEffect(load, [load]);

  async function call(path: string, payload?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(path, { method: 'POST', body: payload ? JSON.stringify(payload) : undefined });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? t('workshop.workOrders.saveFailed')));
        return false;
      }
      setParts(body);
      onStatusChange();
      return true;
    } catch {
      setError(t('workshop.workOrders.serverError'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startOrder() {
    if (!parts) return;
    setOrdering({
      supplierId: '',
      expectedDate: '',
      qty: Object.fromEntries(parts.lines.filter((l) => l.toOrder > 0).map((l) => [key(l), String(l.toOrder)])),
    });
    if (suppliers.length === 0) {
      apiFetch('/suppliers?isActive=true&pageSize=200')
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => body && setSuppliers(body.data))
        .catch(() => {});
    }
  }

  async function placeOrder() {
    if (!parts || !ordering) return;
    const lines = parts.lines
      .map((l) => ({ productId: l.productId, locationId: l.locationId, quantity: Number(ordering.qty[key(l)] ?? 0) }))
      .filter((l) => l.quantity > 0);
    const ok = await call(`/work-orders/${workOrderId}/parts-orders`, {
      supplierId: ordering.supplierId || undefined,
      expectedDate: ordering.expectedDate || undefined,
      lines,
    });
    if (ok) setOrdering(null);
  }

  function startArrival(order: PartsOrder) {
    setArriving({
      orderId: order.id,
      rows: Object.fromEntries(
        order.lines.map((l) => [l.productId, { qty: String(l.remaining), cost: l.unitCost ? String(l.unitCost) : '' }]),
      ),
    });
  }

  async function receive(order: PartsOrder) {
    if (!arriving) return;
    const ok = await call(`/work-orders/${workOrderId}/parts-orders/${order.id}/arrived`, {
      lines: order.lines.map((l) => ({
        productId: l.productId,
        quantity: Number(arriving.rows[l.productId]?.qty || 0),
        ...(order.status === 'DRAFT' && { unitCost: Number(arriving.rows[l.productId]?.cost || 0) }),
      })),
    });
    if (ok) setArriving(null);
  }

  async function cancelOrder(order: PartsOrder) {
    if (!(await dialog.confirm(p('cancelOrderConfirm'), { danger: true }))) return;
    await call(`/work-orders/${workOrderId}/parts-orders/${order.id}/cancel`);
  }

  function whatsappHref(order: PartsOrder) {
    const lines = order.lines.map((l) => `- ${l.quantity}× ${l.name}${l.sku ? ` (${l.sku})` : ''}`).join('\n');
    const text = order.supplier
      ? p('message', { supplier: order.supplier.name, lines, plate, model })
      : p('messageNoName', { lines, plate, model });
    return `https://wa.me/${waNumber(order.supplier?.phone)}?text=${encodeURIComponent(text)}`;
  }

  if (!parts || parts.lines.length === 0) return error ? <ErrorNote message={error} /> : null;

  const toOrder = parts.lines.some((l) => l.toOrder > 0);
  const orders = parts.orders.filter((o) => o.status !== 'CANCELLED');

  return (
    <Card title={p('title')}>
      <div className="overflow-x-auto -mx-3">
        <table className="w-full">
          <thead>
            <tr>
              <th className={thCls}>{p('part')}</th>
              <th className={`${thCls} text-right`}>{p('needed')}</th>
              <th className={`${thCls} text-right`}>{p('available')}</th>
              <th className={`${thCls} text-right`}>{p('short')}</th>
              <th className={`${thCls} text-right`}>{p('onOrder')}</th>
            </tr>
          </thead>
          <tbody>
            {parts.lines.map((l) => (
              <tr key={key(l)} className="border-t border-gray-100">
                <td className={tdCls}>
                  <p className="font-medium text-gray-900">{l.name}</p>
                  <p className="text-xs text-gray-500">
                    {[l.sku, l.locationName].filter(Boolean).join(' · ')}
                    {l.heldElsewhere > 0 && ` · ${p('heldElsewhere', { qty: l.heldElsewhere })}`}
                  </p>
                </td>
                <td className={`${tdCls} text-right`}>{l.needed}</td>
                <td className={`${tdCls} text-right`}>{l.available}</td>
                <td className={`${tdCls} text-right font-semibold ${l.short > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                  {l.short || '—'}
                </td>
                <td className={`${tdCls} text-right ${l.onOrder > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{l.onOrder || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {parts.lines.every((l) => l.short === 0) && orders.length === 0 && (
        <p className="mt-2 text-sm text-green-700">{p('allThere')}</p>
      )}

      {!locked && toOrder && !ordering && (
        <button type="button" className={`${btnSecondary} mt-3`} disabled={busy} onClick={startOrder}>
          <ShoppingCart size={14} />
          {p('order')}
        </button>
      )}

      {ordering && (
        <div className="mt-3 border border-gray-200 rounded-md p-3 space-y-3">
          <p className="text-sm font-semibold text-gray-900">{p('orderTitle')}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-600 space-y-1">
              <span>{p('supplier')}</span>
              <select
                className={inputCls}
                value={ordering.supplierId}
                onChange={(e) => setOrdering({ ...ordering, supplierId: e.target.value })}
              >
                <option value="">{p('noSupplier')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-600 space-y-1">
              <span>{p('expected')}</span>
              <input
                type="date"
                className={inputCls}
                value={ordering.expectedDate}
                onChange={(e) => setOrdering({ ...ordering, expectedDate: e.target.value })}
              />
            </label>
          </div>
          {parts.lines
            .filter((l) => l.toOrder > 0)
            .map((l) => (
              <div key={key(l)} className="flex items-center gap-3">
                <span className="flex-1 min-w-0 text-sm truncate">{l.name}</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  className={`${inputCls} w-24 text-right`}
                  value={ordering.qty[key(l)] ?? ''}
                  onChange={(e) => setOrdering({ ...ordering, qty: { ...ordering.qty, [key(l)]: e.target.value } })}
                />
              </div>
            ))}
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setOrdering(null)}>
              {p('cancel')}
            </button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={placeOrder}>
              {p('placeOrder')}
            </button>
          </div>
        </div>
      )}

      {orders.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{p('orders')}</p>
          {orders.map((o) => {
            const open = OPEN.includes(o.status);
            return (
              <div key={o.id} className="border border-gray-200 rounded-md p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-gray-900">
                    {o.supplier?.name ?? '—'}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {p('ordered', { date: formatDMY(new Date(o.createdAt)) })}
                      {o.expectedDate && ` · ${p('due', { date: formatDMY(parseCalendarDate(o.expectedDate)) })}`}
                      {o.poNumber && (
                        <>
                          {' · '}
                          <Link className="underline" href={`/purchasing/purchase-orders/${o.id}`}>
                            {o.poNumber}
                          </Link>
                        </>
                      )}
                    </span>
                  </p>
                  <span className={`text-xs px-2 py-0.5 rounded-md border ${open ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-green-50 text-green-700 border-green-300'}`}>
                    {p(`orderStatus.${o.status}`)}
                  </span>
                </div>
                <ul className="mt-1 text-gray-700">
                  {o.lines.map((l) => (
                    <li key={l.productId}>
                      {l.quantity}× {l.name}
                    </li>
                  ))}
                </ul>

                {open && !locked && arriving?.orderId !== o.id && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a className={btnSecondary} href={whatsappHref(o)} target="_blank" rel="noopener noreferrer">
                      <MessageCircle size={14} />
                      {p('sendWhatsApp')}
                    </a>
                    <button type="button" className={btnPrimary} disabled={busy} onClick={() => startArrival(o)}>
                      <PackageCheck size={14} />
                      {p('arrived')}
                    </button>
                    {o.status !== 'PARTIALLY_RECEIVED' && (
                      <button type="button" className={btnDanger} disabled={busy} onClick={() => cancelOrder(o)}>
                        <XCircle size={14} />
                        {p('cancelOrder')}
                      </button>
                    )}
                  </div>
                )}

                {arriving?.orderId === o.id && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-600">{p('arrivedTitle')}</p>
                    {o.lines.map((l) => {
                      const row = arriving.rows[l.productId] ?? { qty: '', cost: '' };
                      const set = (next: Partial<typeof row>) =>
                        setArriving({ ...arriving, rows: { ...arriving.rows, [l.productId]: { ...row, ...next } } });
                      return (
                        <div key={l.productId} className="flex flex-wrap items-end gap-3">
                          <span className="flex-1 min-w-[8rem] text-sm">{l.name}</span>
                          <label className="text-xs text-gray-600 space-y-1">
                            <span>{p('qtyArrived')}</span>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              inputMode="decimal"
                              className={`${inputCls} w-20 text-right`}
                              value={row.qty}
                              onChange={(e) => set({ qty: e.target.value })}
                            />
                          </label>
                          {o.status === 'DRAFT' && (
                            <label className="text-xs text-gray-600 space-y-1">
                              <span>{p('paid')}</span>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                inputMode="decimal"
                                className={`${inputCls} w-32 text-right`}
                                value={row.cost}
                                onChange={(e) => set({ cost: e.target.value })}
                              />
                            </label>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap gap-2 justify-end">
                      <button type="button" className={btnSecondary} disabled={busy} onClick={() => setArriving(null)}>
                        {p('cancel')}
                      </button>
                      <button type="button" className={btnPrimary} disabled={busy} onClick={() => receive(o)}>
                        <PackageCheck size={14} />
                        {p('receive')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ErrorNote message={error} />
    </Card>
  );
}

function key(l: { productId: string; locationId: string }) {
  return `${l.productId}|${l.locationId}`;
}
