'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import * as Sentry from '@sentry/browser';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

// Fallback for the route error boundaries (error.tsx). Without one, a render
// error left a blank white screen. Errors an error boundary catches never
// reach window.onerror, so they're reported to Sentry here (a no-op when
// Sentry isn't configured).
export default function ErrorScreen({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { t } = useLanguage();

  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center p-6 min-h-[60dvh]">
      <div role="alert" className="max-w-sm w-full text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
          <AlertTriangle size={22} />
        </div>
        <h1 className="text-lg font-semibold text-black">{t('common.errorTitle')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('common.errorBody')}</p>
        {error.digest && <p className="mt-2 text-xs text-gray-400 font-mono">{error.digest}</p>}
        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <button
            onClick={() => retry()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
          >
            <RotateCcw size={15} /> {t('common.tryAgain')}
          </button>
          <Link
            href="/home"
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-md border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            {t('common.goHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}
