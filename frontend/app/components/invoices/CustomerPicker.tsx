'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, X, Check, User } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { Customer } from './types';

const SEARCH_DEBOUNCE_MS = 250;

export function CustomerPicker({
  value,
  onChange,
  hasError,
}: {
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newNpwp, setNewNpwp] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuickAddOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open || quickAddOpen) return;
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const q = query.trim();
        const res = await apiFetch(q ? `/customers?q=${encodeURIComponent(q)}` : '/customers');
        if (res.ok) setResults(await res.json());
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query, open, quickAddOpen]);

  function openQuickAdd() {
    setNewName(query.trim());
    setNewPhone('');
    setNewAddress('');
    setNewNpwp('');
    setSaveError('');
    setQuickAddOpen(true);
  }

  async function submitQuickAdd() {
    if (!newName.trim()) {
      setSaveError('Name is required');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const res = await apiFetch('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          phone: newPhone.trim() || undefined,
          address: newAddress.trim() || undefined,
          npwp: newNpwp.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Failed to create customer (${res.status})`);
      }
      const created: Customer = await res.json();
      onChange(created);
      setOpen(false);
      setQuickAddOpen(false);
      setQuery('');
    } catch (e: any) {
      setSaveError(e.message || 'Could not create customer');
    } finally {
      setSaving(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 border border-blue-500/20 rounded-lg bg-blue-600/5 p-2.5 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <User size={14} strokeWidth={2} className="text-blue-600/70 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{value.name}</p>
            {value.phone && <p className="text-xs text-gray-500 truncate">{value.phone}</p>}
          </div>
        </div>
        <button
          onClick={() => onChange(null)}
          className="text-xs px-2 py-1 rounded-md border border-blue-500/20 text-blue-700 hover:bg-white shrink-0 transition-colors"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative mb-3" ref={containerRef}>
      <div
        onClick={() => setOpen(true)}
        className={`flex items-center gap-2 border rounded-lg p-2.5 cursor-text bg-white transition-colors ${
          hasError ? 'border-amber-400' : 'border-blue-500/20 focus-within:border-blue-500/50'
        }`}
      >
        <Search size={14} strokeWidth={2} className="text-blue-600/70 shrink-0" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search customer by name or phone..."
          className="w-full text-sm outline-none bg-transparent"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1.5 bg-white border border-blue-500/20 rounded-xl shadow-lg overflow-hidden">
          {quickAddOpen ? (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">New customer</p>
                <button onClick={() => setQuickAddOpen(false)} className="text-gray-400 hover:text-blue-700">
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name"
                autoFocus
                className="w-full border border-blue-500/20 rounded-lg p-2 text-sm mb-2 outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
              />
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Phone (optional)"
                className="w-full border border-blue-500/20 rounded-lg p-2 text-sm mb-2 outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
              />
              <input
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="Address (optional)"
                className="w-full border border-blue-500/20 rounded-lg p-2 text-sm mb-2 outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
              />
              <input
                value={newNpwp}
                onChange={(e) => setNewNpwp(e.target.value)}
                placeholder="NPWP (optional, for B2B tax invoices)"
                className="w-full border border-blue-500/20 rounded-lg p-2 text-sm mb-2 outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
              />
              {saveError && <p className="text-xs text-red-600 mb-2">{saveError}</p>}
              <button
                onClick={submitQuickAdd}
                disabled={saving}
                className="w-full flex items-center justify-center gap-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg p-2 text-sm font-semibold disabled:bg-gray-300 transition-colors"
              >
                <Check size={14} strokeWidth={2} />
                {saving ? 'Saving...' : 'Add & select'}
              </button>
            </div>
          ) : (
            <>
              <div className="max-h-56 overflow-y-auto">
                {searching && <p className="px-3 py-2 text-xs text-gray-400">Loading...</p>}
                {!searching && results.length === 0 && (
                  <p className="px-3 py-2 text-xs text-gray-400">
                    {query.trim() ? 'No matching customers' : 'No customers yet'}
                  </p>
                )}
                {results.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onChange(c);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="w-full flex flex-col items-start px-3 py-2 text-left hover:bg-blue-50/60 border-b border-gray-100 last:border-b-0"
                  >
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.phone && <span className="text-xs text-gray-500">{c.phone}</span>}
                  </button>
                ))}
              </div>
              <button
                onClick={openQuickAdd}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-blue-700 hover:bg-blue-50/60 border-t border-blue-500/15 font-medium"
              >
                <UserPlus size={14} strokeWidth={2} />
                {query.trim() ? `Add "${query.trim()}" as new customer` : 'Add new customer'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}