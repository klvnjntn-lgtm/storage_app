// app/admin/products/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Package, AlertTriangle, CheckCircle2, Archive } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

type Product = {
  id: string;
  sku: string | null;
  oem?: string | null;
  name: string;
  category?: string | null;
  brand?: string | null;
  active: boolean;
};

type Option = { id: string; name: string };

function authHeaders(json = true) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function ProductsPage() {
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [oem, setOem] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [brandInput, setBrandInput] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

  async function loadProducts() {
    const res = await apiFetch('http://localhost:3000/products', { headers: authHeaders(false) });
    const data = await res.json();
    setProducts(Array.isArray(data) ? data : []);
  }

  async function loadCategories() {
    const res = await apiFetch('http://localhost:3000/categories', { headers: authHeaders(false) });
    const data = await res.json();
    setCategories(Array.isArray(data) ? data : []);
  }

  async function loadBrands() {
    const res = await apiFetch('http://localhost:3000/brands', { headers: authHeaders(false) });
    const data = await res.json();
    setBrands(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    loadProducts();
    loadCategories();
    loadBrands();
  }, []);

  async function createProduct() {
    setError('');
    setSuccessMsg('');

    if (!name.trim()) return setError('Product name is required');
    if (!sku.trim()) return setError('SKU is required');
    if (!categoryInput.trim()) return setError('Category is required');

    setLoading(true);

    try {
      const res = await apiFetch('http://localhost:3000/products', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim(),
          oem: oem.trim() || undefined,
          category: categoryInput.trim(),
          brand: brandInput.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to create product');
      }

      setSuccessMsg(`"${name.trim()}" created.`);
      setName('');
      setSku('');
      setOem('');
      setCategoryInput('');
      setBrandInput('');

      await Promise.all([loadProducts(), loadCategories(), loadBrands()]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to create product');
    } finally {
      setLoading(false);
    }
  }

  function requestArchive(id: string) {
    setError('');
    setSuccessMsg('');
    setPendingArchiveId(id);
  }

  function cancelArchive() {
    setPendingArchiveId(null);
  }

  async function confirmArchive() {
    if (!pendingArchiveId) return;
    const id = pendingArchiveId;
    const product = products.find((p) => p.id === id);

    try {
      const res = await apiFetch(`http://localhost:3000/products/${id}`, {
        method: 'DELETE',
        headers: authHeaders(false),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to archive product');
      }
      setSuccessMsg(`"${product?.name ?? 'Product'}" archived.`);
      await loadProducts();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to archive product');
    } finally {
      setPendingArchiveId(null);
    }
  }

  async function restoreProduct(id: string) {
    setError('');
    setSuccessMsg('');
    const product = products.find((p) => p.id === id);

    try {
      const res = await apiFetch(`http://localhost:3000/products/${id}/restore`, {
        method: 'PATCH',
        headers: authHeaders(false),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to restore product');
      }
      setSuccessMsg(`"${product?.name ?? 'Product'}" restored.`);
      await loadProducts();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to restore product');
    }
  }

  const pendingProduct = products.find((p) => p.id === pendingArchiveId);

return (
    <main className="min-h-screen bg-white text-black">

      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Admin
          </button>
          <div className="flex items-center gap-2">
            <Package size={22} strokeWidth={2} className="text-gray-700" />
            <div>
              <h1 className="text-2xl font-bold">Products</h1>
              <p className="text-xs text-gray-500">Create and manage product catalog</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto space-y-6">

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
            {successMsg}
          </div>
        )}

        {pendingArchiveId && (
          <div className="flex items-center justify-between gap-3 bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-md p-3 text-sm">
            <div className="flex items-center gap-2">
              <Archive size={18} strokeWidth={2} className="shrink-0" />
              <span>
                Archive <strong>{pendingProduct?.name}</strong>? It stays in history but drops out of normal use.
              </span>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={cancelArchive}
                className="px-3 py-1.5 rounded-md border-2 border-amber-300 text-amber-900 text-xs font-semibold hover:bg-amber-100"
              >
                Cancel
              </button>
              <button
                onClick={confirmArchive}
                className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
              >
                Confirm Archive
              </button>
            </div>
          </div>
        )}

        {/* Create Product */}
        <div className="border-2 border-gray-300 rounded-md p-4 space-y-3">
          <h2 className="text-sm font-semibold">New Product</h2>

          <div className="grid md:grid-cols-5 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Product name"
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
            />
            <input
              value={oem}
              onChange={(e) => setOem(e.target.value)}
              placeholder="OEM (optional)"
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
            />
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="SKU"
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
            />
            <input
              list="category-options"
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              placeholder="Category — pick or type new"
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
            />
            <datalist id="category-options">
              {categories.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>

            <input
              list="brand-options"
              value={brandInput}
              onChange={(e) => setBrandInput(e.target.value)}
              placeholder="Brand (optional) — pick or type new"
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
            />
            <datalist id="brand-options">
              {brands.map((b) => (
                <option key={b.id} value={b.name} />
              ))}
            </datalist>
          </div>

          <button
            onClick={createProduct}
            disabled={loading}
            className="px-4 py-2 bg-black text-white rounded-md text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create Product'}
          </button>
        </div>

        {/* Product Table */}
        <div className="border-2 border-gray-300 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b-2 border-gray-300 bg-gray-100">
            <h2 className="text-sm font-semibold">Product Catalog</h2>
          </div>

          {products.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">No products found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b-2 border-gray-300">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">SKU</th>
                  <th className="text-left px-4 py-3 font-semibold">Name</th>
                  <th className="text-left px-4 py-3 font-semibold">Category</th>
                  <th className="text-left px-4 py-3 font-semibold">Brand</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-right px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, idx) => (
                  <tr
                    key={product.id}
                    className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                  >
                    <td className="px-4 py-3 text-gray-500">{product.sku ?? '-'}</td>
                    <td className="px-4 py-3">{product.name}</td>
                    <td className="px-4 py-3">{product.category ?? '-'}</td>
                    <td className="px-4 py-3">{product.brand ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-md border font-medium ${
                          product.active
                            ? 'bg-green-100 text-green-800 border-green-300'
                            : 'bg-gray-100 text-gray-600 border-gray-300'
                        }`}
                      >
                        {product.active ? 'Active' : 'Archived'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {product.active ? (
                        <button
                          onClick={() => requestArchive(product.id)}
                          className="px-3 py-1.5 rounded-md border-2 border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50"
                        >
                          Archive
                        </button>
                      ) : (
                        <button
                          onClick={() => restoreProduct(product.id)}
                          className="px-3 py-1.5 rounded-md border-2 border-green-300 text-green-700 text-xs font-semibold hover:bg-green-50"
                        >
                          Restore
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </main>
  );}