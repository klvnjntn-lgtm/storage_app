'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCw, X } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { useEscapeToClose } from '@/lib/hooks/useEscapeToClose';

// A photo that opens full screen when tapped, fitted whole whichever way it was
// taken. Rotating is for looking only, for a photo taken with the phone sideways
// and its screen rotation locked, which comes out on its side; the file and any
// proof stamp on it stay as they are.
export default function PhotoZoom({
  src,
  alt,
  className,
  onError,
}: {
  src: string;
  alt: string;
  className?: string;
  onError?: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState(0);
  const close = () => {
    setOpen(false);
    setTurns(0);
  };
  useEscapeToClose(open, close);

  // The page behind shouldn't scroll while the photo is up.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const sideways = turns % 2 === 1;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={t('common.enlargePhoto')}
        className="block max-w-full cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL or local preview, not optimizable */}
        <img src={src} alt={alt} onError={onError} className={className} />
      </button>
      {open &&
        // On <body>: a transformed ancestor would otherwise trap a fixed overlay.
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            data-no-map-focus
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URL or local preview, not optimizable */}
            <img
              src={src}
              alt={alt}
              onClick={(e) => e.stopPropagation()}
              style={{
                transform: `rotate(${turns * 90}deg)`,
                maxWidth: sideways ? '100dvh' : '100vw',
                maxHeight: sideways ? '100vw' : '100dvh',
              }}
              className="object-contain transition-transform"
            />
            <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 flex gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTurns((n) => n + 1);
                }}
                aria-label={t('common.rotatePhoto')}
                className="h-11 w-11 flex items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
              >
                <RotateCw size={20} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                }}
                aria-label={t('common.close')}
                className="h-11 w-11 flex items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
              >
                <X size={22} />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
