'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apifetch';

type StockRow = {
  location: {
    id: string;
    name: string;
  };
  quantity: number;
};

type EventRow = {
  id: number;
  type: string;
  quantity: number;
  createdAt: string;
  userId?: string | null;
  user?: { email: string } | null;

  product: string | null;
  from: string | null;
  to: string | null;
  reason?: string | null;
  sessionId?: string | null;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  category?: { name: string };
  brand?: { name: string };
};

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

const eventColor = (type: string) => {
  switch (type) {
    case 'IMPORT_REPLACE':
    case 'IMPORT_INCREMENT':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'RECEIVE':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'MOVE':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'SHIP':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'PICK':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'PACK':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    case 'RETURNS':
      return 'bg-teal-100 text-teal-800 border-teal-300';
    case 'ADJUSTMENT':
      return 'bg-indigo-100 text-indigo-800 border-indigo-300';
    case 'SALE':
      return 'bg-pink-100 text-pink-800 border-pink-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
};
  const [product, setProduct] = useState<Product | null>(null);
  const [locationId, setLocationId] = useState('');
  const [qtyDelta, setQtyDelta] = useState<number>(0);
  const [reason, setReason] = useState('');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const totalStock = stock.reduce((acc, s) => acc + s.quantity, 0);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      try {
        const [productRes, stockRes, eventsRes] = await Promise.all([
          apiFetch(`/products/${id}`),
          apiFetch(`/stock/${id}`),
          apiFetch(`/products/${id}/events`),
        ]);

        setProduct(await productRes.json());
        setStock(await stockRes.json());
        setEvents(await eventsRes.json());
      } catch (err) {
        console.error(err);
      }
    };

    load();
  }, [id]);

  if (!product) {
    return (
      <main className="p-8 text-black bg-white min-h-screen">
        Loading product...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-black">

      {/* Header */}
      <div className="border-b-2 border-gray-300 p-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <button
              onClick={() => router.push('/inventory/stock')}
              className="text-sm text-gray-600 hover:text-black mb-1"
            >
              ← Back to Stock
            </button>
<h1 className="text-2xl font-bold">{product.name}</h1>
<p className="text-gray-600 mt-1">
  SKU: <span className="font-mono">{product.sku}</span> ·{' '}
  {product.category?.name ?? 'No category'} • {product.brand?.name ?? 'No brand'}
</p>
          </div>

          <div className="px-3 py-2 rounded-md bg-gray-100 border-2 border-gray-300 text-sm font-semibold">
            Total: {totalStock} pcs
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto space-y-8">

        {/* ADJUST STOCK */}
        <section className="border-2 border-gray-300 rounded-md p-4 space-y-3">
          <h2 className="text-lg font-bold">Adjust Stock</h2>

          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Location</label>
              <select
                className="border-2 border-gray-300 rounded-md p-2 w-44"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">Select location</option>
                {stock.map((s, i) => (
                  <option key={i} value={s.location.id}>
                    {s.location.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Qty (+ in / − out)</label>
              <input
                type="number"
                className="border-2 border-gray-300 rounded-md p-2 w-28"
                value={qtyDelta}
                onChange={(e) => setQtyDelta(Number(e.target.value))}
              />
            </div>

            <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-gray-600">Reason</label>
              <input
                type="text"
                placeholder="e.g. Cycle count correction"
                className="border-2 border-gray-300 rounded-md p-2 w-full"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <button
              className="bg-black text-white font-semibold px-6 py-2 rounded-md hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!locationId || !reason.trim() || qtyDelta === 0 || Number.isNaN(qtyDelta)}
              onClick={async () => {
                if (!locationId || !reason.trim() || qtyDelta === 0 || Number.isNaN(qtyDelta)) return;

                const res = await apiFetch('/stock/adjust', {
                  method: 'POST',
                  body: JSON.stringify({
                    productId: product.id,
                    locationId,
                    qtyDelta: Number(qtyDelta),
                    reason: reason.trim(),
                  }),
                });

                const data = await res.json().catch(() => null);

                console.log('STATUS:', res.status);
                console.log('RESPONSE:', data);

                if (!res.ok) {
                  alert(data?.message || 'Failed to adjust stock');
                  return;
                }

                setLocationId('');
                setQtyDelta(0);
                setReason('');

                const eventsRes = await apiFetch(`/products/${product.id}/events`);
                const eventsData = await eventsRes.json();
                setEvents(eventsData);
              }}
            >
              Apply
            </button>
          </div>
        </section>

        {/* STOCK BY LOCATION */}
        <section>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            Stock by Location
            <span className="text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-600 border border-gray-300 font-normal">
              Total: {totalStock} pcs
            </span>
          </h2>

          <div className="border-2 border-gray-300 rounded-md overflow-hidden">
            <table className="w-full text-base">
              <thead className="bg-gray-100 border-b-2 border-gray-300 text-left">
                <tr>
                  <th className="p-3 font-semibold">Location</th>
                  <th className="p-3 font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s, idx) => (
                  <tr
                    key={s.location.id}
                    className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                  >
                    <td className="p-3">{s.location.name}</td>
                    <td className="p-3 font-bold">{s.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* EVENT HISTORY */}
        <section>
          <h2 className="text-lg font-bold mb-3">Event History</h2>

          <div className="border-2 border-gray-300 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b-2 border-gray-300 text-left">
                <tr>
                  <th className="p-3 font-semibold">Type</th>
                  <th className="p-3 font-semibold">Qty</th>
                  <th className="p-3 font-semibold">Reason</th>
                  <th className="p-3 font-semibold">User</th>
                  <th className="p-3 font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, idx) => (
                  <tr
                    key={e.id}
                    className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded-md text-xs font-semibold border ${eventColor(e.type)}`}>
                          {e.type}
                        </span>
                        {e.sessionId && (
                          <button
                            onClick={() => router.push(`/sessions/${e.sessionId}`)}
                            className="text-[10px] px-2 py-1 rounded-md border-2 border-gray-300 hover:bg-gray-100 font-semibold"
                          >
                            VIEW SESSION
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-semibold">{e.quantity}</td>
                    <td className="p-3 text-gray-700">{e.reason ?? '-'}</td>
                    <td className="p-3 text-gray-700">{e.user?.email ?? '—'}</td>
                    <td className="p-3 text-gray-500 text-xs">{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </div>

    </main>
  );
}