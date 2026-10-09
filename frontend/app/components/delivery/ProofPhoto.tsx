'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

// Proof photos are private: fetched on demand as a short-lived signed
// link (legacy media-library proofs come back as their public URL).
// linkPath is the API route that returns the photo's link — a delivery
// order's or a customer route stop's proof-photo-link.
export default function ProofPhoto({ linkPath }: { linkPath: string }) {
  const { t } = useLanguage();
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function show() {
    setLoading(true);
    setFailed(false);
    try {
      const res = await apiFetch(linkPath);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.path) {
        setFailed(true);
        return;
      }
      setSrc(body.kind === 'signed' ? `/api${body.path}` : body.path);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-2 border-gray-300 rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{t('sales.deliveryOrderDetail.proofPhoto')}</p>
          <p className="text-xs text-gray-500">{t('sales.deliveryOrderDetail.proofPhotoPrivate')}</p>
        </div>
        {!src && (
          <button
            onClick={show}
            disabled={loading}
            className="text-xs px-2.5 py-1.5 rounded-md border-2 border-gray-300 bg-white font-semibold hover:border-blue-500/40 disabled:opacity-50 shrink-0"
          >
            {t('sales.deliveryOrderDetail.showProofPhoto')}
          </button>
        )}
      </div>
      {failed && <p className="text-xs text-red-600">{t('sales.deliveryOrderDetail.proofPhotoFailed')}</p>}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL; not for next/image
        <img
          src={src}
          alt={t('sales.deliveryOrderDetail.proofPhoto')}
          onError={() => {
            setSrc(null);
            setFailed(true);
          }}
          className="max-h-[480px] w-auto rounded-md border border-gray-200"
        />
      )}
    </div>
  );
}
