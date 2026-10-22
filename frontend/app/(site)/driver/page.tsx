'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  User,
} from 'lucide-react';
import { apiFetch, getDeviceId } from '@/lib/apifetch';
import { CSRF_HEADERS } from '@/lib/session';
import { display } from '@/lib/fonts';
import { useLanguage } from '@/app/context/LanguageContext';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useGpsWatch, type GpsStatus, type GpsFix } from '@/lib/hooks/useGpsWatch';
import { shrinkPhoto } from '@/lib/shrinkPhoto';
import { GPS_WAIT_MS, captureLocation, photoStampLines, type Fix } from '@/lib/captureLocation';
import { DRAFT_MAX_AGE_MS, deleteDraft, listDrafts, saveDraft } from '@/lib/driverDrafts';
import { toCalendarDateString } from '@/lib/dates';
import { GOOD_GPS_ACCURACY_M, WEAK_PIN_ACCURACY_M } from '@/app/components/delivery/PinStatus';

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
  // Saved-address name for a customer stop ("Gudang Timur"); null = main address.
  addressLabel: string | null;
  failureReason: string | null;
  // What was recorded when the stop was finished — shown back to the
  // driver on the finished row.
  receivedBy: string | null;
  signedAt: string | null;
  failedAt: string | null;
  hasProofPhoto: boolean;
  // Sent with the photo, before Done (see the backend's presentStop).
  photoTakenAt: string | null;
  pendingReceivedBy: string | null;
  hasFailurePhoto: boolean;
  completedLatitude: string | null;
  completedAccuracy: number | null;
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

function formatTime(iso: string | null): string {
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
    return { photo: `${base}/proof-photo`, proof: `${base}/proof-of-delivery`, failure: `${base}/failure`, draft: `${base}/proof-draft` };
  }
  const base = `/delivery-routes/${routeId}/stops/${stop.id}`;
  return { photo: `${base}/proof-photo`, proof: `${base}/proof`, failure: `${base}/failure`, draft: `${base}/proof-draft` };
}

// A phone on a dying signal can leave a request hanging for minutes with
// the button stuck on "Marking…". Give up after this long so the driver
// can just tap again — whatever already reached the server stays there.
const PHOTO_UPLOAD_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// No Content-Type set here deliberately — the browser fills in the
// multipart boundary itself. apiFetch always sets Content-Type:
// application/json, so this bypasses it rather than fighting it.
// Goes to private proof storage, not the media library.
// Sent with it: when and where it was taken and the name typed so far, so
// the office sees the evidence even if Done is never tapped.
type PhotoMeta = { takenAt?: string; fix?: Fix; receivedBy?: string };
async function uploadProofPhoto(
  path: string,
  file: File,
  meta: PhotoMeta,
): Promise<{ ok: boolean; status?: number; message?: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (meta.takenAt) formData.append('takenAt', meta.takenAt);
  if (meta.fix?.latitude != null && meta.fix.longitude != null) {
    formData.append('latitude', String(meta.fix.latitude));
    formData.append('longitude', String(meta.fix.longitude));
    if (meta.fix.accuracy != null) formData.append('accuracy', String(meta.fix.accuracy));
  }
  if (meta.receivedBy?.trim()) formData.append('receivedBy', meta.receivedBy.trim());
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { ...CSRF_HEADERS, 'X-Device-Id': getDeviceId() },
    body: formData,
    signal: timeoutSignal(PHOTO_UPLOAD_TIMEOUT_MS),
  });
  if (res.ok) return { ok: true, status: res.status };
  const body = await res.json().catch(() => null);
  return { ok: false, status: res.status, message: typeof body?.message === 'string' ? body.message : undefined };
}

// Android often drops the page while the camera app is open; it comes back
// as a fresh load at the top. Remember which stop opened the camera so the
// reload can scroll back to it (ignored after a couple of minutes, e.g.
// when the camera was cancelled).
const RETURN_TO_KEY = 'driver.returnTo';
const RETURN_TO_MAX_AGE_MS = 2 * 60 * 1000;
function rememberReturnTo(stopId: string) {
  try {
    sessionStorage.setItem(RETURN_TO_KEY, JSON.stringify({ stopId, at: Date.now() }));
  } catch {
    // ignore
  }
}
function clearReturnTo() {
  try {
    sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // ignore
  }
}
function takeReturnTo(): string | null {
  try {
    const raw = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    if (!raw) return null;
    const { stopId, at } = JSON.parse(raw) as { stopId: string; at: number };
    return Date.now() - at < RETURN_TO_MAX_AGE_MS ? stopId : null;
  } catch {
    return null;
  }
}

// The server said no (wrong date, stop already resolved…) rather than the
// connection failing — sending the same photo again won't help.
function isRefusal(status: number | undefined): boolean {
  return status != null && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

// How often a photo kept on the phone is tried again while the page is open.
const PHOTO_RETRY_MS = 20_000;

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

// Matches WEAK_PIN_ACCURACY_M: a vaguer fix still becomes the customer's
// pin if they have none, but the office sees it flagged as weak.
const FAIR_ACCURACY_M = WEAK_PIN_ACCURACY_M;
const GOOD_ACCURACY_M = GOOD_GPS_ACCURACY_M;

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

// The proof photo the driver sent, fetched as a short-lived signed link
// once the row is opened (see ProofPhoto for the office's version).
function SentProofPhoto({ linkPath }: { linkPath: string }) {
  const { t } = useLanguage();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(linkPath)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body?.path) setFailed(true);
        else setSrc(body.kind === 'signed' ? `/api${body.path}` : body.path);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [linkPath]);

  if (failed) return <p className="text-sm text-red-600">{t('delivery.driver.photoLoadFailed')}</p>;
  if (!src) return <p className="text-sm text-gray-500">{t('delivery.driver.loadingPhoto')}</p>;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL; not for next/image */}
      <img
        src={src}
        alt={t('delivery.driver.proofPhotoAlt')}
        onError={() => setFailed(true)}
        className="w-full max-h-80 object-contain rounded-lg border border-gray-200 bg-gray-50"
      />
    </a>
  );
}

// A finished stop (or any stop on a past day) as one line; tap it to see
// what was recorded — when, who received it, the GPS and the photo.
function StopRecord({ routeId, stop, statusLabel }: { routeId: string; stop: Stop; statusLabel: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const doneAt = stop.status === 'DELIVERED' ? stop.signedAt : stop.status === 'FAILED' ? stop.failedAt : null;
  const photoLink = stop.deliveryOrder
    ? `/delivery-orders/${stop.deliveryOrder.id}/proof-photo-link`
    : `/delivery-routes/${routeId}/stops/${stop.id}/proof-photo-link`;
  const tone =
    stop.status === 'DELIVERED' ? 'text-green-700' : stop.status === 'FAILED' ? 'text-red-700' : 'text-gray-500';

  return (
    <div className="rounded-xl border border-gray-200 bg-white/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        <StopMarker stop={stop} current={false} />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold truncate text-gray-700">{stop.label}</div>
          {!open && stop.status === 'FAILED' && stop.failureReason && (
            <div className="text-sm text-red-600 truncate">{stop.failureReason}</div>
          )}
        </div>
        <span className={`text-sm font-semibold shrink-0 text-right ${tone}`}>
          {statusLabel}
          {doneAt && <span className="block text-xs font-medium text-gray-500">{formatTime(doneAt)}</span>}
        </span>
        <ChevronDown size={20} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-2 space-y-2 border-t border-gray-100 text-base">
          {(stop.addressLabel || stop.address) && (
            <p className="flex items-start gap-1.5 text-gray-600">
              <MapPin size={18} className="shrink-0 mt-0.5 text-blue-600" />
              <span className="break-words">
                {stop.addressLabel && <span className="block font-semibold text-gray-900">{stop.addressLabel}</span>}
                {stop.address}
              </span>
            </p>
          )}
          {doneAt && (
            <p className="flex items-center gap-1.5 text-gray-700">
              <Clock size={18} className="shrink-0 text-gray-500" />
              {t(stop.status === 'DELIVERED' ? 'delivery.driver.deliveredAt' : 'delivery.driver.failedAt', {
                time: formatTime(doneAt),
              })}
            </p>
          )}
          {stop.status === 'DELIVERED' && (
            <>
              {stop.receivedBy && (
                <p className="flex items-center gap-1.5 text-gray-700">
                  <User size={18} className="shrink-0 text-gray-500" />
                  {t('delivery.driver.receivedByValue', { name: stop.receivedBy })}
                </p>
              )}
              <p className="flex items-center gap-1.5 text-gray-700">
                {stop.completedLatitude ? (
                  <LocateFixed size={18} className="shrink-0 text-gray-500" />
                ) : (
                  <LocateOff size={18} className="shrink-0 text-amber-600" />
                )}
                {!stop.completedLatitude
                  ? t('delivery.driver.noLocationSaved')
                  : stop.completedAccuracy != null
                    ? t('delivery.driver.locationSaved', { m: Math.round(stop.completedAccuracy) })
                    : t('delivery.driver.locationSavedNoAccuracy')}
              </p>
              {stop.hasProofPhoto ? (
                <SentProofPhoto linkPath={photoLink} />
              ) : (
                <p className="flex items-center gap-1.5 text-gray-500">
                  <Camera size={18} className="shrink-0" />
                  {t('delivery.driver.noProofPhoto')}
                </p>
              )}
            </>
          )}
          {stop.status === 'FAILED' && stop.failureReason && (
            <p className="text-red-700 whitespace-pre-line">{stop.failureReason}</p>
          )}
          {stop.status === 'FAILED' && stop.hasFailurePhoto && <SentProofPhoto linkPath={`${photoLink}?kind=failure`} />}
          {/* Photo sent but Done never tapped: kept for the office, no
              longer finishable from here. */}
          {stop.status === 'PENDING' && stop.hasProofPhoto && (
            <>
              <p className="flex items-start gap-1.5 text-amber-800">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                {t('delivery.driver.notConfirmed', { time: stop.photoTakenAt ? formatTime(stop.photoTakenAt) : '—' })}
              </p>
              {stop.pendingReceivedBy && (
                <p className="flex items-center gap-1.5 text-gray-700">
                  <User size={18} className="shrink-0 text-gray-500" />
                  {t('delivery.driver.receivedByValue', { name: stop.pendingReceivedBy })}
                </p>
              )}
              <SentProofPhoto linkPath={photoLink} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Days back from today the driver can look through: 0 = today.
function dayAt(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return toCalendarDateString(d);
}

export default function DriverRoutePage() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const { user, loading: userLoading } = useCurrentUser();

  const [routes, setRoutes] = useState<RouteWithStops[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Photo refused for want of a GPS reading — shown at that stop's camera,
  // where the driver is looking.
  const [photoGpsFailedFor, setPhotoGpsFailedFor] = useState<string | null>(null);
  // Photo kept on the phone after its upload failed; Done sends it again.
  const [photoQueuedFor, setPhotoQueuedFor] = useState<Record<string, boolean>>({});
  // Uploads in flight per stop (and the photo each is sending), so Done
  // waits for the one already going instead of sending the photo twice,
  // and a retake goes up right after it.
  const uploads = useRef<Record<string, Promise<boolean> | undefined>>({});
  const uploadingFile = useRef<Record<string, File | undefined>>({});
  // Photos the server refused: not retried in the background.
  const refusedPhoto = useRef<Record<string, File | undefined>>({});
  // Receiver names not yet sent to the server (sent after a pause in
  // typing, or at once when the page is being left).
  const nameTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingNames = useRef<Record<string, { url: string; value: string }>>({});
  // Errors from a stop's own actions, shown at that stop — the page-level
  // box is at the top, out of sight of a driver scrolled down to the stop.
  const [stopErrors, setStopErrors] = useState<Record<string, string | undefined>>({});
  function setStopError(stopId: string, message: string | null) {
    setStopErrors((e) => ({ ...e, [stopId]: message ?? undefined }));
  }
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [receivedByDraft, setReceivedByDraft] = useState<Record<string, string>>({});
  const [failureDraft, setFailureDraft] = useState<Record<string, string>>({});
  const [failingStopId, setFailingStopId] = useState<string | null>(null);
  const [photoDraft, setPhotoDraft] = useState<Record<string, File>>({});
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null);
  // GPS reading taken when the photo was, so the delivery is placed where
  // the photo was shot even if the upload only gets through later.
  const [photoFix, setPhotoFix] = useState<Record<string, Fix>>({});
  const [preparingPhotoFor, setPreparingPhotoFor] = useState<string | null>(null);
  // When the photo was taken — that, not the tap on Done, is when the
  // delivery happened.
  const [photoTakenAt, setPhotoTakenAt] = useState<Record<string, string>>({});
  // The current values, for the background retry and for uploads that
  // finish after a retake.
  const latest = useRef({ routes, photoDraft, photoFix, photoTakenAt, receivedByDraft });
  useEffect(() => {
    latest.current = { routes, photoDraft, photoFix, photoTakenAt, receivedByDraft };
  });
  // 0 = today; past days are view-only, to look back at what was done.
  const [daysBack, setDaysBack] = useState(0);
  const isToday = daysBack === 0;

  // GPS stays warm only while there's something left to deliver today.
  const hasPending = isToday && routes.some((r) => r.stops.some((s) => s.status === 'PENDING'));
  const gps = useGpsWatch(user?.role === 'DRIVER' && hasPending);
  // Location can't work at all here, so no photo can be taken.
  const gpsBlocked = gps.status === 'denied' || gps.status === 'insecure' || gps.status === 'unsupported';

  // Best warm reading if there is one, else ask the phone — and keep
  // checking the warm watch meanwhile, since on a weak signal it often
  // lands a reading before the one-off request answers. {} after capMs.
  async function takeFix(capMs = GPS_WAIT_MS): Promise<Fix> {
    const warm = () => {
      const f = gps.bestFix();
      return f ? { latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy } : null;
    };
    const now = warm();
    if (now) return now;
    let poll: ReturnType<typeof setInterval> | undefined;
    const fromWatch = new Promise<Fix>((resolve) => {
      poll = setInterval(() => {
        const f = warm();
        if (f) resolve(f);
      }, 1000);
    });
    const once = captureLocation(capMs).then((f) => (f.latitude != null ? f : warm() ?? f));
    try {
      return await Promise.race([fromWatch, once]);
    } finally {
      clearInterval(poll);
    }
  }

  // Takes the GPS reading at the moment of the photo, stamps date, day,
  // time and that reading onto the photo, and shrinks it for a weak
  // signal. No reading, no photo: the delivery is placed where the photo
  // was taken, so a photo without one would leave it nowhere. Saved on
  // the phone straight away (driverDrafts) so a refresh or closed tab
  // loses nothing. A retake replaces all of it.
  async function onPhotoPicked(routeId: string, stop: Stop, file: File) {
    const stopId = stop.id;
    clearReturnTo();
    setPreparingPhotoFor(stopId);
    setPhotoGpsFailedFor(null);
    try {
      const takenAt = new Date();
      const fix = await takeFix();
      if (fix.latitude == null || fix.longitude == null) {
        setPhotoGpsFailedFor(stopId);
        return;
      }
      const small = await shrinkPhoto(file, { stamp: photoStamp(takenAt, fix) });
      setPhotoDraft((d) => ({ ...d, [stopId]: small }));
      setPhotoFix((f) => ({ ...f, [stopId]: fix }));
      setPhotoTakenAt((a) => ({ ...a, [stopId]: takenAt.toISOString() }));
      setStopError(stopId, null);
      void saveDraft(stopId, {
        photo: small,
        photoFix: { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy },
        photoTakenAt: takenAt.toISOString(),
      });
      // Sent straight away rather than on Done, so a delivery the driver
      // forgets to confirm is still on the office's screen.
      void sendPhoto(routeId, stop, small, { takenAt: takenAt.toISOString(), fix, receivedBy: receivedByDraft[stopId] });
    } finally {
      setPreparingPhotoFor((id) => (id === stopId ? null : id));
    }
  }

  // Uploads a stop's photo; true once the server has it. If it can't get
  // through, the photo stays on the phone (driverDrafts) and goes up in the
  // background later, or on Done. While another upload for the stop is
  // running: the same photo waits for it, a retake is sent right after it.
  function sendPhoto(routeId: string, stop: Stop, photo: File, meta: PhotoMeta): Promise<boolean> {
    const key = stop.id;
    const running = uploads.current[key];
    if (running) {
      if (uploadingFile.current[key] === photo) return running;
      return running.then(() =>
        // Retaken again since? That later photo is sent by its own call.
        latest.current.photoDraft[key] === photo ? sendPhoto(routeId, stop, photo, meta) : true,
      );
    }
    const run = (async () => {
      setUploadingPhotoFor(key);
      uploadingFile.current[key] = photo;
      try {
        const upload = await uploadProofPhoto(stopEndpoints(routeId, stop).photo, photo, meta);
        if (!upload.ok) {
          if (isRefusal(upload.status)) {
            refusedPhoto.current[key] = photo;
            setStopError(key, upload.message ?? t('delivery.driver.photoUploadFailed'));
          } else {
            setPhotoQueuedFor((q) => ({ ...q, [key]: true }));
          }
          return false;
        }
        setPhotoQueuedFor((q) => ({ ...q, [key]: false }));
        setStopError(key, null);
        // Only drop the copy on the phone if it's still the one sent (no
        // retake meanwhile).
        if (latest.current.photoDraft[key] === photo) void saveDraft(key, { photo: undefined });
        setPhotoDraft((d) => {
          if (d[key] !== photo) return d;
          const rest = { ...d };
          delete rest[key];
          return rest;
        });
        setRoutes((rs) =>
          rs.map((r) => ({ ...r, stops: r.stops.map((s) => (s.id === key ? { ...s, hasProofPhoto: true } : s)) })),
        );
        return true;
      } catch {
        setPhotoQueuedFor((q) => ({ ...q, [key]: true }));
        return false;
      } finally {
        delete uploads.current[key];
        delete uploadingFile.current[key];
        setUploadingPhotoFor((id) => (id === key ? null : id));
      }
    })();
    uploads.current[key] = run;
    return run;
  }

  // Photos still on the phone go up on their own once there's signal
  // again, so a driver who never taps Done still gets them to the office.
  function retryQueuedPhotos() {
    const { routes: rs, photoDraft: photos, photoFix: fixes, photoTakenAt: times, receivedByDraft: names } = latest.current;
    for (const r of rs) {
      for (const stop of r.stops) {
        const photo = photos[stop.id];
        if (stop.status !== 'PENDING' || !photo || uploads.current[stop.id]) continue;
        if (refusedPhoto.current[stop.id] === photo) continue;
        void sendPhoto(r.id, stop, photo, { takenAt: times[stop.id], fix: fixes[stop.id], receivedBy: names[stop.id] });
      }
    }
  }

  useEffect(() => {
    if (!isToday) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') retryQueuedPhotos();
    };
    const timer = setInterval(retryQueuedPhotos, PHOTO_RETRY_MS);
    window.addEventListener('online', retryQueuedPhotos);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', retryQueuedPhotos);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday]);

  // Names typed but not yet sent go now if the page is being left — the
  // phone closing the tab, switching apps — rather than after the pause.
  function sendName(key: string) {
    const pending = pendingNames.current[key];
    clearTimeout(nameTimers.current[key]);
    delete pendingNames.current[key];
    if (!pending) return;
    apiFetch(pending.url, {
      method: 'PATCH',
      body: JSON.stringify({ receivedBy: pending.value }),
      keepalive: true,
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    }).catch(() => {});
  }

  useEffect(() => {
    const flush = () => Object.keys(pendingNames.current).forEach(sendName);
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  // The name as it's typed: on the phone at once, on the server shortly
  // after (best-effort) so the office sees it even without Done.
  function onReceivedByChange(routeId: string, stop: Stop, value: string) {
    const key = stop.id;
    setReceivedByDraft((d) => ({ ...d, [key]: value }));
    void saveDraft(key, { receivedBy: value || undefined });
    clearTimeout(nameTimers.current[key]);
    pendingNames.current[key] = { url: stopEndpoints(routeId, stop).draft, value };
    nameTimers.current[key] = setTimeout(() => sendName(key), 1500);
  }

  // "Jumat, 10 Oktober 2026" / "14.32.05 WIB" / "-6.12345, 106.12345 (±12 m)"
  // in the driver's language, from the phone's clock.
  function photoStamp(at: Date, fix: Fix): string[] {
    return photoStampLines(at, fix, language, t('delivery.driver.photoNoGps'));
  }

  useEffect(() => {
    if (!userLoading && (!user || user.role !== 'DRIVER')) {
      router.replace('/home');
    }
  }, [userLoading, user, router]);

  // quiet: re-sync after a failed action without blanking the list or
  // replacing the error the driver is reading.
  async function load({ quiet = false }: { quiet?: boolean } = {}) {
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      // Today leaves the date to the server, as it always has.
      const res = await apiFetch(isToday ? '/delivery-routes/mine' : `/delivery-routes/mine?date=${dayAt(daysBack)}`, {
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (!quiet) setError(body?.message ?? t('delivery.driver.requestFailed', { status: res.status }));
        return;
      }
      const data: RouteWithStops[] = await res.json();
      setRoutes(data);
      await restoreDrafts(data);
    } catch (err) {
      if (!quiet) setError(t(isAbort(err) ? 'delivery.driver.slowConnection' : 'delivery.driver.couldNotReachServer'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  // Brings back what was entered before a refresh or a closed tab, and
  // clears drafts for stops that are finished or long forgotten. What's
  // already on screen wins over what's saved.
  async function restoreDrafts(data: RouteWithStops[]) {
    const stops = new Map(data.flatMap((r) => r.stops).map((s) => [s.id, s]));
    const names: Record<string, string> = {};
    const photos: Record<string, File> = {};
    const fixes: Record<string, Fix> = {};
    const times: Record<string, string> = {};
    for (const draft of await listDrafts()) {
      const stop = stops.get(draft.stopId);
      if ((stop && stop.status !== 'PENDING') || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
        void deleteDraft(draft.stopId);
        continue;
      }
      if (!stop) continue; // another day's route
      if (draft.receivedBy) names[draft.stopId] = draft.receivedBy;
      // A photo the server already has isn't sent again.
      if (draft.photo && !stop.hasProofPhoto) photos[draft.stopId] = draft.photo;
      if (draft.photoFix) fixes[draft.stopId] = draft.photoFix;
      if (draft.photoTakenAt) times[draft.stopId] = draft.photoTakenAt;
    }
    setReceivedByDraft((d) => ({ ...names, ...d }));
    setPhotoDraft((d) => ({ ...photos, ...d }));
    setPhotoFix((f) => ({ ...fixes, ...f }));
    setPhotoTakenAt((a) => ({ ...times, ...a }));
  }

  // Back to the stop that opened the camera if the phone reloaded the page.
  useEffect(() => {
    if (loading) return;
    retryQueuedPhotos();
    const stopId = takeReturnTo();
    if (stopId) requestAnimationFrame(() => document.getElementById(`stop-${stopId}`)?.scrollIntoView({ block: 'start' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    if (user?.role === 'DRIVER') load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, daysBack]);

  // Gets the stop's photo onto the server before Done or Mark failed: waits
  // for the upload already going, or sends one still on the phone. False
  // (with the reason shown at the stop) if it can't get through.
  async function photoSent(routeId: string, stop: Stop): Promise<boolean> {
    const key = stop.id;
    const photo: File | undefined = photoDraft[key];
    const running = uploads.current[key];
    if (!photo && !running) return true;
    const sent = await (photo
      ? sendPhoto(routeId, stop, photo, {
          takenAt: photoTakenAt[key],
          fix: photoFix[key],
          receivedBy: receivedByDraft[key],
        })
      : running!);
    if (!sent) setStopErrors((e) => ({ ...e, [key]: e[key] ?? t('delivery.driver.photoUploadFailed') }));
    return sent;
  }

  async function handleMarkDelivered(routeId: string, stop: Stop) {
    const key = stop.id;
    const urls = stopEndpoints(routeId, stop);
    let failed = false;
    setActionLoading(key);
    setStopError(key, null);
    try {
      // Placed and timed where and when the photo was taken, however much
      // later Done is tapped. A fresh reading only when there's no photo
      // reading to hand (no photo, or one sent before this phone kept
      // drafts) — and a delivery always needs one.
      const shotFix = photoFix[key];
      const { latitude, longitude, accuracy } = shotFix?.latitude != null ? shotFix : await takeFix();
      if (latitude == null || longitude == null) {
        setStopError(key, t('delivery.driver.deliveryNeedsGps'));
        return;
      }
      const signedAt = photoTakenAt[key] ?? new Date().toISOString();

      // Photo first: it attaches to the stop/delivery order directly, and
      // the proof locks it once the delivery is signed for. Usually it
      // went up when it was taken; this waits for that upload, or sends
      // one that didn't get through.
      if (!(await photoSent(routeId, stop))) {
        failed = true;
        return;
      }

      const receivedBy = receivedByDraft[key]?.trim() || undefined;
      const res = await apiFetch(urls.proof, {
        method: 'PATCH',
        body: JSON.stringify(
          stop.deliveryOrder
            ? {
                receivedBy,
                signedAt,
                completedLatitude: latitude,
                completedLongitude: longitude,
                completedAccuracy: accuracy,
              }
            : { receivedBy, signedAt, latitude, longitude, accuracy },
        ),
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setStopError(key, body?.message ?? t('delivery.driver.requestFailed', { status: res.status }));
        failed = true;
        return;
      }
      void deleteDraft(key);
      clearTimeout(nameTimers.current[key]);
      delete pendingNames.current[key];
      // Quietly: blanking the list while it reloads threw the driver back
      // to the top of the page.
      await load({ quiet: true });
    } catch (err) {
      setStopError(key, t(isAbort(err) ? 'delivery.driver.slowConnection' : 'delivery.driver.couldNotReachServer'));
      failed = true;
    } finally {
      setActionLoading(null);
    }
    // A timed-out or refused attempt may still have landed (e.g. signed
    // for, but the reply never made it back): show what the server has
    // rather than leaving a stop the driver can't finish.
    if (failed) await load({ quiet: true });
  }

  async function handleMarkFailed(routeId: string, stop: Stop) {
    const key = stop.id;
    setActionLoading(key);
    setStopError(key, null);
    try {
      // A photo of the attempt (closed shop, locked gate) has to reach the
      // server first — the failure attaches it, and after that the stop
      // takes no more photos.
      if (!(await photoSent(routeId, stop))) return;
      // Where the photo was taken, else a best-effort reading: a failed
      // visit is recorded with or without one.
      const shot = photoFix[key];
      const { latitude, longitude } = shot?.latitude != null ? shot : await takeFix(12_000);
      const res = await apiFetch(stopEndpoints(routeId, stop).failure, {
        method: 'POST',
        body: JSON.stringify({
          reason: failureDraft[key]?.trim() || undefined,
          latitude,
          longitude,
        }),
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setStopError(key, body?.message ?? t('delivery.driver.requestFailed', { status: res.status }));
        return;
      }
      setFailingStopId(null);
      void deleteDraft(key);
      clearTimeout(nameTimers.current[key]);
      delete pendingNames.current[key];
      await load({ quiet: true });
    } catch (err) {
      setStopError(key, t(isAbort(err) ? 'delivery.driver.slowConnection' : 'delivery.driver.couldNotReachServer'));
    } finally {
      setActionLoading(null);
    }
  }

  if (userLoading) {
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

  const locale = language === 'id' ? 'id-ID' : 'en-GB';
  const dayLabel =
    daysBack === 0
      ? t('delivery.driver.today')
      : daysBack === 1
        ? t('delivery.driver.yesterday')
        : new Date(`${dayAt(daysBack)}T00:00:00`).toLocaleDateString(locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          });

  // Nothing from the previous day shows under the new day's heading.
  const shownRoutes = loading ? [] : routes;
  const allStops = shownRoutes.flatMap((r) => r.stops);
  const hasAnyStops = allStops.length > 0;
  const doneCount = allStops.filter((s) => s.status !== 'PENDING').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDaysBack((d) => d + 1)}
          disabled={loading}
          aria-label={t('delivery.driver.prevDay')}
          className="h-12 w-12 flex items-center justify-center rounded-xl border-2 border-gray-300 bg-white text-gray-700 disabled:opacity-40"
        >
          <ChevronLeft size={24} />
        </button>
        <div className="flex-1 text-center">
          <p className={`${display.className} text-lg font-bold`}>{dayLabel}</p>
          {!isToday && <p className="text-xs text-gray-500">{t('delivery.driver.pastDayViewOnly')}</p>}
        </div>
        <button
          type="button"
          onClick={() => setDaysBack((d) => Math.max(0, d - 1))}
          disabled={isToday || loading}
          aria-label={t('delivery.driver.nextDay')}
          className="h-12 w-12 flex items-center justify-center rounded-xl border-2 border-gray-300 bg-white text-gray-700 disabled:opacity-40"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border-2 border-red-200 text-red-700 text-base font-medium rounded-xl px-4 py-3">
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading && <p className="text-base text-gray-500">{t('delivery.driver.loading')}</p>}

      {hasPending && <GpsBlockedBanner status={gps.status} />}

      {!hasAnyStops && !loading && (
        <div className="rounded-2xl border border-blue-500/15 bg-white shadow-sm p-6 text-center text-base text-gray-500">
          {t(isToday ? 'delivery.driver.noRoute' : 'delivery.driver.noRouteOnDay')}
        </div>
      )}

      {hasAnyStops && (
        <div className="rounded-2xl border border-blue-500/15 bg-white shadow-sm p-4 space-y-2">
          <p className={`${display.className} text-lg font-bold`}>
            {doneCount < allStops.length
              ? t('delivery.driver.progress', { done: doneCount, total: allStops.length })
              : t('delivery.driver.allDone')}
          </p>
          <div className="h-3 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(doneCount / allStops.length) * 100}%` }} />
          </div>
        </div>
      )}

      {shownRoutes.map((route) => (
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
            const hasPhoto = !!photoDraft[doId] || stop.hasProofPhoto;
            const proofMissing = !stop.deliveryOrder && (!receivedByDraft[doId]?.trim() || !hasPhoto);
            const info = stop.customerInfo;
            const mapsUrl = googleMapsUrl(stop);

            // Finished stops collapse to one line so the remaining work
            // stands out; a past day shows every stop that way.
            if (stop.status !== 'PENDING' || !isToday) {
              return <StopRecord key={stop.id} routeId={route.id} stop={stop} statusLabel={statusLabels[stop.status]} />;
            }

            return (
              <div
                key={stop.id}
                id={`stop-${stop.id}`}
                className={`rounded-2xl bg-white shadow-sm overflow-hidden scroll-mt-4 ${
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
                      {(stop.addressLabel || stop.address) && (
                        <div className="text-base text-gray-600 flex items-start gap-1.5 mt-1">
                          <MapPin size={18} className="shrink-0 mt-0.5 text-blue-600" />
                          <span className="break-words">
                            {stop.addressLabel && (
                              <span className="block font-semibold text-gray-900">{stop.addressLabel}</span>
                            )}
                            {stop.address}
                          </span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {stop.plannedEta && (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-700 bg-gray-100 rounded-full px-2.5 py-1">
                            <Clock size={14} />
                            {t('delivery.driver.eta')} {formatTime(stop.plannedEta)}
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
                        onChange={(e) => onReceivedByChange(route.id, stop, e.target.value)}
                        className="w-full h-12 border-2 border-gray-300 rounded-xl px-3 text-base focus:border-blue-600 focus:outline-none"
                      />

                      {hasPhoto ? (
                        <div className="flex items-center gap-3 rounded-xl border-2 border-green-200 bg-green-50 p-2">
                          {photoDraft[doId] && <PhotoThumb file={photoDraft[doId]} />}
                          <div className="flex-1 min-w-0 flex items-center gap-1.5 text-base font-semibold text-green-800">
                            <CheckCircle2 size={20} className="shrink-0" />
                            {t(photoDraft[doId] ? 'delivery.driver.photoTaken' : 'delivery.driver.photoAlreadySent')}
                          </div>
                          <label
                            onClick={() => rememberReturnTo(doId)}
                            className="shrink-0 h-12 px-3 flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold cursor-pointer"
                          >
                            <RotateCcw size={16} />
                            {t('delivery.driver.retakePhoto')}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              disabled={gpsBlocked}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) onPhotoPicked(route.id, stop, file);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        </div>
                      ) : (
                        <label
                          onClick={() => rememberReturnTo(doId)}
                          className={`flex flex-col items-center justify-center gap-1 h-24 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/50 text-blue-700 text-base font-semibold ${
                            gpsBlocked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:bg-blue-50'
                          }`}
                        >
                          <Camera size={30} />
                          {t(stop.deliveryOrder ? 'delivery.driver.photoLabel' : 'delivery.driver.photoRequired')}
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            disabled={gpsBlocked}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) onPhotoPicked(route.id, stop, file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                      {preparingPhotoFor === doId && (
                        <p className="text-base text-gray-500">{t('delivery.driver.preparingPhoto')}</p>
                      )}
                      {photoQueuedFor[doId] && photoDraft[doId] && uploadingPhotoFor !== doId && (
                        <p className="text-sm text-amber-700">{t('delivery.driver.photoQueued')}</p>
                      )}
                      {photoGpsFailedFor === doId && (
                        <p className="flex items-start gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2.5 text-base font-medium text-red-700">
                          <LocateOff size={20} className="shrink-0 mt-0.5" />
                          {t('delivery.driver.photoNeedsGps')}
                        </p>
                      )}
                      {uploadingPhotoFor === doId && (
                        <p className="text-base text-gray-500">{t('delivery.driver.uploadingPhoto')}</p>
                      )}

                      <GpsChip status={gps.status} best={gps.best} />

                      {failingStopId === doId ? (
                        <div className="space-y-2 rounded-xl border-2 border-red-200 bg-red-50/50 p-3">
                          <p className="flex items-start gap-1.5 text-sm text-red-800">
                            <Camera size={18} className="shrink-0 mt-0.5" />
                            {t('delivery.driver.failurePhotoHint')}
                          </p>
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
                            disabled={busy || proofMissing || preparingPhotoFor === doId}
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
                      {stopErrors[doId] && (
                        <div role="alert" className="flex items-start gap-2 bg-red-50 border-2 border-red-200 text-red-700 text-base font-medium rounded-xl px-3 py-2.5">
                          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                          {stopErrors[doId]}
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
