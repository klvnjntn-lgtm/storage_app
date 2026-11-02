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
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        // Enough for a 1280px proof photo; asking for the sensor's full
        // size would cost the memory this is here to save.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        video.play().catch(() => {});
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

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
          <p className="text-base text-white">{t('delivery.driver.cameraUnavailable')}</p>
          <button
            onClick={onUsePhoneCamera}
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
              onClick={onUsePhoneCamera}
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
