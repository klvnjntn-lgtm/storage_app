'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, SwitchCamera, X } from 'lucide-react';
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

// A phone where the in-app camera keeps failing goes straight to its
// camera app for a while, instead of showing the failure screen at every
// stop. Kept short and only after failures in a row: the camera app is
// what gets Chrome closed on a phone short of memory, so a one-off (camera
// busy for a moment) mustn't send the driver there for the rest of the
// day. A picture showing clears it.
const FAILED_KEY = 'driver.inAppCameraFailures';
const FAILED_FOR_MS = 60 * 60 * 1000;
const FAILURES_TO_SKIP = 2;
function readFailures(): { count: number; at: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(FAILED_KEY) ?? 'null') as { count?: number; at?: number } | null;
    if (!saved?.at || Date.now() - saved.at >= FAILED_FOR_MS) return { count: 0, at: 0 };
    return { count: saved.count ?? 0, at: saved.at };
  } catch {
    return { count: 0, at: 0 };
  }
}
function recentlyFailed(): boolean {
  return readFailures().count >= FAILURES_TO_SKIP;
}
function rememberFailure() {
  try {
    localStorage.setItem(FAILED_KEY, JSON.stringify({ count: readFailures().count + 1, at: Date.now() }));
  } catch {
    // ignore
  }
}
function forgetFailures() {
  try {
    localStorage.removeItem(FAILED_KEY);
    localStorage.removeItem('driver.inAppCameraFailedAt'); // the old 7-day memory
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
// Switching asks for that camera exactly: "ideal" could hand back the same
// camera and look like the button did nothing.
type Facing = 'environment' | 'user';
function switchAttempts(facing: Facing): MediaStreamConstraints[] {
  return [
    { audio: false, video: { facingMode: { exact: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { audio: false, video: { facingMode: { exact: facing } } },
  ];
}
const RETRY_DELAY_MS = 400;
// A stream that never shows a picture (seen on some phones) counts as
// failed, so the driver isn't left at a black screen.
const NO_PICTURE_MS = 10_000;
const SWITCH_NOTICE_MS = 4_000;

async function hasSeveralCameras(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput').length > 1;
  } catch {
    return false;
  }
}

async function openStream(attempts: MediaStreamConstraints[], isCancelled: () => boolean): Promise<MediaStream> {
  let lastError: unknown;
  for (const [i, constraints] of attempts.entries()) {
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
  onFailed,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
  onUsePhoneCamera: () => void;
  // Why it couldn't show a picture (a DOMException name, or 'NoPicture').
  onFailed?: (reason: string | null) => void;
}) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Why it failed, small on the failure screen, for whoever helps the
  // driver over the phone.
  const [failReason, setFailReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Always starts on the back camera: most proof photos are of the goods,
  // so a flip at one stop shouldn't carry over to the next.
  const [facing, setFacing] = useState<Facing>('environment');
  const [canSwitch, setCanSwitch] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchFailed, setSwitchFailed] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  // Bumped to abandon a switch in progress (closed, or gone to the phone's
  // camera app), so a camera opening late isn't left held.
  const switchRun = useRef(0);
  // Latest onFailed without restarting the camera when it changes.
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onFailedRef.current = onFailed;
  });

  function releaseCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    openStream(ATTEMPTS, () => cancelled)
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
        // Only counts properly once the camera permission has been given.
        hasSeveralCameras().then((several) => {
          if (!cancelled) setCanSwitch(several);
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Refused by the driver: they can still allow it, so ask again
        // next time rather than skipping the in-app camera.
        if (!(err instanceof DOMException && err.name === 'NotAllowedError')) rememberFailure();
        const reason = err instanceof DOMException ? err.name : null;
        setFailReason(reason);
        setFailed(true);
        onFailedRef.current?.(reason);
      });
    return () => {
      cancelled = true;
      switchRun.current += 1;
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
      onFailedRef.current?.('NoPicture');
    }, NO_PICTURE_MS);
    return () => clearTimeout(timer);
  }, [ready, failed]);

  useEffect(() => {
    if (!switchFailed) return;
    const timer = setTimeout(() => setSwitchFailed(false), SWITCH_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [switchFailed]);

  // Opens a camera and waits for its picture, the only proof that it works:
  // false (camera let go again) if none shows in time.
  async function showCamera(attempts: MediaStreamConstraints[], run: number): Promise<boolean> {
    const stream = await openStream(attempts, () => run !== switchRun.current);
    if (run !== switchRun.current) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) return false;
    const pictured = await new Promise<boolean>((resolve) => {
      const done = (result: boolean) => {
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onPicture);
        resolve(result);
      };
      const onPicture = () => done(true);
      const timer = setTimeout(() => done(false), NO_PICTURE_MS);
      video.addEventListener('loadedmetadata', onPicture);
      video.srcObject = stream;
      video.play().catch(() => {});
    });
    if (!pictured && run === switchRun.current) releaseCamera();
    return pictured;
  }

  // Cheaper phones can't run two cameras at once, so the current one is let
  // go before the other opens. A camera that won't open returns the driver
  // to the one that was working, and doesn't count as a failure of the
  // in-app camera: one bad flip mustn't send them to the camera app.
  async function switchCamera() {
    if (!ready || switching || busy) return;
    switchRun.current += 1;
    const run = switchRun.current;
    const previous = facing;
    const next: Facing = previous === 'environment' ? 'user' : 'environment';
    setSwitching(true);
    setSwitchFailed(false);
    releaseCamera();
    if (videoRef.current) videoRef.current.srcObject = null;
    const open = (attempts: MediaStreamConstraints[]) => showCamera(attempts, run).catch(() => false);
    if (await open(switchAttempts(next))) {
      if (run !== switchRun.current) return;
      setFacing(next);
      setSwitching(false);
      return;
    }
    if (run !== switchRun.current) return;
    setSwitchFailed(true);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    if (run !== switchRun.current) return;
    const restored = await open(previous === 'environment' ? ATTEMPTS : switchAttempts(previous));
    if (run !== switchRun.current) return;
    setSwitching(false);
    if (restored) return;
    // Neither camera works now: a real failure, handled like any other.
    rememberFailure();
    setFailReason('NoPicture');
    setFailed(true);
    onFailedRef.current?.('NoPicture');
  }

  // The phone's camera app can't open while this page still holds the
  // camera — it waits until the browser lets go, which looks like a long
  // load. Let go first.
  function usePhoneCamera() {
    switchRun.current += 1;
    releaseCamera();
    onUsePhoneCamera();
  }

  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy || switching) return;
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
    <div className="fixed inset-0 z-50 flex flex-col landscape:flex-row bg-black">
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
            onLoadedMetadata={() => {
              setReady(true);
              forgetFailures();
            }}
            // Mirrored on screen only, like a selfie camera; the photo itself
            // isn't, so any text in it stays readable.
            className={`flex-1 min-h-0 min-w-0 w-full landscape:w-auto landscape:h-full object-contain ${facing === 'user' ? '-scale-x-100' : ''}`}
          />
          {switchFailed && (
            <p
              role="status"
              className="absolute top-[max(1rem,env(safe-area-inset-top))] inset-x-4 rounded-lg bg-black/70 px-3 py-2 text-center text-sm text-white"
            >
              {t('delivery.driver.cameraSwitchFailed')}
            </p>
          )}
          {/* Beside the picture when the phone is on its side, where a bar below would eat most of it. */}
          <div className="flex landscape:flex-col-reverse items-center justify-between px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] landscape:px-4 landscape:py-3 landscape:pr-[max(1rem,env(safe-area-inset-right))]">
            <button
              onClick={onClose}
              aria-label={t('delivery.driver.closeCamera')}
              className="h-12 w-12 flex items-center justify-center rounded-full bg-white/15 text-white"
            >
              <X size={24} />
            </button>
            <button
              onClick={shoot}
              disabled={!ready || busy || switching}
              aria-label={t('delivery.driver.shutter')}
              className="h-20 w-20 rounded-full border-4 border-white bg-white/90 active:bg-white disabled:opacity-40"
            />
            {/* Stacked: side by side these don't fit beside the shutter on a small phone. */}
            <div className="flex flex-col items-center gap-2">
              {canSwitch && (
                <button
                  onClick={switchCamera}
                  disabled={!ready || busy || switching}
                  aria-label={t('delivery.driver.switchCamera')}
                  className="h-12 w-12 flex items-center justify-center rounded-full bg-white/15 text-white disabled:opacity-40"
                >
                  <SwitchCamera size={24} />
                </button>
              )}
              <button
                onClick={usePhoneCamera}
                className="h-12 px-3 rounded-full bg-white/15 text-xs font-semibold text-white"
              >
                {t('delivery.driver.usePhoneCamera')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
