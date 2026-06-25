'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LayoutDashboard } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
type ProductSummary = {
  productId: string;
  name: string;
  totalStock: number;
  locations: {
    location: string;
    qty: number;
  }[];
};

export default function DashboardPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const router = useRouter();

  useEffect(() => {
    apiFetch('http://localhost:3000/warehouse/summary')
      .then((res) => res.json())
      .then((data) => {
        console.log('SUMMARY:', data);
        setProducts(data);
      })
      .catch(console.error);
  }, []);

return (
  <main className="min-h-screen bg-white text-black">
    {/* Header */}
    <div className="px-6 py-5 border-b-2 border-gray-300">
      <div className="max-w-5xl mx-auto">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
        >
          <ArrowLeft size={16} strokeWidth={2} />
          Back to Scanner Hub
        </button>
        <div className="flex items-center gap-2">
          <LayoutDashboard size={22} strokeWidth={2} className="text-gray-700" />
          <div>
            <h1 className="text-2xl font-bold">Warehouse Dashboard</h1>
            <p className="text-xs text-gray-500">Current stock across all locations</p>
          </div>
        </div>
      </div>
    </div>

    {/* Content */}
    <div className="p-6 max-w-5xl mx-auto">
      <div className="border-2 border-gray-300 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 border-b-2 border-gray-300">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Product</th>
              <th className="text-left px-4 py-3 font-semibold">Total Stock</th>
              <th className="text-left px-4 py-3 font-semibold">Locations</th>
            </tr>
          </thead>

          <tbody>
            {products.map((product, idx) => (
              <tr
                key={product.productId}
                className={`
                  border-t border-gray-300
                  cursor-pointer
                  hover:bg-blue-50
                  ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}
                `}
                onClick={() => router.push(`/products/${product.productId}`)}
              >
                <td className="px-4 py-3 font-medium">{product.name}</td>
                <td className="px-4 py-3 font-bold">{product.totalStock}</td>
                <td className="px-4 py-3 text-xs text-gray-700">
                  {product.locations.length === 0 ? (
                    <span className="text-gray-500">No stock</span>
                  ) : (
                    product.locations.map((location, index) => (
                      <div key={index}>
                        {location.location}: {location.qty}
                      </div>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {products.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            No products found
          </div>
        )}
      </div>
    </div>
  </main>
);
}