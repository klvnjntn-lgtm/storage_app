'use client';

import { useEffect, useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { apiFetch, getDeviceId } from '@/lib/apifetch';
import { CSRF_HEADERS } from '@/lib/session';
import { shrinkPhoto } from '@/lib/shrinkPhoto';
import { captureLocation, noFixMessage, type Fix } from '@/lib/captureLocation';
import { useLanguage } from '@/app/context/LanguageContext';
import { useDialog } from '@/app/components/shared/DialogProvider';
import GoogleMapsLink from '@/app/components/delivery/GoogleMapsLink';
import { DeliveryFixBadge } from '@/app/components/delivery/PinStatus';

// Must match CustomerLocationService.MAX_LOCATION_PHOTOS.
export const MAX_LANDMARK_PHOTOS = 2;

// Decimal latitude/longitude arrive as strings; null for a plain upload.
// `path` is a short-lived signed link — the photos are private.
type SavedPhoto = {
  id: string;
  path: string;
  takenAt: string | null;
  latitude: string | null;
  longitude: string | null;
  accuracy: number | null;
};

// A photo picked for a customer that doesn't exist yet (the New customer
// dialog); uploaded with uploadLandmarkPhoto once it's created.
export type PendingLandmarkPhoto = {
  key: string;
  file: File;
  previewUrl: string;
  takenAt?: string;
  fix?: Fix;
};

export function discardPending(photos: PendingLandmarkPhoto[]) {
  photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
}

// Multipart — bypasses apiFetch's JSON Content-Type. Returns the
// customer's photos after the upload.
export async function uploadLandmarkPhoto(
  customerId: string,
  photo: { file: File; takenAt?: string; fix?: Fix },
): Promise<SavedPhoto[]> {
  const formData = new FormData();
  formData.append('file', photo.file);
  if (photo.takenAt) formData.append('takenAt', photo.takenAt);
  const fix = photo.fix;
  if (fix?.latitude != null && fix.longitude != null) {
    formData.append('latitude', String(fix.latitude));
    formData.append('longitude', String(fix.longitude));
    if (fix.accuracy != null) formData.append('accuracy', String(fix.accuracy));
  }
  const res = await fetch(`/api/customers/${customerId}/location-photos`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { ...CSRF_HEADERS, 'X-Device-Id': getDeviceId() },
    body: formData,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `Upload failed (${res.status})`);
  return body;
}

// DELIVERY_DMS — photos of the customer's building/entrance (a landmark)
// shown to the driver on every stop. Two ways to add one:
// - Take photo: the camera, and the GPS reading at that moment, saved with
//   the photo — the same capture as a driver's proof photo, but nothing is
//   stamped on the picture. No reading, no photo (as for the driver): the
//   point of this button is the location. It also fills the customer's pin
//   if they have none.
// - Upload photo: an existing picture, saved without a location.
// With a customerId each photo is saved straight away; without one (a
// customer being created) they're kept in `pending` for the parent.
// onLocated: a photo with a GPS reading was added. The backend fills an
// empty customer pin from it (CustomerLocationService.upload), so the
// parent can show that pin without reloading.
export type PhotoLocation = { lat: number; lng: number; accuracy: number | null };

export default function LandmarkPhotos({
  customerId,
  pending = [],
  onPendingChange,
  onLocated,
}: {
  customerId: string | null;
  pending?: PendingLandmarkPhoto[];
  onPendingChange?: (photos: PendingLandmarkPhoto[]) => void;
  onLocated?: (location: PhotoLocation) => void;
}) {
  const dialog = useDialog();
  const { t } = useLanguage();
  const [saved, setSaved] = useState<SavedPhoto[]>([]);
  const [busy, setBusy] = useState<'camera' | 'upload' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch(`/customers/${customerId}/location-photos`);
      if (res.ok && !cancelled) setSaved(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const count = (customerId ? saved.length : 0) + pending.length;

  async function add(picked: File, mode: 'camera' | 'upload') {
    setBusy(mode);
    setError('');
    try {
      let takenAt: string | undefined;
      let fix: Fix | undefined;
      if (mode === 'camera') {
        takenAt = new Date().toISOString();
        fix = await captureLocation();
        if (fix.latitude == null || fix.longitude == null) {
          setError(`${t('customers.driverInfo.takePhotoNoGps')} ${await noFixMessage(t)}`);
          return;
        }
      }
      const file = await shrinkPhoto(picked);
      if (customerId) {
        setSaved(await uploadLandmarkPhoto(customerId, { file, takenAt, fix }));
      } else {
        onPendingChange?.([
          ...pending,
          { key: `${Date.now()}-${pending.length}`, file, previewUrl: URL.createObjectURL(file), takenAt, fix },
        ]);
      }
      if (fix?.latitude != null && fix.longitude != null) {
        onLocated?.({ lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy ?? null });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('customers.driverInfo.uploadFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function removeSaved(photoId: string) {
    if (!(await dialog.confirm(t('customers.driverInfo.confirmDeletePhoto'), { danger: true }))) return;
    setError('');
    const res = await apiFetch(`/customers/${customerId}/location-photos/${photoId}`, { method: 'DELETE' });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message || t('customers.driverInfo.deleteFailed'));
      return;
    }
    setSaved(body);
  }

  function removePending(key: string) {
    discardPending(pending.filter((p) => p.key === key));
    onPendingChange?.(pending.filter((p) => p.key !== key));
  }

  const tiles = [
    ...(customerId
      ? saved.map((p) => ({
          key: p.id,
          src: `/api${p.path}`,
          lat: p.latitude,
          lng: p.longitude,
          accuracy: p.accuracy,
          onRemove: () => removeSaved(p.id),
        }))
      : []),
    ...pending.map((p) => ({
      key: p.key,
      src: p.previewUrl,
      lat: p.fix?.latitude ?? null,
      lng: p.fix?.longitude ?? null,
      accuracy: p.fix?.accuracy ?? null,
      onRemove: () => removePending(p.key),
    })),
  ];

  const pickerClass = `flex-1 min-w-[7rem] flex items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-2 py-2 text-xs font-semibold ${
    busy ? 'opacity-50' : 'cursor-pointer'
  }`;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-600">
        {t('customers.driverInfo.photosLabel', { count, max: MAX_LANDMARK_PHOTOS })}
      </p>
      {tiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tiles.map((p) => (
            <div key={p.key} className="w-32 space-y-1">
              <div className="relative">
                <a href={p.src} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed URL / local preview, not optimizable */}
                  <img
                    src={p.src}
                    alt={t('customers.driverInfo.photoAlt')}
                    className="h-24 w-32 object-cover rounded border border-gray-300"
                  />
                </a>
                <button
                  type="button"
                  onClick={p.onRemove}
                  aria-label={t('customers.driverInfo.deletePhoto')}
                  className="absolute top-1 right-1 p-1 rounded bg-white/90 border border-red-200 text-red-600"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <DeliveryFixBadge accuracy={p.lat != null && p.lng != null ? p.accuracy : null} label="photo" />
              <GoogleMapsLink lat={p.lat} lng={p.lng} className="!px-2 !py-1" />
            </div>
          ))}
        </div>
      )}
      {count < MAX_LANDMARK_PHOTOS && (
        <div className="flex flex-wrap gap-2">
          <label className={`${pickerClass} border-blue-300 text-blue-700 bg-blue-50 ${busy ? '' : 'hover:bg-blue-100'}`}>
            <Camera size={16} />
            {busy === 'camera' ? t('customers.driverInfo.takingPhoto') : t('customers.driverInfo.takePhoto')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={!!busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) add(file, 'camera');
              }}
            />
          </label>
          <label className={`${pickerClass} border-gray-300 text-gray-600 ${busy ? '' : 'hover:border-blue-400 hover:text-blue-600'}`}>
            <ImagePlus size={16} />
            {busy === 'upload' ? t('customers.driverInfo.uploading') : t('customers.driverInfo.uploadPhoto')}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={!!busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) add(file, 'upload');
              }}
            />
          </label>
        </div>
      )}
      <p className="text-[11px] text-gray-500">{t('customers.driverInfo.photoOptionsHint')}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
