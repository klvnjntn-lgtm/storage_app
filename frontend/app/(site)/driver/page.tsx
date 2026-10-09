'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  XCircle,
  MapPin,
  MapPinOff,
  Navigation,
  AlertTriangle,
  Camera,
  Phone,
  StickyNote,
  Clock,
  LocateFixed,
  LocateOff,
  RotateCcw,
} from 'lucide-react';
import { apiFetch, getDeviceId } from '@/lib/apifetch';
import { CSRF_HEADERS } from '@/lib/session';
import { display } from '@/lib/fonts';
import { useLanguage } from '@/app/context/LanguageContext';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useGpsWatch, type GpsStatus, type GpsFix } from '@/lib/hooks/useGpsWatch';

type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

// A DO stop or a customer visit — see DeliveryRoutesService.presentStop.
type Stop = {
  id: string;
  sequence: number;
  status: StopStatus;
  plannedEta: string | null;
  atRisk: boolean;
  late: boolean;
  kind: 'DELIVERY_ORDER' | 'CUSTOMER';
  label: string;
  customerName: string | null;
  address: string | null;
  failureReason: string | null;
  // Prisma Decimal fields serialize as strings over JSON, not numbers.
  destinationLatitude: string | null;
  destinationLongitude: string | null;
  // Raw DeliveryOrder status — proof/failure only work once it's SHIPPED.
  deliveryOrder: { id: string; status: string } | null;
  // Directions set on the customer record (notes + building photos,
  // photos as short-lived signed paths).
  customerInfo: {
    phone: string | null;
    deliveryNotes: string | null;
    locationPhotos: { id: string; path: string }[];
  } | null;
};

function formatEta(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Navigation only ever uses the pin. The address is a free-text note for
// the driver ("behind the mosque, blue gate") — Google Maps would search it
// literally and route somewhere wrong, so an unpinned stop gets no button.
function googleMapsUrl(stop: Stop): string {
  if (stop.destinationLatitude && stop.destinationLongitude) {
    return `https://www.google.com/maps/dir/?api=1&destination=${stop.destinationLatitude},${stop.destinationLongitude}`;
  }
  return '';
}

// Reads the destination aloud, then hands off to Google Maps. speak() has
// to run inside the tap itself (iOS only allows speech from a user
// gesture); the hand-off waits for it to finish, capped so a missing voice
// or a muted engine never strands the driver. Same tab rather than a new
// one: a window.open() after the wait would be popup-blocked, and on a
// phone the link opens the Maps app anyway.
function announceThenNavigate(text: string, lang: string, url: string) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    window.location.href = url;
  };
  if (!('speechSynthesis' in window)) {
    go();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.95;
  utterance.onend = go;
  utterance.onerror = go;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  setTimeout(go, 6000);
}

type RouteWithStops = {
  id: string;
  name: string | null;
  status: string;
  team: { id: string; name: string };
  stops: Stop[];
  currentStop: Stop | null;
};

// Where a stop's proof/failure go: a DO stop through its delivery order
// (as before), a customer stop through the route.
function stopEndpoints(routeId: string, stop: Stop) {
  if (stop.deliveryOrder) {
    const base = `/delivery-orders/${stop.deliveryOrder.id}`;
    return { photo: `${base}/proof-photo`, proof: `${base}/proof-of-delivery`, failure: `${base}/failure` };
  }
  const base = `/delivery-routes/${routeId}/stops/${stop.id}`;
  return { photo: `${base}/proof-photo`, proof: `${base}/proof`, failure: `${base}/failure` };
}

// No Content-Type set here deliberately — the browser fills in the
// multipart boundary itself. apiFetch always sets Content-Type:
// application/json, so this bypasses it rather than fighting it.
// Goes to private proof storage, not the media library.
async function uploadProofPhoto(path: string, file: File): Promise<boolean> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { ...CSRF_HEADERS, 'X-Device-Id': getDeviceId() },
    body: formData,
  });
  return res.ok;
}

// Best-effort single-shot GPS capture — the fallback when the warm watch
// (useGpsWatch) has no fresh reading. Never blocks the action on
// permission being denied, the API being unsupported or a timeout. Comes
// from the device, never from the photo's EXIF. accuracy (metres) goes
// along so the backend only turns a tight fix into a customer's first pin.
type Fix = { latitude?: number; longitude?: number; accuracy?: number };
function captureLocation(): Promise<Fix> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({});
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
        }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

// Matches the backend's MAX_BACKFILL_ACCURACY_METERS: anything vaguer is
// saved on the delivery but never becomes a customer pin.
const FAIR_ACCURACY_M = 50;
const GOOD_ACCURACY_M = 30;

// Location quality the driver sees before tapping Mark delivered.
function GpsChip({ status, best }: { status: GpsStatus; best: GpsFix | null }) {
  const { t } = useLanguage();
  if (status === 'denied' || status === 'insecure' || status === 'unsupported') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 text-sm font-semibold">
        <LocateOff size={20} className="shrink-0" />
        {t('delivery.driver.gps.blockedTitle')}
      </div>
    );
  }
  if (!best) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-gray-100 border border-gray-200 text-gray-600 px-3 py-2.5 text-sm font-medium">
        <LocateFixed size={20} className="shrink-0 animate-pulse motion-reduce:animate-none" />
        {t('delivery.driver.gps.searching')}
      </div>
    );
  }
  const m = Math.round(best.accuracy ?? Infinity);
  const tone =
    m <= GOOD_ACCURACY_M
      ? { box: 'bg-green-50 border-green-200 text-green-800', label: t('delivery.driver.gps.good') }
      : m <= FAIR_ACCURACY_M
        ? { box: 'bg-amber-50 border-amber-200 text-amber-800', label: t('delivery.driver.gps.fair') }
        : { box: 'bg-red-50 border-red-200 text-red-700', label: t('delivery.driver.gps.weak') };
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${tone.box}`}>
      <LocateFixed size={20} className="shrink-0" />
      <span className="font-semibold">
        {Number.isFinite(m) ? t('delivery.driver.gps.accuracy', { m }) : t('delivery.driver.gps.fair')}
      </span>
      <span className="text-xs opacity-80">· {tone.label}</span>
    </div>
  );
}

// Page-level help when location can't work at all, with how to fix it.
function GpsBlockedBanner({ status }: { status: GpsStatus }) {
  const { t } = useLanguage();
  if (status !== 'denied' && status !== 'insecure' && status !== 'unsupported') return null;
  return (
    <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 space-y-2 text-red-800">
      <p className="flex items-center gap-2 text-base font-bold">
        <LocateOff size={22} className="shrink-0" />
        {t('delivery.driver.gps.blockedTitle')}
      </p>
      {status === 'denied' ? (
        <>
          <p className="text-sm">{t('delivery.driver.gps.blockedBody')}</p>
          <ul className="text-sm space-y-1.5 list-disc pl-5">
            <li>{t('delivery.driver.gps.blockedAndroid')}</li>
            <li>{t('delivery.driver.gps.blockedIos')}</li>
          </ul>
          <button
            onClick={() => window.location.reload()}
            className="w-full h-12 rounded-xl bg-red-600 text-white text-base font-semibold flex items-center justify-center gap-2"
          >
            <RotateCcw size={18} />
            {t('delivery.driver.gps.reload')}
          </button>
        </>
      ) : (
        <p className="text-sm">
          {status === 'insecure' ? t('delivery.driver.gps.insecure') : t('delivery.driver.gps.unsupported')}
        </p>
      )}
    </div>
  );
}

// Thumbnail of the photo the driver just took, so they can see it worked.
// The blob URL is released once the image has decoded — it keeps showing.
function PhotoThumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- local blob preview
    <img
      src={url}
      alt=""
      onLoad={() => URL.revokeObjectURL(url)}
      className="h-16 w-16 rounded-lg object-cover border border-gray-200 shrink-0"
    />
  );
}

// Big numbered circle: the stop's place in the route, or its outcome.
function StopMarker({ stop, current }: { stop: Stop; current: boolean }) {
  if (stop.status === 'DELIVERED') return <CheckCircle2 size={32} className="text-green-600 shrink-0" />;
  if (stop.status === 'FAILED') return <XCircle size={32} className="text-red-600 shrink-0" />;
  return (
    <span
      className={`${display.className} flex items-center justify-center w-9 h-9 rounded-full text-base font-bold shrink-0 ${
        current ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 border border-blue-200'
      }`}
    >
      {stop.sequence}
    </span>
  );
}

export default function DriverRoutePage() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const { user, loading: userLoading } = useCurrentUser();

  const [routes, setRoutes] = useState<RouteWithStops[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Non-error heads-up, e.g. delivered without GPS.
  const [notice, setNotice] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [receivedByDraft, setReceivedByDraft] = useState<Record<string, string>>({});
  const [failureDraft, setFailureDraft] = useState<Record<string, string>>({});
  const [failingStopId, setFailingStopId] = useState<string | null>(null);
  const [photoDraft, setPhotoDraft] = useState<Record<string, File>>({});
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null);

  // GPS stays warm only while there's something left to deliver.
  const hasPending = routes.some((r) => r.stops.some((s) => s.status === 'PENDING'));
  const gps = useGpsWatch(user?.role === 'DRIVER' && hasPending);

  // Best warm reading if there is one, else ask the phone once.
  async function takeFix(): Promise<Fix> {
    const f = gps.bestFix();
    if (f) return { latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy };
    return captureLocation();
  }

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

  async function handleMarkDelivered(routeId: string, stop: Stop) {
    const key = stop.id;
    const urls = stopEndpoints(routeId, stop);
    setActionLoading(key);
    setError(null);
    setNotice(null);
    try {
      const { latitude, longitude, accuracy } = await takeFix();

      // Photo first: it attaches to the stop/delivery order directly, and
      // the proof locks it once the delivery is signed for.
      const photo = photoDraft[key];
      if (photo) {
        setUploadingPhotoFor(key);
        const ok = await uploadProofPhoto(urls.photo, photo);
        setUploadingPhotoFor(null);
        if (!ok) {
          setError(t('delivery.driver.photoUploadFailed'));
          return;
        }
      }

      const receivedBy = receivedByDraft[key]?.trim() || undefined;
      const res = await apiFetch(urls.proof, {
        method: 'PATCH',
        body: JSON.stringify(
          stop.deliveryOrder
            ? {
                receivedBy,
                signedAt: new Date().toISOString(),
                completedLatitude: latitude,
                completedLongitude: longitude,
                completedAccuracy: accuracy,
              }
            : { receivedBy, latitude, longitude, accuracy },
        ),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.driver.requestFailed', { status: res.status }));
        return;
      }
      if (latitude == null) setNotice(t('delivery.driver.locationDenied'));
      await load();
    } catch {
      setError(t('delivery.driver.couldNotReachServer'));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMarkFailed(routeId: string, stop: Stop) {
    const key = stop.id;
    setActionLoading(key);
    setError(null);
    setNotice(null);
    try {
      const { latitude, longitude } = await takeFix();
      const res = await apiFetch(stopEndpoints(routeId, stop).failure, {
        method: 'POST',
        body: JSON.stringify({
          reason: failureDraft[key]?.trim() || undefined,
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
    return <p className="text-base text-gray-500">{t('delivery.driver.loading')}</p>;
  }

  if (!user || user.role !== 'DRIVER') {
    return null;
  }

  const statusLabels: Record<StopStatus, string> = {
    PENDING: t('delivery.driver.statusLabel.PENDING'),
    DELIVERED: t('delivery.driver.statusLabel.DELIVERED'),
    FAILED: t('delivery.driver.statusLabel.FAILED'),
  };

  const allStops = routes.flatMap((r) => r.stops);
  const hasAnyStops = allStops.length > 0;
  const doneCount = allStops.filter((s) => s.status !== 'PENDING').length;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border-2 border-red-200 text-red-700 text-base font-medium rounded-xl px-4 py-3">
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 bg-amber-50 border-2 border-amber-200 text-amber-800 text-base rounded-xl px-4 py-3">
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          {notice}
        </div>
      )}

      {hasPending && <GpsBlockedBanner status={gps.status} />}

      {!hasAnyStops && !loading && (
        <div className="rounded-2xl border border-blue-500/15 bg-white shadow-sm p-6 text-center text-base text-gray-500">
          {t('delivery.driver.noRoute')}
        </div>
      )}

      {hasAnyStops && (
        <div className="rounded-2xl border border-blue-500/15 bg-white shadow-sm p-4 space-y-2">
          <p className={`${display.className} text-lg font-bold`}>
            {hasPending ? t('delivery.driver.progress', { done: doneCount, total: allStops.length }) : t('delivery.driver.allDone')}
          </p>
          <div className="h-3 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(doneCount / allStops.length) * 100}%` }} />
          </div>
        </div>
      )}

      {routes.map((route) => (
        <div key={route.id} className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-900/50">
            {route.team.name}{route.name ? ` · ${route.name}` : ''}
          </p>
          {route.stops.map((stop) => {
            const isCurrent = route.currentStop?.id === stop.id;
            const doId = stop.id; // draft/busy key — one per stop, whatever its kind
            const busy = actionLoading === doId;
            // A DO must be shipped before it can be delivered; a customer
            // visit can be recorded any time it's pending.
            const awaitingDispatch = stop.deliveryOrder?.status === 'PACKED';
            const actionable = stop.status === 'PENDING' && (stop.deliveryOrder ? stop.deliveryOrder.status === 'SHIPPED' : true);
            // Customer stops require receiver + photo (the DO flow keeps
            // its existing optional fields).
            const proofMissing = !stop.deliveryOrder && (!receivedByDraft[doId]?.trim() || !photoDraft[doId]);
            const info = stop.customerInfo;
            const mapsUrl = googleMapsUrl(stop);

            // Finished stops collapse to one line so the remaining work stands out.
            if (stop.status !== 'PENDING') {
              return (
                <div key={stop.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white/70 px-3 py-2.5">
                  <StopMarker stop={stop} current={false} />
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold truncate text-gray-700">{stop.label}</div>
                    {stop.status === 'FAILED' && stop.failureReason && (
                      <div className="text-sm text-red-600 truncate">{stop.failureReason}</div>
                    )}
                  </div>
                  <span
                    className={`text-sm font-semibold shrink-0 ${stop.status === 'DELIVERED' ? 'text-green-700' : 'text-red-700'}`}
                  >
                    {statusLabels[stop.status]}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={stop.id}
                className={`rounded-2xl bg-white shadow-sm overflow-hidden ${
                  isCurrent ? 'border-2 border-blue-600 ring-4 ring-blue-100' : 'border border-blue-500/15'
                }`}
              >
                {isCurrent && (
                  <div className="bg-blue-600 text-white text-xs font-bold tracking-widest px-4 py-1.5">
                    {t('delivery.driver.nextStop')}
                  </div>
                )}
                <div className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <StopMarker stop={stop} current={isCurrent} />
                    <div className="min-w-0 flex-1">
                      <div className={`${display.className} text-xl font-bold leading-tight break-words`}>{stop.label}</div>
                      {stop.address && (
                        <div className="text-base text-gray-600 flex items-start gap-1.5 mt-1">
                          <MapPin size={18} className="shrink-0 mt-0.5 text-blue-600" />
                          <span className="break-words">{stop.address}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {stop.plannedEta && (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-700 bg-gray-100 rounded-full px-2.5 py-1">
                            <Clock size={14} />
                            {t('delivery.driver.eta')} {formatEta(stop.plannedEta)}
                          </span>
                        )}
                        {stop.late && (
                          <span className="inline-flex items-center gap-1 text-sm font-bold text-white bg-red-600 rounded-full px-2.5 py-1">
                            <AlertTriangle size={14} />
                            {t('delivery.driver.late')}
                          </span>
                        )}
                        {stop.atRisk && (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                            <AlertTriangle size={14} />
                            {t('delivery.driver.atRisk')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {info && (info.deliveryNotes || info.locationPhotos.length > 0) && (
                    <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-2">
                      {info.deliveryNotes && (
                        <p className="text-base text-blue-900 flex gap-2 whitespace-pre-line">
                          <StickyNote size={18} className="shrink-0 mt-0.5" />
                          {info.deliveryNotes}
                        </p>
                      )}
                      {info.locationPhotos.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto">
                          {info.locationPhotos.map((p) => (
                            <a key={p.id} href={`/api${p.path}`} target="_blank" rel="noreferrer" className="block shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable */}
                              <img
                                src={`/api${p.path}`}
                                alt={t('delivery.driver.locationPhotoAlt')}
                                className="h-24 w-32 object-cover rounded-lg border border-blue-200"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!mapsUrl && (
                    <p className="flex items-start gap-2 text-base text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                      <MapPinOff size={20} className="shrink-0 mt-0.5" />
                      {t('delivery.driver.noPin')}
                    </p>
                  )}

                  {(mapsUrl || info?.phone) && (
                    <div className="flex gap-2">
                      {mapsUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            announceThenNavigate(
                              t('delivery.driver.startingRoute', {
                                name: stop.customerName ?? stop.address ?? stop.label,
                              }),
                              language === 'id' ? 'id-ID' : 'en-US',
                              mapsUrl,
                            )
                          }
                          className="flex-1 h-14 flex items-center justify-center gap-2 rounded-xl bg-blue-600 text-white text-lg font-semibold shadow-sm active:bg-blue-700"
                        >
                          <Navigation size={22} />
                          {t('delivery.driver.navigate')}
                        </button>
                      )}
                      {info?.phone && (
                        <a
                          href={`tel:${info.phone}`}
                          aria-label={info.phone}
                          className={`h-14 flex items-center justify-center gap-2 rounded-xl border-2 border-blue-200 bg-white text-blue-700 text-lg font-semibold ${
                            mapsUrl ? 'px-5' : 'flex-1'
                          }`}
                        >
                          <Phone size={22} />
                          {t('delivery.driver.callCustomer')}
                        </a>
                      )}
                    </div>
                  )}

                  {awaitingDispatch && (
                    <p className="flex items-start gap-2 text-base text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                      <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                      {t('delivery.driver.awaitingDispatch')}
                    </p>
                  )}

                  {actionable && (
                    <div className="space-y-3 pt-3 border-t border-gray-100">
                      <input
                        type="text"
                        placeholder={t(stop.deliveryOrder ? 'delivery.driver.receivedByLabel' : 'delivery.driver.receivedByRequired')}
                        value={receivedByDraft[doId] ?? ''}
                        onChange={(e) => setReceivedByDraft((d) => ({ ...d, [doId]: e.target.value }))}
                        className="w-full h-12 border-2 border-gray-300 rounded-xl px-3 text-base focus:border-blue-600 focus:outline-none"
                      />

                      {photoDraft[doId] ? (
                        <div className="flex items-center gap-3 rounded-xl border-2 border-green-200 bg-green-50 p-2">
                          <PhotoThumb file={photoDraft[doId]} />
                          <div className="flex-1 min-w-0 flex items-center gap-1.5 text-base font-semibold text-green-800">
                            <CheckCircle2 size={20} className="shrink-0" />
                            {t('delivery.driver.photoTaken')}
                          </div>
                          <label className="shrink-0 h-12 px-3 flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold cursor-pointer">
                            <RotateCcw size={16} />
                            {t('delivery.driver.retakePhoto')}
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
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center gap-1 h-24 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/50 text-blue-700 text-base font-semibold cursor-pointer active:bg-blue-50">
                          <Camera size={30} />
                          {t(stop.deliveryOrder ? 'delivery.driver.photoLabel' : 'delivery.driver.photoRequired')}
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
                      )}
                      {uploadingPhotoFor === doId && (
                        <p className="text-base text-gray-500">{t('delivery.driver.uploadingPhoto')}</p>
                      )}

                      <GpsChip status={gps.status} best={gps.best} />

                      {failingStopId === doId ? (
                        <div className="space-y-2 rounded-xl border-2 border-red-200 bg-red-50/50 p-3">
                          <input
                            type="text"
                            placeholder={t('delivery.driver.failureReasonPlaceholder')}
                            value={failureDraft[doId] ?? ''}
                            onChange={(e) => setFailureDraft((d) => ({ ...d, [doId]: e.target.value }))}
                            className="w-full h-12 border-2 border-gray-300 bg-white rounded-xl px-3 text-base focus:border-red-500 focus:outline-none"
                          />
                          <div className="flex gap-2">
                            <button
                              disabled={busy}
                              onClick={() => handleMarkFailed(route.id, stop)}
                              className="flex-1 h-12 flex items-center justify-center gap-2 bg-red-600 text-white text-base font-semibold rounded-xl disabled:opacity-50"
                            >
                              <XCircle size={20} />
                              {busy ? t('delivery.driver.marking') : t('delivery.driver.confirm')}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => setFailingStopId(null)}
                              className="flex-1 h-12 border-2 border-gray-300 bg-white text-base font-semibold rounded-xl"
                            >
                              {t('delivery.driver.cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <button
                            disabled={busy || proofMissing}
                            onClick={() => handleMarkDelivered(route.id, stop)}
                            className="w-full h-14 flex items-center justify-center gap-2 bg-green-600 text-white text-lg font-bold rounded-xl shadow-sm disabled:opacity-40 active:bg-green-700"
                          >
                            <CheckCircle2 size={24} />
                            {busy ? t('delivery.driver.marking') : t('delivery.driver.markDelivered')}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => setFailingStopId(doId)}
                            className="w-full h-12 flex items-center justify-center gap-2 bg-white text-red-700 border-2 border-red-200 text-base font-semibold rounded-xl disabled:opacity-50"
                          >
                            <XCircle size={20} />
                            {t('delivery.driver.markFailed')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
