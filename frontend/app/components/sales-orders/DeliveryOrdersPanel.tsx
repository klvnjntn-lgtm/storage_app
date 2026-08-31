// app/components/sales-orders/DeliveryOrdersPanel.tsx
'use client';

import { useEffect, useState } from 'react';
import { Truck, Package, RotateCcw, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

type DeliveryOrderStatus = 'PACKED' | 'SHIPPED' | 'CANCELLED' | 'PARTIALLY_RETURNED' | 'RETURNED';

type DeliveryOrderItem = {
  id: string;
  productName: string;
  quantity: number;
  returnedQuantity: number;
  unit: string | null;
};

type DeliveryOrder = {
  id: string;
  doNumber: string | null;
  status: DeliveryOrderStatus;
  createdAt: string;
  shippedAt: string | null;
  items: DeliveryOrderItem[];
};

type DeliverableSourceItem = {
  id: string; // salesOrderItemId
  productId: string | null;
  description: string | null;
  product: { name: string; sku: string | null } | null;
  quantity: number;
  deliveredQuantity: number;
  locationId: string | null;
};

function statusStyle(status: DeliveryOrderStatus) {
  switch (status) {
    case 'PACKED':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    case 'SHIPPED':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'PARTIALLY_RETURNED':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'RETURNED':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
}

// ASSUMPTION: GET /delivery-orders?salesOrderId=... returns
// { data: DeliveryOrder[], total, page, pageSize }, matching
// DeliveryOrderService.list()'s return shape. quantity/returnedQuantity
// are read via Number(...) defensively in case they arrive as Decimal
// strings — confirm against your actual serializer.
//
// ASSUMPTION: POST /delivery-orders and its DTO shape are inferred from
// DeliveryOrderService.create()'s destructuring, same as before — confirm
// field names against CreateDeliveryOrderDto directly.
export function DeliveryOrdersPanel({
  salesOrderId,
  locationId,
  items,
  onChanged,
}: {
  salesOrderId: string;
  locationId: string;
  items: DeliverableSourceItem[];
  onChanged: () => void;
}) {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ---- existing delivery orders: ship / return state ----
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnQty, setReturnQty] = useState<Record<string, Record<string, number>>>({});

  // ---- create-new-delivery form state ----
  const [createQty, setCreateQty] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);

  const deliverable = items.filter((i) => i.quantity - i.deliveredQuantity > 0);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch(`/delivery-orders?salesOrderId=${salesOrderId}`);
      if (res.ok) {
        const body = await res.json();
        setOrders(body.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesOrderId]);

  // ---- ship / return actions on existing delivery orders ----

  async function handleShip(id: string) {
    setActionLoading(id);
    setError('');
    try {
      const res = await apiFetch(`/delivery-orders/${id}/ship`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      await load();
      onChanged();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setActionLoading(null);
    }
  }

  function setReturnQtyFor(doId: string, itemId: string, value: number, max: number) {
    const clamped = Math.max(0, Math.min(value, max));
    setReturnQty((prev) => ({ ...prev, [doId]: { ...prev[doId], [itemId]: clamped } }));
  }

  async function handleRecordReturn(doId: string) {
    const qtyMap = returnQty[doId] ?? {};
    const returnItems = Object.entries(qtyMap)
      .filter(([, v]) => v > 0)
      .map(([deliveryOrderItemId, quantity]) => ({ deliveryOrderItemId, quantity }));

    if (returnItems.length === 0) {
      setError('Enter a quantity for at least one item.');
      return;
    }

    setActionLoading(doId);
    setError('');
    try {
      const res = await apiFetch(`/delivery-orders/${doId}/return`, {
        method: 'POST',
        body: JSON.stringify({ items: returnItems }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setReturnQty((prev) => ({ ...prev, [doId]: {} }));
      setReturningId(null);
      await load();
      onChanged();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setActionLoading(null);
    }
  }

  // ---- create new delivery order ----

  function remaining(item: DeliverableSourceItem) {
    return item.quantity - item.deliveredQuantity;
  }

  function setCreateQtyFor(itemId: string, value: number, max: number) {
    const clamped = Math.max(0, Math.min(value, max));
    setCreateQty((prev) => ({ ...prev, [itemId]: clamped }));
  }

  const hasAnyCreateQty = Object.values(createQty).some((v) => v > 0);

  async function handleCreate() {
    setError('');
    const payloadItems = Object.entries(createQty)
      .filter(([, v]) => v > 0)
      .map(([salesOrderItemId, quantity]) => ({ salesOrderItemId, quantity }));

    if (payloadItems.length === 0) {
      setError('Enter a quantity for at least one item.');
      return;
    }

    setCreating(true);
    try {
      const res = await apiFetch('/delivery-orders', {
        method: 'POST',
        body: JSON.stringify({ salesOrderId, locationId, items: payloadItems }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setCreateQty({});
      await load();
      onChanged();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  }

  if (loading) return null;
  if (orders.length === 0 && deliverable.length === 0) return null;

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-2 text-xs">
          <AlertCircle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* ---- existing delivery orders ---- */}
      {orders.map((deliveryOrder) => {
        const isReturning = returningId === deliveryOrder.id;
        const canReturn = deliveryOrder.status === 'SHIPPED' || deliveryOrder.status === 'PARTIALLY_RETURNED';

        return (
          <div key={deliveryOrder.id} className="border-2 border-gray-300 rounded-md p-3">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Truck size={14} strokeWidth={2} className="text-gray-500" />
                <span className="text-sm font-semibold">{deliveryOrder.doNumber ?? deliveryOrder.id}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-md border font-medium ${statusStyle(deliveryOrder.status)}`}>
                  {deliveryOrder.status.replace('_', ' ')}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {deliveryOrder.status === 'PACKED' && (
                  <button
                    onClick={() => handleShip(deliveryOrder.id)}
                    disabled={actionLoading === deliveryOrder.id}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-black text-white font-semibold hover:bg-gray-800 disabled:opacity-50"
                  >
                    <Package size={12} strokeWidth={2} />
                    {actionLoading === deliveryOrder.id ? 'Shipping...' : 'Ship'}
                  </button>
                )}
                {canReturn && !isReturning && (
                  <button
                    onClick={() => setReturningId(deliveryOrder.id)}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border-2 border-gray-300 font-semibold hover:bg-gray-50"
                  >
                    <RotateCcw size={12} strokeWidth={2} />
                    Record return
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col divide-y divide-gray-200">
              {deliveryOrder.items.map((item) => {
                const shipped = Number(item.quantity);
                const returned = Number(item.returnedQuantity);
                const remainingQty = shipped - returned;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{item.productName}</p>
                      <p className="text-[11px] text-gray-400">
                        {shipped} {item.unit ?? ''}
                        {returned > 0 && ` · ${returned} returned`}
                      </p>
                    </div>
                    {isReturning && canReturn && (
                      <input
                        type="number"
                        min={0}
                        max={remainingQty}
                        value={returnQty[deliveryOrder.id]?.[item.id] ?? ''}
                        onChange={(e) =>
                          setReturnQtyFor(deliveryOrder.id, item.id, Number(e.target.value) || 0, remainingQty)
                        }
                        placeholder="0"
                        className="w-16 border-2 border-gray-300 rounded-md p-1 text-xs text-right outline-none focus:border-black"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {isReturning && (
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => handleRecordReturn(deliveryOrder.id)}
                  disabled={actionLoading === deliveryOrder.id}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-black text-white font-semibold hover:bg-gray-800 disabled:opacity-50"
                >
                  {actionLoading === deliveryOrder.id ? 'Recording...' : 'Confirm return'}
                </button>
                <button
                  onClick={() => setReturningId(null)}
                  className="text-xs px-2.5 py-1.5 rounded-md text-gray-500 hover:text-black"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* ---- create a new delivery order for remaining quantity ---- */}
      {deliverable.length > 0 && (
        <div className="border-2 border-gray-300 rounded-md p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-2">
            <Truck size={12} strokeWidth={2} />
            Create delivery order
          </p>

          <div className="flex flex-col divide-y divide-gray-200">
            {deliverable.map((item) => {
              const max = remaining(item);
              return (
                <div key={item.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{item.product?.name ?? item.description ?? '—'}</p>
                    <p className="text-xs text-gray-400">{max} remaining of {item.quantity}</p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={max}
                    value={createQty[item.id] ?? ''}
                    onChange={(e) => setCreateQtyFor(item.id, Number(e.target.value) || 0, max)}
                    placeholder="0"
                    className="w-20 border-2 border-gray-300 rounded-md p-1.5 text-sm text-right outline-none focus:border-black"
                  />
                </div>
              );
            })}
          </div>

          <button
            onClick={handleCreate}
            disabled={creating || !hasAnyCreateQty}
            className="w-full mt-3 flex items-center justify-center gap-2 bg-black text-white rounded-md p-2 text-sm font-semibold disabled:bg-gray-300"
          >
            {creating ? 'Creating...' : 'Create Delivery Order'}
          </button>
        </div>
      )}
    </div>
  );
}