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

      {/* Header — hidden on print */}
      <div className="no-print px-6 py-5 border-b-2 border-gray-300">
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
              <Barcode value={item.sku} height={30} width={1.3} fontSize={10} margin={0} />
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

  main {
    margin: 0;
    padding: 0;
  }

  @page {
    size: A4 portrait;
    margin: 0.4in;
  }

  .label-grid {
    display: grid !important;
    grid-template-columns: repeat(auto-fill, 2in);
    grid-auto-rows: 1in;
    gap: 0.15in;
    justify-content: start;
    align-content: start;
  }

  .label-card {
    box-sizing: border-box;
    border: 1px dashed #ccc !important;
    border-radius: 0 !important;
    width: 2in;
    height: 1in;
    padding: 0.05in 0.1in !important;
    display: flex !important;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .label-card p {
    margin: 0 !important;
    line-height: 1.1;
  }

  .label-card svg {
    max-width: 100%;
    height: auto !important;
  }
}
      `}</style>
    </main>
  );
}