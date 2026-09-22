// app/components/purchase-orders/SupplierPicker.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, X, Check, Truck } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { Supplier } from '@/app/components/suppliers/types';
import { useLanguage } from '@/app/context/LanguageContext';

const SEARCH_DEBOUNCE_MS = 250;

export function SupplierPicker({
  supplier,
  onChange,
  hasError,
}: {
  supplier: Supplier | null;
  onChange: (supplier: Supplier | null) => void;
  hasError?: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Supplier[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContactName, setNewContactName] = useState('');
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
      setSearchError('');
      try {
        const q = query.trim();
        const params = new URLSearchParams({ isActive: 'true', pageSize: '10' });
        if (q) params.set('search', q);
        const res = await apiFetch(`/suppliers?${params.toString()}`);
        if (res.ok) {
          const body = await res.json();
          setResults(body.data);
        }
      } catch {
        // FIX — see CustomerPicker.tsx's identical fix: was missing
        // entirely, turning a network failure or expired session into
        // an unhandled rejection with nothing shown to the user.
        setResults([]);
        setSearchError(t('purchasing.supplierPicker.searchFailed'));
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, quickAddOpen]);

  function openQuickAdd() {
    setNewName(query.trim());
    setNewContactName('');
    setNewPhone('');
    setNewAddress('');
    setNewNpwp('');
    setSaveError('');
    setQuickAddOpen(true);
  }

  async function submitQuickAdd() {
    if (!newName.trim()) {
      setSaveError(t('purchasing.supplierPicker.nameRequired'));
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const res = await apiFetch('/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          contactName: newContactName.trim() || undefined,
          phone: newPhone.trim() || undefined,
          address: newAddress.trim() || undefined,
          npwp: newNpwp.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || t('purchasing.supplierPicker.createFailed', { status: res.status }));
      }
      const created: Supplier = await res.json();
      onChange(created);
      setOpen(false);
      setQuickAddOpen(false);
      setQuery('');
    } catch (e: any) {
      setSaveError(e.message || t('purchasing.supplierPicker.createFailedGeneric'));
    } finally {
      setSaving(false);
    }
  }

  if (supplier) {
    return (
      <div className="flex items-center justify-between gap-2 border-2 border-gray-300 rounded-md p-2.5 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Truck size={14} strokeWidth={2} className="text-gray-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{supplier.name}</p>
            {supplier.phone && <p className="text-xs text-gray-500 truncate">{supplier.phone}</p>}
          </div>
        </div>
        <button
          onClick={() => onChange(null)}
          className="text-xs px-2 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 shrink-0"
        >
          {t('purchasing.supplierPicker.change')}
        </button>
      </div>
    );
  }

  return (
    <div className="relative mb-3" ref={containerRef}>
      <div
        onClick={() => setOpen(true)}
        className={`flex items-center gap-2 border-2 rounded-md p-2.5 cursor-text ${
          hasError ? 'border-amber-400' : 'border-gray-300'
        }`}
      >
        <Search size={14} strokeWidth={2} className="text-gray-400 shrink-0" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t('purchasing.supplierPicker.searchPlaceholder')}
          className="w-full text-sm outline-none"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1.5 bg-white border-2 border-gray-200 rounded-md shadow-lg overflow-hidden">
          {quickAddOpen ? (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('purchasing.supplierPicker.newSupplierLabel')}</p>
                <button onClick={() => setQuickAddOpen(false)} className="text-gray-400 hover:text-black">
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('purchasing.supplierPicker.namePlaceholder')}
                autoFocus
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm mb-2 outline-none focus:border-black"
              />
              <input
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder={t('purchasing.supplierPicker.contactPlaceholder')}
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm mb-2 outline-none focus:border-black"
              />
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder={t('purchasing.supplierPicker.phonePlaceholder')}
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm mb-2 outline-none focus:border-black"
              />
              <input
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder={t('purchasing.supplierPicker.addressPlaceholder')}
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm mb-2 outline-none focus:border-black"
              />
              <input
                value={newNpwp}
                onChange={(e) => setNewNpwp(e.target.value)}
                placeholder={t('purchasing.supplierPicker.npwpPlaceholder')}
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm mb-2 outline-none focus:border-black"
              />
              {saveError && <p className="text-xs text-red-600 mb-2">{saveError}</p>}
              <button
                onClick={submitQuickAdd}
                disabled={saving}
                className="w-full flex items-center justify-center gap-1.5 bg-black text-white rounded-md p-2 text-sm font-semibold disabled:bg-gray-300"
              >
                <Check size={14} strokeWidth={2} />
                {saving ? t('purchasing.supplierPicker.saving') : t('purchasing.supplierPicker.addAndSelect')}
              </button>
            </div>
          ) : (
            <>
              <div className="max-h-56 overflow-y-auto">
                {searching && <p className="px-3 py-2 text-xs text-gray-400">{t('purchasing.supplierPicker.loading')}</p>}
                {!searching && searchError && (
                  <p className="px-3 py-2 text-xs text-red-600">{searchError}</p>
                )}
                {!searching && !searchError && results.length === 0 && (
                  <p className="px-3 py-2 text-xs text-gray-400">
                    {query.trim() ? t('purchasing.supplierPicker.noMatching') : t('purchasing.supplierPicker.noneYet')}
                  </p>
                )}
                {results.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onChange(s);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="w-full flex flex-col items-start px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                  >
                    <span className="text-sm font-medium">{s.name}</span>
                    {s.phone && <span className="text-xs text-gray-500">{s.phone}</span>}
                  </button>
                ))}
              </div>
              <button
                onClick={openQuickAdd}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-gray-50 border-t-2 border-gray-100 font-medium"
              >
                <UserPlus size={14} strokeWidth={2} />
                {query.trim()
                  ? t('purchasing.supplierPicker.addAsNew', { name: query.trim() })
                  : t('purchasing.supplierPicker.addNew')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}