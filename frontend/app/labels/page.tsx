'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Barcode from 'react-barcode';
import { ArrowLeft, Tag, Printer } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
type Item = {
  sku: string;
  name: string;
};

export default function LabelsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('http://localhost:3000/products')
      .then((res) => res.json())
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

return (
    <main className="min-h-screen bg-white text-black">

      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Scanner Hub
          </button>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Tag size={22} strokeWidth={2} className="text-gray-700" />
              <div>
                <h1 className="text-2xl font-bold">Product Labels</h1>
                <p className="text-xs text-gray-500">
                  {items.length} label{items.length === 1 ? '' : 's'} ready to print
                </p>
              </div>
            </div>

            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-md font-semibold hover:bg-gray-800"
            >
              <Printer size={18} strokeWidth={2} />
              Print All
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto">
        {loading && (
          <p className="no-print text-gray-500 text-sm">Loading labels...</p>
        )}

        {!loading && items.length === 0 && (
          <p className="no-print text-gray-500 text-sm">No products found.</p>
        )}

        <div className="label-grid grid grid-cols-2 sm:grid-cols-3 gap-4">
          {items.map((item) => (
            <div
              key={item.sku}
              className="label-card border-2 border-gray-300 rounded-md p-3 text-center flex flex-col items-center justify-center"
            >
              <p className="font-bold text-sm truncate w-full">{item.sku}</p>
              <p className="text-xs text-gray-600 mb-2 truncate w-full">{item.name}</p>
              <Barcode value={item.sku} height={40} fontSize={12} />
            </div>
          ))}
        </div>
      </div>

      {/* Print-only layout */}
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }

          @page {
            size: 2in 1in;
            margin: 0;
          }

          .label-grid {
            display: block !important;
          }

          .label-card {
            border: none !important;
            border-radius: 0 !important;
            width: 2in;
            height: 1in;
            page-break-after: always;
            break-after: page;
            display: flex !important;
          }
        }
      `}</style>
    </main>
  );}