'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, Circle, MapPin, Navigation, AlertTriangle, Camera } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';

type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

type Stop = {
  id: string;
  sequence: number;
  status: StopStatus;
  plannedEta: string | null;
  atRisk: boolean;
  deliveryOrder: {
    id: string;
    doNumber: string | null;
    customerName: string | null;
    deliveryAddress: string | null;
    failureReason: string | null;
    // Prisma Decimal fields serialize as strings over JSON, not numbers.
    destinationLatitude: string | null;
    destinationLongitude: string | null;
  };
};

function formatEta(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function googleMapsUrl(deliveryOrder: Stop['deliveryOrder']): string {
  if (deliveryOrder.destinationLatitude && deliveryOrder.destinationLongitude) {
    return `https://www.google.com/maps/dir/?api=1&destination=${deliveryOrder.destinationLatitude},${deliveryOrder.destinationLongitude}`;
  }
  if (deliveryOrder.deliveryAddress) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(deliveryOrder.deliveryAddress)}`;
  }
  return '';
}

type RouteWithStops = {
  id: string;
  name: string | null;
  status: string;
  stops: Stop[];
  currentStop: Stop | null;
};

function statusBadge(status: StopStatus, label: string) {
  const styles: Record<StopStatus, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-300',
    DELIVERED: 'bg-green-100 text-green-800 border-green-300',
    FAILED: 'bg-red-100 text-red-800 border-red-300',
  };
  const icons: Record<StopStatus, typeof CheckCircle2> = {
    PENDING: Circle,
    DELIVERED: CheckCircle2,
    FAILED: XCircle,
  };
  const Icon = icons[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${styles[status]}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}

// No Content-Type set here deliberately — the browser fills in the
// multipart boundary itself. apiFetch always sets Content-Type:
// application/json, so this bypasses it rather than fighting it.
async function uploadPhoto(file: File): Promise<string | null> {
  const token = localStorage.getItem('accessToken');
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/media', {
    method: 'POST',
    headers: { Authorization: token ? `Bearer ${token}` : '' },
    body: formData,
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.url ?? null;
}

// Best-effort single-shot GPS capture — never blocks the action on
// permission being denied or the API being unsupported, matching the
// spec's "single-shot capture, not continuous tracking" rule.
function captureLocation(): Promise<{ latitude?: number; longitude?: number }> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({});
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve({}),
      { timeout: 8000 },
    );
  });
}

export default function DriverRoutePage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, loading: userLoading } = useCurrentUser();

  const [routes, setRoutes] = useState<RouteWithStops[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [receivedByDraft, setReceivedByDraft] = useState<Record<string, string>>({});
  const [failureDraft, setFailureDraft] = useState<Record<string, string>>({});
  const [failingStopId, setFailingStopId] = useState<string | null>(null);
  const [photoDraft, setPhotoDraft] = useState<Record<string, File>>({});
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null);

  useEffect(() => {
    if (!userLoading && (!user || user.role !== 'DRIVER')) {
      router.replace('/home');
    }
  }, [userLoading, user, router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/delivery-routes/mine');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.driver.requestFailed', { status: res.status }));
        return;
      }
      setRoutes(await res.json());
    } catch {
      setError(t('delivery.driver.couldNotReachServer'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'DRIVER') load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleMarkDelivered(deliveryOrderId: string) {
    setActionLoading(deliveryOrderId);
    setError(null);
    try {
      const { latitude, longitude } = await captureLocation();

      let proofPhotoUrl: string | undefined;
      const photo = photoDraft[deliveryOrderId];
      if (photo) {
        setUploadingPhotoFor(deliveryOrderId);
        const url = await uploadPhoto(photo);
        setUploadingPhotoFor(null);
        if (!url) {
          setError(t('delivery.driver.photoUploadFailed'));
          return;
        }
        proofPhotoUrl = url;
      }

      const res = await apiFetch(`/delivery-orders/${deliveryOrderId}/proof-of-delivery`, {
        method: 'PATCH',
        body: JSON.stringify({
          receivedBy: receivedByDraft[deliveryOrderId]?.trim() || undefined,
          signedAt: new Date().toISOString(),
          completedLatitude: latitude,
          completedLongitude: longitude,
          proofPhotoUrl,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.driver.requestFailed', { status: res.status }));
        return;
      }
      await load();
    } catch {
      setError(t('delivery.driver.couldNotReachServer'));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMarkFailed(deliveryOrderId: string) {
    setActionLoading(deliveryOrderId);
    setError(null);
    try {
      const { latitude, longitude } = await captureLocation();
      const res = await apiFetch(`/delivery-orders/${deliveryOrderId}/failure`, {
        method: 'POST',
        body: JSON.stringify({
          reason: failureDraft[deliveryOrderId]?.trim() || undefined,
          latitude,
          longitude,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.driver.requestFailed', { status: res.status }));
        return;
      }
      setFailingStopId(null);
      await load();
    } catch {
      setError(t('delivery.driver.couldNotReachServer'));
    } finally {
      setActionLoading(null);
    }
  }

  if (userLoading || (user?.role === 'DRIVER' && loading)) {
    return <p className="text-sm text-gray-500">{t('delivery.driver.loading')}</p>;
  }

  if (!user || user.role !== 'DRIVER') {
    return null;
  }

  const statusLabels: Record<StopStatus, string> = {
    PENDING: t('delivery.driver.statusLabel.PENDING'),
    DELIVERED: t('delivery.driver.statusLabel.DELIVERED'),
    FAILED: t('delivery.driver.statusLabel.FAILED'),
  };

  const hasAnyStops = routes.some((r) => r.stops.length > 0);

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>
      )}

      {!hasAnyStops && !loading && (
        <p className="text-sm text-gray-500">{t('delivery.driver.noRoute')}</p>
      )}

      {routes.map((route) => (
        <div key={route.id} className="space-y-2">
          {route.stops.map((stop) => {
            const isCurrent = route.currentStop?.id === stop.id;
            const doId = stop.deliveryOrder.id;
            const busy = actionLoading === doId;
            return (
              <div
                key={stop.id}
                className={`bg-white rounded-lg border p-3 ${isCurrent ? 'border-blue-400 ring-1 ring-blue-100' : 'border-gray-200'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-gray-400 font-medium">#{stop.sequence}</div>
                    <div className="text-sm font-semibold">
                      {stop.deliveryOrder.customerName ?? stop.deliveryOrder.doNumber ?? doId}
                    </div>
                    {stop.deliveryOrder.deliveryAddress && (
                      <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <MapPin size={12} />
                        {stop.deliveryOrder.deliveryAddress}
                      </div>
                    )}
                    {stop.plannedEta && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {t('delivery.driver.eta')} {formatEta(stop.plannedEta)}
                      </div>
                    )}
                    {stop.atRisk && (
                      <div className="inline-flex items-center gap-1 text-xs text-red-600 font-medium mt-0.5">
                        <AlertTriangle size={12} />
                        {t('delivery.driver.atRisk')}
                      </div>
                    )}
                  </div>
                  {statusBadge(stop.status, statusLabels[stop.status])}
                </div>

                {stop.status === 'FAILED' && stop.deliveryOrder.failureReason && (
                  <p className="text-xs text-red-600 mt-2">{stop.deliveryOrder.failureReason}</p>
                )}

                {stop.status === 'PENDING' && (
                  <div className="mt-3 space-y-2">
                    {googleMapsUrl(stop.deliveryOrder) && (
                      <a
                        href={googleMapsUrl(stop.deliveryOrder)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center gap-1.5 text-sm font-medium border border-blue-200 text-blue-700 rounded-md py-1.5"
                      >
                        <Navigation size={14} />
                        {t('delivery.driver.navigate')}
                      </a>
                    )}
                    <input
                      type="text"
                      placeholder={t('delivery.driver.receivedByLabel')}
                      value={receivedByDraft[doId] ?? ''}
                      onChange={(e) => setReceivedByDraft((d) => ({ ...d, [doId]: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm"
                    />

                    <label className="flex items-center justify-center gap-1.5 text-sm font-medium border border-gray-300 rounded-md py-1.5 cursor-pointer">
                      <Camera size={14} />
                      {photoDraft[doId] ? photoDraft[doId].name : t('delivery.driver.photoLabel')}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setPhotoDraft((d) => ({ ...d, [doId]: file }));
                        }}
                      />
                    </label>
                    {uploadingPhotoFor === doId && (
                      <p className="text-xs text-gray-500">{t('delivery.driver.uploadingPhoto')}</p>
                    )}

                    {failingStopId === doId ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder={t('delivery.driver.failureReasonPlaceholder')}
                          value={failureDraft[doId] ?? ''}
                          onChange={(e) => setFailureDraft((d) => ({ ...d, [doId]: e.target.value }))}
                          className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={busy}
                            onClick={() => handleMarkFailed(doId)}
                            className="flex-1 bg-red-600 text-white text-sm font-medium rounded-md py-1.5 disabled:opacity-50"
                          >
                            {busy ? t('delivery.driver.marking') : t('delivery.driver.confirm')}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => setFailingStopId(null)}
                            className="flex-1 border border-gray-300 text-sm font-medium rounded-md py-1.5"
                          >
                            {t('delivery.driver.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          disabled={busy}
                          onClick={() => handleMarkDelivered(doId)}
                          className="flex-1 bg-green-600 text-white text-sm font-medium rounded-md py-1.5 disabled:opacity-50"
                        >
                          {busy ? t('delivery.driver.marking') : t('delivery.driver.markDelivered')}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setFailingStopId(doId)}
                          className="flex-1 bg-red-50 text-red-700 border border-red-200 text-sm font-medium rounded-md py-1.5 disabled:opacity-50"
                        >
                          {t('delivery.driver.markFailed')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
