// app/(app)/purchasing/suppliers/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2, Search, Plus, Pencil, Trash2, Power, PowerOff } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { Supplier } from '@/app/components/suppliers/types';

const SEARCH_DEBOUNCE_MS = 300;

type StatusFilter = 'active' | 'inactive' | 'all';

export default function SuppliersListPage() {
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  async function load() {
    setLoading(true);
    setError('');
    const thisRequest = ++requestIdRef.current;
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'all') params.set('isActive', statusFilter === 'active' ? 'true' : 'false');

      const res = await apiFetch(`/suppliers?${params.toString()}`);
      if (thisRequest !== requestIdRef.current) return; // stale response, a newer request is in flight
      if (!res.ok) {
        setError(`Request failed (${res.status})`);
        return;
      }
      const body = await res.json();
      setSuppliers(body.data);
      setTotal(body.total);
    } catch {
      if (thisRequest === requestIdRef.current) setError('Could not reach the server.');
    } finally {
      if (thisRequest === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(load, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, page]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

async function toggleActive(supplier: Supplier) {
  setActionId(supplier.id);
  setError('');
  try {
    // Deactivating has its own endpoint; there's no matching
    // /reactivate route, so turning a supplier back on goes through
    // the general update endpoint instead.
    const res = supplier.isActive
      ? await apiFetch(`/suppliers/${supplier.id}/deactivate`, { method: 'PATCH' })
      : await apiFetch(`/suppliers/${supplier.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: true }),
        });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.message ?? `Request failed (${res.status})`);
      return;
    }
    load();
  } catch {
    setError('Could not reach the server.');
  } finally {
    setActionId(null);
  }
}
  async function handleDelete(supplier: Supplier) {
    if (!confirm(`Delete "${supplier.name}"? This cannot be undone.`)) return;
    setActionId(supplier.id);
    setError('');
    try {
      const res = await apiFetch(`/suppliers/${supplier.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // Backend refuses to delete a supplier with PO history and
        // tells you to deactivate instead — surface that message as-is.
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setActionId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/purchasing')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Building2 size={20} strokeWidth={2} className="text-gray-700 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold truncate">Suppliers</h1>
                <p className="text-xs text-gray-500 truncate">Manage suppliers for purchasing</p>
              </div>
            </div>

            <button
              onClick={() => router.push('/purchasing/suppliers/new')}
              className="flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 shrink-0"
            >
              <Plus size={16} strokeWidth={2} />
              New Supplier
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, or email..."
              className="w-full border-2 border-gray-300 focus:border-black rounded-md pl-9 pr-3 py-2 text-sm outline-none"
            />
          </div>

          <div className="flex items-center bg-gray-100 rounded-md p-1 text-sm font-medium">
            {(['active', 'inactive', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md capitalize transition-colors ${
                  statusFilter === s ? 'bg-white shadow-sm text-black' : 'text-gray-500 hover:text-black'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500 py-8 text-center">Loading...</p>
        ) : suppliers.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">No suppliers found.</p>
        ) : (
          <div className="border-2 border-gray-200 rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b-2 border-gray-200">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2.5">Name</th>
                    <th className="text-left font-semibold px-4 py-2.5 hidden sm:table-cell">Contact</th>
                    <th className="text-left font-semibold px-4 py-2.5 hidden md:table-cell">Phone</th>
                    <th className="text-left font-semibold px-4 py-2.5 hidden md:table-cell">Email</th>
                    <th className="text-left font-semibold px-4 py-2.5">Status</th>
                    <th className="text-right font-semibold px-4 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2.5 font-medium">{s.name}</td>
                      <td className="px-4 py-2.5 text-gray-600 hidden sm:table-cell">{s.contactName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600 hidden md:table-cell">{s.phone ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600 hidden md:table-cell">{s.email ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded-full ${
                            s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {s.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            title="Edit"
                            onClick={() => router.push(`/purchasing/suppliers/${s.id}/edit`)}
                            className="p-1.5 rounded-md text-gray-600 hover:text-black hover:bg-gray-100"
                          >
                            <Pencil size={15} strokeWidth={2} />
                          </button>
                          <button
                            title={s.isActive ? 'Deactivate' : 'Reactivate'}
                            disabled={actionId === s.id}
                            onClick={() => toggleActive(s)}
                            className="p-1.5 rounded-md text-gray-600 hover:text-black hover:bg-gray-100 disabled:opacity-50"
                          >
                            {s.isActive ? (
                              <PowerOff size={15} strokeWidth={2} />
                            ) : (
                              <Power size={15} strokeWidth={2} />
                            )}
                          </button>
                          <button
                            title="Delete"
                            disabled={actionId === s.id}
                            onClick={() => handleDelete(s)}
                            className="p-1.5 rounded-md text-red-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 size={15} strokeWidth={2} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && total > 0 && (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-md border-2 border-gray-300 font-medium disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-md border-2 border-gray-300 font-medium disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}