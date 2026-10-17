// app/(app)/workshop/parts/oem/[oem]/page.tsx — one part number: what it is, which cars, equivalents, stock
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Hash, ArrowLeft, Copy, Check, ShieldCheck, Users, CircleHelp } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { PartThumb, PartSearchLinks } from '../../PartMedia';


type Confidence = 'verified' | 'confirmed' | 'unverified';
type PartNumber = {
  oemNumber: string;
  items: string[];
  itemTypes: string[];
  genuine: boolean;
  thumbKey: string | null;
  brands: string[];
  cars: { carBrand: string; model: string; generation: string; yearFrom: number | null; yearTo: number | null; confidence: Confidence; sellers: number }[];
  equivalents: { number: string; via: string }[];
  inStock: { productId: string; name: string; quantity: number; oem: string; equivalentVia: string | null }[];
};

const CONFIDENCE: Record<Confidence, { cls: string; icon: typeof ShieldCheck }> = {
  verified: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: ShieldCheck },
  confirmed: { cls: 'bg-blue-50 text-blue-700 border-blue-200', icon: Users },
  unverified: { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: CircleHelp },
};

export default function PartNumberPage() {
  const { oem } = useParams<{ oem: string }>();
  const { t, language } = useLanguage();
  const locale = language === 'id' ? 'id-ID' : 'en-US';
  const [data, setData] = useState<PartNumber | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/part-catalog/oem/${encodeURIComponent(decodeURIComponent(oem))}`);
        if (cancelled) return;
        if (res.ok) setData(await res.json());
        else setError(t('workshop.partsEpc.loadFailed', { status: res.status }));
      } catch {
        if (!cancelled) setError(t('workshop.partsEpc.serverError'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oem]);

  const number = data?.oemNumber ?? decodeURIComponent(oem);
  const qty = (data?.inStock ?? []).reduce((s, p) => s + p.quantity, 0);

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15">
        <div className="max-w-5xl mx-auto flex items-center gap-2.5 min-w-0">
          <Link href="/workshop/parts" className="text-gray-500 hover:text-gray-800" title={t('workshop.partsEpc.back')}>
            <ArrowLeft size={18} />
          </Link>
          {data?.thumbKey ? (
            <PartThumb thumbKey={data.thumbKey} size={48} alt={number} />
          ) : (
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Hash size={18} className="text-blue-700" />
            </span>
          )}
          <div className="min-w-0">
            <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight font-mono flex items-center gap-2`}>
              {number}
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(number);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    // Clipboard can be blocked; the number is visible to copy by hand.
                  }
                }}
                title={t('workshop.partsEpc.copy')}
              >
                {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} className="text-gray-400" />}
              </button>
            </h1>
            <p className="text-xs text-gray-500 truncate">
              {data ? `${data.items.join(' / ')} · ${data.itemTypes.join(' / ')}` : t('workshop.partsEpc.loading')}
            </p>
            <PartSearchLinks query={`${number} ${data?.items[0] ?? ''}`} />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>}
        {data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border-2 border-gray-200 bg-white p-4">
                <div className="text-xs text-gray-500 mb-1">{t('workshop.partsEpc.origin')}</div>
                <div className="font-semibold">{data.genuine ? t('workshop.partsEpc.genuineSeen') : t('workshop.partsEpc.genuineNotSeen')}</div>
                {data.brands.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {data.brands.map((b) => (
                      <span key={b} className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-700">{b}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl border-2 border-gray-200 bg-white p-4">
                <div className="text-xs text-gray-500 mb-1">{t('workshop.partsEpc.yourStock')}</div>
                {data.inStock.length ? (
                  <>
                    <div className="font-semibold">{t('workshop.partsEpc.inStock', { qty: qty.toLocaleString(locale) })}</div>
                    {data.inStock.map((p) => (
                      <Link key={p.productId} href={`/inventory/stock/${p.productId}`} className="block text-xs text-blue-700 hover:underline truncate">
                        {p.name} ({p.oem}){p.equivalentVia ? ` ≈ ${p.equivalentVia}` : ''}
                      </Link>
                    ))}
                  </>
                ) : (
                  <div className="text-gray-400">{t('workshop.partsEpc.notStocked')}</div>
                )}
              </div>
              <div className="rounded-xl border-2 border-gray-200 bg-white p-4">
                <div className="text-xs text-gray-500 mb-1">{t('workshop.partsEpc.equivalents')}</div>
                {data.equivalents.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {data.equivalents.map((e) => (
                      <Link
                        key={e.number}
                        href={`/workshop/parts/oem/${encodeURIComponent(e.number)}`}
                        title={e.via}
                        className="font-mono text-sm text-blue-800 hover:underline"
                      >
                        {e.number}
                      </Link>
                    ))}
                    <div className="w-full text-xs text-gray-500">{data.equivalents[0].via}</div>
                  </div>
                ) : (
                  <div className="text-gray-400">—</div>
                )}
              </div>
            </div>

            <div className="border-2 border-gray-300 rounded-md overflow-hidden bg-white">
              <div className="px-4 py-3 bg-blue-50/60 border-b-2 border-gray-300 font-semibold text-sm">
                {t('workshop.partsEpc.fitsCars', { count: data.cars.length })}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <tbody>
                    {data.cars.map((c, idx) => {
                      const conf = CONFIDENCE[c.confidence];
                      const ConfIcon = conf.icon;
                      return (
                        <tr key={`${c.carBrand}|${c.model}|${c.generation}`} className={`border-t border-gray-200 ${idx % 2 ? 'bg-gray-50' : ''}`}>
                          <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                            <Link
                              href={`/workshop/parts?${new URLSearchParams({ brand: c.carBrand, model: c.model, ...(c.yearFrom ? { year: String(c.yearFrom) } : {}) }).toString()}`}
                              className="hover:text-blue-700"
                            >
                              {c.carBrand} {c.model}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{c.generation || '—'}</td>
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                            {c.yearFrom ? `${c.yearFrom}–${c.yearTo ?? t('workshop.partsEpc.present')}` : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${conf.cls}`}>
                              <ConfIcon size={12} />
                              {t(`workshop.partsEpc.confidence.${c.confidence}`)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {data.cars.length === 0 && <div className="p-6 text-center text-sm text-gray-500">{t('workshop.partsEpc.noCars')}</div>}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
