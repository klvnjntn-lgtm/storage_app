'use client';

import { useState } from 'react';
import { Check, StickyNote } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import LandmarkPhotos, { type PhotoLocation } from '@/app/components/delivery/LandmarkPhotos';

// DELIVERY_DMS — what the driver sees on every stop for this customer:
// directions (notes) and up to two landmark photos (LandmarkPhotos).
export default function CustomerDriverInfoSection({
  customerId,
  deliveryNotes,
  onNotesSaved,
  onPhotoLocated,
}: {
  customerId: string;
  deliveryNotes: string | null;
  onNotesSaved: (notes: string) => void;
  onPhotoLocated?: (location: PhotoLocation) => void;
}) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState(deliveryNotes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState('');

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

      <LandmarkPhotos customerId={customerId} onLocated={onPhotoLocated} />

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
