'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import DeliveryMap from '@/app/components/delivery/DeliveryMap';
import CoordinateInputs from '@/app/components/delivery/CoordinateInputs';
import GoogleMapsLink from '@/app/components/delivery/GoogleMapsLink';
import { PinStatusBadge } from '@/app/components/delivery/PinStatus';
import type { CustomerAddress } from '@/app/components/delivery/CustomerAddressPicker';

type LatLng = { lat: number; lng: number };
// original = the pin as loaded; the location is only sent when it changed,
// so renaming an address doesn't re-save (and lock) a driver's GPS pin.
type Draft = { id: string | null; label: string; address: string; position: LatLng | null; original: LatLng | null };

// Saved delivery sites for a customer (branches, warehouses…), managed on
// the customer page. The customer's own address/location stays the default.
export default function CustomerAddressesSection({
  customerId,
  addresses,
  onChange,
}: {
  customerId: string;
  addresses: CustomerAddress[];
  onChange: (addresses: CustomerAddress[]) => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function openNew() {
    setError('');
    setDraft({ id: null, label: '', address: '', position: null, original: null });
  }

  function openEdit(a: CustomerAddress) {
    setError('');
    setDraft({
      id: a.id,
      label: a.label,
      address: a.address ?? '',
      position: a.latitude && a.longitude ? { lat: Number(a.latitude), lng: Number(a.longitude) } : null,
      original: a.latitude && a.longitude ? { lat: Number(a.latitude), lng: Number(a.longitude) } : null,
    });
  }

  async function save() {
    if (!draft || !draft.label.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(
        draft.id ? `/customers/${customerId}/addresses/${draft.id}` : `/customers/${customerId}/addresses`,
        {
          method: draft.id ? 'PATCH' : 'POST',
          body: JSON.stringify({
            label: draft.label.trim(),
            address: draft.address.trim(),
            ...(draft.position &&
            (draft.position.lat !== draft.original?.lat || draft.position.lng !== draft.original?.lng)
              ? { latitude: draft.position.lat, longitude: draft.position.lng }
              : {}),
          }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.addresses.requestFailed', { status: res.status }));
        return;
      }
      const next = draft.id ? addresses.map((a) => (a.id === body.id ? body : a)) : [...addresses, body];
      onChange(next.sort((a, b) => a.label.localeCompare(b.label)));
      setDraft(null);
    } catch {
      setError(t('delivery.addresses.couldNotReachServer'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: CustomerAddress) {
    if (!confirm(t('delivery.addresses.confirmDelete', { label: a.label }))) return;
    setDeletingId(a.id);
    try {
      const res = await apiFetch(`/customers/${customerId}/addresses/${a.id}`, { method: 'DELETE' });
      if (res.ok) onChange(addresses.filter((x) => x.id !== a.id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="border-2 border-gray-300 rounded-md p-3 mb-6 bg-white">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-sm font-semibold">{t('delivery.addresses.title')}</p>
        <button
          onClick={openNew}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border-2 border-gray-300 font-semibold hover:border-blue-500/40 transition-colors shrink-0"
        >
          <Plus size={12} />
          {t('delivery.addresses.add')}
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-2">{t('delivery.addresses.hint')}</p>

      {addresses.length === 0 && <p className="text-xs text-gray-400">{t('delivery.addresses.empty')}</p>}
      <div className="divide-y divide-gray-100">
        {addresses.map((a) => {
          return (
            <div key={a.id} className="flex items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium">{a.label}</span>
                  <PinStatusBadge pin={a} className="font-medium" />
                </div>
                <p className="text-xs text-gray-500 line-clamp-2">{a.address || t('delivery.addresses.noAddressText')}</p>
                <GoogleMapsLink lat={a.latitude} lng={a.longitude} />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openEdit(a)}
                  aria-label={t('delivery.addresses.edit')}
                  className="p-2 sm:p-1.5 rounded border border-gray-200 text-gray-600 hover:text-blue-700"
                >
                  <Pencil size={13} />
                </button>
                <button
                  disabled={deletingId === a.id}
                  onClick={() => remove(a)}
                  aria-label={t('delivery.addresses.delete')}
                  className="p-2 sm:p-1.5 rounded border border-red-200 text-red-600 disabled:opacity-40"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {draft && (
        <div className="fixed inset-0 bg-black/25 flex items-end sm:items-center justify-center z-[60] sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-lg w-full max-w-lg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 max-h-[95vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {draft.id ? t('delivery.addresses.editTitle') : t('delivery.addresses.addTitle')}
              </h3>
              <button onClick={() => setDraft(null)} aria-label={t('common.cancel')} className="p-2 -m-2 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <label className="block">
              <span className="text-xs text-gray-600">{t('delivery.addresses.labelField')}</span>
              <input
                autoFocus
                value={draft.label}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder={t('delivery.addresses.labelPlaceholder')}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-base sm:text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">{t('delivery.addresses.addressField')}</span>
              <textarea
                value={draft.address}
                maxLength={500}
                rows={2}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-base sm:text-sm"
              />
            </label>
            <DeliveryMap
              stops={[]}
              height={220}
              pickMode
              pickedPosition={draft.position}
              onPick={(lat, lng) => setDraft({ ...draft, position: { lat, lng } })}
            />
            <CoordinateInputs value={draft.position} onChange={(position) => setDraft({ ...draft, position })} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="grid grid-cols-2 sm:flex sm:justify-end gap-2">
              <button
                onClick={() => setDraft(null)}
                className="text-sm font-medium border border-gray-300 rounded-md px-3 py-2.5 sm:py-1.5"
              >
                {t('common.cancel')}
              </button>
              <button
                disabled={saving || !draft.label.trim()}
                onClick={save}
                className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 disabled:opacity-50"
              >
                {saving ? t('common.saving') : t('delivery.addresses.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
