'use client';

import { useEffect, useState } from 'react';
import { Camera, Check, StickyNote, Trash2 } from 'lucide-react';
import { apiFetch, getDeviceId } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

// Must match CustomerLocationService.MAX_LOCATION_PHOTOS.
const MAX_PHOTOS = 2;

type LocationPhoto = { id: string; path: string };

// DELIVERY_DMS — what the driver sees on every stop for this customer:
// directions (notes) and up to two photos of the building/entrance.
// Photos are private; `path` is a short-lived signed link.
export default function CustomerDriverInfoSection({
  customerId,
  deliveryNotes,
  onNotesSaved,
}: {
  customerId: string;
  deliveryNotes: string | null;
  onNotesSaved: (notes: string) => void;
}) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState(deliveryNotes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [photos, setPhotos] = useState<LocationPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiFetch(`/customers/${customerId}/location-photos`);
      if (res.ok && !cancelled) setPhotos(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  async function saveNotes() {
    setSavingNotes(true);
    setError('');
    try {
      const res = await apiFetch(`/customers/${customerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ deliveryNotes: notes.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Failed to save (${res.status})`);
      }
      onNotesSaved(notes.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : t('customers.driverInfo.saveFailed'));
    } finally {
      setSavingNotes(false);
    }
  }

  // Multipart — bypasses apiFetch's JSON Content-Type, same as the proof
  // photo upload in the driver app.
  async function upload(file: File) {
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/customers/${customerId}/location-photos`, {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '', 'X-Device-Id': getDeviceId() },
        body: formData,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message || `Upload failed (${res.status})`);
      setPhotos(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('customers.driverInfo.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function remove(photoId: string) {
    if (!confirm(t('customers.driverInfo.confirmDeletePhoto'))) return;
    setError('');
    const res = await apiFetch(`/customers/${customerId}/location-photos/${photoId}`, { method: 'DELETE' });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message || t('customers.driverInfo.deleteFailed'));
      return;
    }
    setPhotos(body);
  }

  const notesChanged = notes.trim() !== (deliveryNotes ?? '').trim();

  return (
    <div className="border-2 border-gray-300 rounded-md p-3 mb-6 bg-white space-y-3">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <StickyNote size={15} className="text-blue-600" />
          {t('customers.driverInfo.title')}
        </h2>
        <p className="text-xs text-gray-500">{t('customers.driverInfo.hint')}</p>
      </div>

      <div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('customers.listPage.deliveryNotesPlaceholder')}
          rows={3}
          maxLength={1000}
          className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
        />
        {notesChanged && (
          <button
            onClick={saveNotes}
            disabled={savingNotes}
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            <Check size={14} />
            {savingNotes ? t('common.saving') : t('customers.driverInfo.saveNotes')}
          </button>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">
          {t('customers.driverInfo.photosLabel', { count: photos.length, max: MAX_PHOTOS })}
        </p>
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative">
              <a href={`/api${p.path}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable */}
                <img
                  src={`/api${p.path}`}
                  alt={t('customers.driverInfo.photoAlt')}
                  className="h-24 w-32 object-cover rounded border border-gray-300"
                />
              </a>
              <button
                onClick={() => remove(p.id)}
                aria-label={t('customers.driverInfo.deletePhoto')}
                className="absolute top-1 right-1 p-1 rounded bg-white/90 border border-red-200 text-red-600"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label
              className={`h-24 w-32 flex flex-col items-center justify-center gap-1 rounded border-2 border-dashed border-gray-300 text-xs text-gray-500 ${
                uploading ? 'opacity-50' : 'cursor-pointer hover:border-blue-400 hover:text-blue-600'
              }`}
            >
              <Camera size={18} />
              {uploading ? t('customers.driverInfo.uploading') : t('customers.driverInfo.addPhoto')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) upload(file);
                }}
              />
            </label>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
