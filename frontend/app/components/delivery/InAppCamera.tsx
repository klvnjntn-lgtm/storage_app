'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

// The driver's proof camera, inside the page. Opening the phone's camera
// app (<input capture>) sends Chrome to the background, and on a phone
// short of memory Android closes it — the driver comes back to a fresh
// page and the photo is gone ("sisa memori sedikit"). Streaming the camera
// here keeps the page alive. When the browser can't (no camera API,
// permission refused, camera busy), the driver is offered the phone's
// camera app instead.
export function inAppCameraSupported(): boolean {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
  return !recentlyFailed();
}

// A phone where the in-app camera failed goes straight to its camera app
// for a while, instead of showing the failure screen at every stop.
const FAILED_KEY = 'driver.inAppCameraFailedAt';
const FAILED_FOR_MS = 7 * 24 * 60 * 60 * 1000;
function recentlyFailed(): boolean {
  try {
    const at = Number(localStorage.getItem(FAILED_KEY));
    return !!at && Date.now() - at < FAILED_FOR_MS;
  } catch {
    return false;
  }
}
function rememberFailure() {
  try {
    localStorage.setItem(FAILED_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

// Tried in order. Some phones' back cameras refuse 1080p, and some refuse
// the first request right after the permission prompt (camera still
// busy), so a failure is retried with less asked of it before giving up.
// Enough for a 1280px proof photo; asking for the sensor's full size
// would cost the memory this is here to save.
const ATTEMPTS: MediaStreamConstraints[] = [
  { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
  { audio: false, video: { facingMode: { ideal: 'environment' } } },
  { audio: false, video: true },
];
const RETRY_DELAY_MS = 400;
// A stream that never shows a picture (seen on some phones) counts as
// failed, so the driver isn't left at a black screen.
const NO_PICTURE_MS = 10_000;

async function openStream(isCancelled: () => boolean): Promise<MediaStream> {
  let lastError: unknown;
  for (const [i, constraints] of ATTEMPTS.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    if (isCancelled()) break;
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      // Refused by the person or the phone's settings: asking again with
      // other sizes won't change that.
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') break;
    }
  }
  throw lastError;
}

export default function InAppCamera({
  onCapture,
  onClose,
  onUsePhoneCamera,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
  onUsePhoneCamera: () => void;
}) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Why it failed, small on the failure screen, for whoever helps the
  // driver over the phone.
  const [failReason, setFailReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  function releaseCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    openStream(() => cancelled)
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        video.play().catch(() => {});
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Refused by the driver: they can still allow it, so ask again
        // next time rather than skipping the in-app camera.
        if (!(err instanceof DOMException && err.name === 'NotAllowedError')) rememberFailure();
        setFailReason(err instanceof DOMException ? err.name : null);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      releaseCamera();
    };
  }, []);

  useEffect(() => {
    if (ready || failed) return;
    const timer = setTimeout(() => {
      releaseCamera();
      rememberFailure();
      setFailReason('NoPicture');
      setFailed(true);
    }, NO_PICTURE_MS);
    return () => clearTimeout(timer);
  }, [ready, failed]);

  // The phone's camera app can't open while this page still holds the
  // camera — it waits until the browser lets go, which looks like a long
  // load. Let go first.
  function usePhoneCamera() {
    releaseCamera();
    onUsePhoneCamera();
  }

  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy) return;
    setBusy(true);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    canvas.width = canvas.height = 0;
    if (!blob) {
      setBusy(false);
      setFailed(true);
      return;
    }
    onCapture(new File([blob], `proof-${Date.now()}.jpg`, { type: 'image/jpeg' }));
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {failed ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <Camera size={40} className="text-white/70" />
          <p className="text-base text-white">
            {t(failReason === 'NotAllowedError' ? 'delivery.driver.cameraBlocked' : 'delivery.driver.cameraUnavailable')}
          </p>
          {failReason && <p className="text-xs text-white/50">{failReason}</p>}
          <button
            onClick={usePhoneCamera}
            className="h-12 w-full max-w-xs rounded-xl bg-blue-600 text-base font-semibold text-white"
          >
            {t('delivery.driver.usePhoneCamera')}
          </button>
          <button onClick={onClose} className="h-12 w-full max-w-xs rounded-xl border border-white/40 text-base text-white">
            {t('delivery.driver.closeCamera')}
          </button>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            playsInline
            muted
            onLoadedMetadata={() => setReady(true)}
            className="flex-1 min-h-0 w-full object-contain"
          />
          <div className="flex items-center justify-between px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <button
              onClick={onClose}
              aria-label={t('delivery.driver.closeCamera')}
              className="h-12 w-12 flex items-center justify-center rounded-full bg-white/15 text-white"
            >
              <X size={24} />
            </button>
            <button
              onClick={shoot}
              disabled={!ready || busy}
              aria-label={t('delivery.driver.shutter')}
              className="h-20 w-20 rounded-full border-4 border-white bg-white/90 active:bg-white disabled:opacity-40"
            />
            <button
              onClick={usePhoneCamera}
              className="h-12 px-3 rounded-full bg-white/15 text-xs font-semibold text-white"
            >
              {t('delivery.driver.usePhoneCamera')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
