'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  Package,
  ListOrdered,
  ScanLine,
  CheckCircle2,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

type SessionItem = {
  id: number;
  quantity: number;
  product: {
    id: string;
    name: string;
    sku: string;
  };
  events: {
    fromLocation: { name: string } | null;
    toLocation: { name: string } | null;
  }[];
};

type Session = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  items: SessionItem[];
};

const statusStyle = (status: string) => {
  switch (status?.toUpperCase()) {
    case 'OPEN':
    case 'IN_PROGRESS':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'COMPLETE':
    case 'DONE':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-600 border-gray-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
};

export default function SessionPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [session, setSession] = useState<Session | null>(null);

  // replace the useEffect load and the complete button

const loadSession = async () => {
  const res = await apiFetch(`http://localhost:3000/sessions/${id}`);
  const data = await res.json();
  if (!res.ok) return;
  setSession(data);
};

useEffect(() => {
  if (!id) return;
  loadSession();
}, [id]);

if (!session) {
  return (
    <main className="min-h-screen bg-white text-black p-8">
      Loading...
    </main>
  );
}

const totalItems = (session.items ?? []).reduce(
  (sum, item) => sum + item.quantity,
  0
);

return (
    <main className="min-h-screen bg-white text-black">

      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/sessions')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Sessions
          </button>

          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{session.type}</h1>
            <span className={`text-xs px-2 py-1 rounded-md border font-medium ${statusStyle(session.status)}`}>
              {session.status}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto space-y-6">

        {/* Summary */}
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="border-2 border-gray-300 rounded-md p-4 flex items-start gap-3">
            <Calendar size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">Created</p>
              <p className="font-medium">{new Date(session.createdAt).toLocaleString()}</p>
            </div>
          </div>

          <div className="border-2 border-gray-300 rounded-md p-4 flex items-start gap-3">
            <Package size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">Products</p>
              <p className="font-bold text-lg">{(session.items ?? []).length}</p>
            </div>
          </div>

          <div className="border-2 border-gray-300 rounded-md p-4 flex items-start gap-3">
            <ListOrdered size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">Total Qty</p>
              <p className="font-bold text-lg">{totalItems}</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        {session.status === 'OPEN' && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => router.push(`/scan?sessionId=${session.id}`)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-semibold"
            >
              <ScanLine size={18} strokeWidth={2} />
              Continue Scanning
            </button>

            <button
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md font-semibold"
              onClick={async () => {
                await apiFetch(`http://localhost:3000/sessions/${session.id}/complete`, { method: 'POST' });
                loadSession();
              }}
            >
              <CheckCircle2 size={18} strokeWidth={2} />
              Complete Session
            </button>
          </div>
        )}

        {/* Items */}
        <div>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Session Items</h2>

          <div className="border-2 border-gray-300 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b-2 border-gray-300">
                <tr>
                  <th className="p-3 text-left font-semibold">Product</th>
                  <th className="p-3 text-left font-semibold">SKU</th>
                  <th className="p-3 text-left font-semibold">Qty</th>
                  <th className="p-3 text-left font-semibold">From</th>
                  <th className="p-3 text-left font-semibold">To</th>
                </tr>
              </thead>

              <tbody>
                {(session.items ?? []).map((item, idx) => {
                  const event = item.events[0];
                  return (
                    <tr
                      key={item.id}
                      className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                    >
                      <td className="p-3 font-medium">{item.product.name}</td>
                      <td className="p-3 text-gray-500">{item.product.sku}</td>
                      <td className="p-3 font-bold">{item.quantity}</td>
                      <td className="p-3 text-gray-500">{event?.fromLocation?.name ?? '—'}</td>
                      <td className="p-3 text-gray-500">{event?.toLocation?.name ?? '—'}</td>
                    </tr>
                  );
                })}

                {(session.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-gray-500">
                      No items in this session
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </main>
  );
}