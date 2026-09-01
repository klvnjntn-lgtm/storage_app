// app/(app)/customers/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Users,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Check,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { Customer } from '@/app/components/invoices/types';
import Pagination from '@/app/components/Pagination';

type EditState = {
  id: string | null; // null = creating new
  name: string;
  companyName: string;
  phone: string;
  address: string;
};

const EMPTY_EDIT: EditState = { id: null, name: '', companyName: '', phone: '', address: '' };

export default function CustomersPage() {
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  async function load(q?: string) {
    setLoading(true);
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await apiFetch(`/customers${params}`);
      if (res.ok) setCustomers(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => load(query.trim() || undefined), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Reset to page 1 whenever the result set changes underneath the current page
  useEffect(() => {
    setPage(1);
  }, [query]);

  const totalItems = customers.length;
  const pagedCustomers = customers.slice((page - 1) * pageSize, page * pageSize);

  function openCreate() {
    setError('');
    setEditing({ ...EMPTY_EDIT });
  }

  function openEdit(c: Customer) {
    setError('');
    setEditing({
      id: c.id,
      name: c.name,
      companyName: c.companyName ?? '',
      phone: c.phone ?? '',
      address: c.address ?? '',
    });
  }

  async function save() {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = JSON.stringify({
        name: editing.name.trim(),
        companyName: editing.companyName.trim() || undefined,
        phone: editing.phone.trim() || undefined,
        address: editing.address.trim() || undefined,
      });

      const res = editing.id
        ? await apiFetch(`/customers/${editing.id}`, { method: 'PATCH', body })
        : await apiFetch('/customers', { method: 'POST', body });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || `Failed to save (${res.status})`);
      }

      setEditing(null);
      load(query.trim() || undefined);
    } catch (e: any) {
      setError(e.message || 'Could not save customer');
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Customer) {
    if (!confirm(`Delete ${c.name}? This can't be undone.`)) return;
    const res = await apiFetch(`/customers/${c.id}`, { method: 'DELETE' });
    if (res.ok) {
      setCustomers((prev) => prev.filter((x) => x.id !== c.id));
    } else {
      const err = await res.json().catch(() => null);
      alert(err?.message || `Failed to delete (${res.status})`);
    }
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Hub
          </button>

          <div className="flex justify-between items-center flex-wrap gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Users size={22} strokeWidth={2} className="text-gray-700 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold truncate">Customers</h1>
                <p className="text-xs text-gray-500 truncate">Customer records used on A5 invoices</p>
              </div>
            </div>

            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 shrink-0"
            >
              <Plus size={16} strokeWidth={2} />
              <span className="hidden xs:inline">New Customer</span>
              <span className="xs:hidden">New</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="relative mb-4 sm:max-w-sm">
          <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or phone..."
            className="w-full border-2 border-gray-300 rounded-md pl-9 pr-3 py-2.5 sm:py-2 text-sm outline-none focus:border-black"
          />
        </div>

        {/* Mobile: stacked cards. A 4-column table just gets crushed and
            clips the address/name text on narrow screens, so below sm we
            drop the table entirely and show one card per customer instead. */}
        <div className="sm:hidden flex flex-col gap-2">
          {pagedCustomers.map((c) => (
            <div
              key={c.id}
              onClick={() => router.push(`/customers/${c.id}`)}
              className="border-2 border-gray-300 rounded-md p-3 cursor-pointer active:bg-gray-100"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{c.name}</p>
                  {c.companyName && (
                    <p className="text-xs text-gray-500 truncate">{c.companyName}</p>
                  )}
                </div>
                <div
                  className="flex items-center gap-1.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => openEdit(c)}
                    className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-md hover:bg-gray-100"
                  >
                    <Pencil size={14} strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => remove(c)}
                    className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-md hover:bg-red-50 hover:border-red-300 text-red-600"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-col gap-0.5 text-xs text-gray-600">
                <p className="truncate">{c.phone ?? '—'}</p>
                <p className="truncate">{c.address ?? '—'}</p>
              </div>
            </div>
          ))}

          {!loading && customers.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500 border-2 border-gray-300 rounded-md">
              No customers found
            </div>
          )}
          {loading && (
            <div className="p-8 text-center text-sm text-gray-500 border-2 border-gray-300 rounded-md">
              Loading...
            </div>
          )}
        </div>

        {/* Tablet/desktop: original table */}
        <div className="hidden sm:block border-2 border-gray-300 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b-2 border-gray-300">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Name</th>
                <th className="text-left px-4 py-3 font-semibold">Phone</th>
                <th className="text-left px-4 py-3 font-semibold">Address</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedCustomers.map((c, idx) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/customers/${c.id}`)}
                  className={`border-t border-gray-300 cursor-pointer hover:bg-gray-100 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                >
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 truncate max-w-xs">{c.address ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => openEdit(c)}
                        className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-gray-100"
                      >
                        <Pencil size={13} strokeWidth={2} />
                      </button>
                      <button
                        onClick={() => remove(c)}
                        className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-red-50 hover:border-red-300 text-red-600"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && customers.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">No customers found</div>
          )}
          {loading && <div className="p-8 text-center text-sm text-gray-500">Loading...</div>}
        </div>

        {!loading && customers.length > 0 && (
          <div className="mt-4">
            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={totalItems}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-md border-2 border-gray-300 w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">{editing.id ? 'Edit customer' : 'New customer'}</h2>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-black">
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Name"
                autoFocus
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
              />
              <input
                value={editing.companyName}
                onChange={(e) => setEditing({ ...editing, companyName: e.target.value })}
                placeholder="Company name (optional)"
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
              />
              <input
                value={editing.phone}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                placeholder="Phone (optional)"
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
              />
              <input
                value={editing.address}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                placeholder="Address (optional)"
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
              />
            </div>

            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

            <button
              onClick={save}
              disabled={saving}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-black text-white rounded-md p-2.5 text-sm font-semibold disabled:bg-gray-300"
            >
              <Check size={16} strokeWidth={2} />
              {saving ? 'Saving...' : editing.id ? 'Save changes' : 'Create customer'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}