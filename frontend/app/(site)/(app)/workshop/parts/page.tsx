// app/(app)/workshop/parts/page.tsx — EPC-style catalogue: pick a car, browse categories, one card per part
'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { display } from '@/lib/fonts';
import { Wrench, Search, Car, Copy, Check, ShieldCheck, Users, CircleHelp, ListFilter } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { getInitialParam, useSyncQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';
import { PartThumb, PartSearchLinks } from './PartMedia';


type Facets = { brands: { brand: string; models: string[] }[] };
type Confidence = 'verified' | 'confirmed' | 'unverified';
type Counted = { value: string; sellers: number };
type StockMatch = { productId: string; name: string; quantity: number; oem: string; equivalentVia: string | null };
type ItemSummary = {
  itemType: string;
  item: string;
  specs: Counted[];
  oems: { number: string; normalized: string; sellers: number; genuine: boolean }[];
  brands: Counted[];
  confidence: Confidence;
  sellers: number;
  thumbKey: string | null;
  // What WareSys workshops install most for this car (anonymous totals), and how it compares.
  workshop: {
    spec: { value: string; workshops: number; installs: number } | null;
    oem: { value: string; workshops: number; installs: number } | null;
    agreement: 'agrees' | 'listed' | 'differs' | null;
  } | null;
  inStock: StockMatch[];
};
type VehicleSummary = {
  vehicle: { brand: string; model: string; year: number | null; generations: { name: string; yearFrom: number | null; yearTo: number | null }[] };
  categories: { itemType: string; items: ItemSummary[] }[];
};

const CONFIDENCE: Record<Confidence, { cls: string; icon: typeof ShieldCheck }> = {
  verified: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: ShieldCheck },
  confirmed: { cls: 'bg-blue-50 text-blue-700 border-blue-200', icon: Users },
  unverified: { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: CircleHelp },
};

// FIX — useSearchParams() requires a Suspense boundary for static
// prerendering, or `next build` fails outright. See login/page.tsx.
export default function PartsCatalogPage() {
  return (
    <Suspense fallback={null}>
      <PartsCatalogInner />
    </Suspense>
  );
}

function PartsCatalogInner() {
  const { t, language } = useLanguage();
  const locale = language === 'id' ? 'id-ID' : 'en-US';

  const [facets, setFacets] = useState<Facets | null>(null);
  const [brand, setBrand] = useState<string>(() => getInitialParam('brand', ''));
  const [model, setModel] = useState<string>(() => getInitialParam('model', ''));
  const [year, setYear] = useState<string>(() => getInitialParam('year', ''));
  const [category, setCategory] = useState<string>(() => getInitialParam('cat', ''));
  const [find, setFind] = useState('');

  const [data, setData] = useState<VehicleSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useSyncQueryParams({ brand: brand || null, model: model || null, year: year || null, cat: category || null });

  useEffect(() => {
    apiFetch('/part-catalog/facets')
      .then((res) => (res.ok ? res.json() : null))
      .then((f: Facets | null) => f && setFacets(f))
      .catch(() => {});
  }, []);

  const models = useMemo(() => facets?.brands.find((b) => b.brand === brand)?.models ?? [], [facets, brand]);

  useEffect(() => {
    if (!brand || !model) return;
    const params = new URLSearchParams({ brand, model });
    if (/^\d{4}$/.test(year)) params.set('year', year);
    let cancelled = false;
    const timeout = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await apiFetch(`/part-catalog/vehicle?${params.toString()}`);
        if (cancelled) return;
        if (res.ok) {
          setData(await res.json());
        } else {
          const body = await res.json().catch(() => null);
          setError(body?.message ?? t('workshop.partsEpc.loadFailed', { status: res.status }));
        }
      } catch {
        if (!cancelled) setError(t('workshop.partsEpc.serverError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand, model, year]);

  // A summary loaded for a previous car is ignored once the car is cleared.
  const shown = brand && model ? data : null;
  const categories = useMemo(() => shown?.categories ?? [], [shown]);
  const activeCategory = categories.some((c) => c.itemType === category) ? category : categories[0]?.itemType ?? '';
  // Typing in "Find a part" searches every category; otherwise show the selected one.
  const items = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (q) {
      return categories.flatMap((c) => c.items).filter(
        (i) =>
          i.item.toLowerCase().includes(q) ||
          i.itemType.toLowerCase().includes(q) ||
          i.specs.some((s) => s.value.toLowerCase().includes(q)) ||
          i.oems.some((o) => o.normalized.includes(q.toUpperCase().replace(/[^A-Z0-9]/g, ''))),
      );
    }
    return categories.find((c) => c.itemType === activeCategory)?.items ?? [];
  }, [categories, activeCategory, find]);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied((c) => (c === value ? '' : c)), 1500);
    } catch {
      // Clipboard can be blocked; the number is still visible to copy by hand.
    }
  }

  const advancedHref = `/workshop/parts/search?${new URLSearchParams({
    ...(brand ? { brand } : {}),
    ...(model ? { model } : {}),
    ...(year ? { year } : {}),
  }).toString()}`;
  const selectClass =
    'min-w-0 rounded-lg border border-blue-500/20 bg-white px-3 py-2 text-sm outline-none transition-colors hover:border-blue-500/35 focus:border-blue-500/50 disabled:bg-gray-50 disabled:text-gray-400';

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Wrench size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  {t('workshop.partsEpc.title')}
                </h1>
                <p className="text-xs text-gray-500 truncate">{t('workshop.partsEpc.subtitle')}</p>
              </div>
            </div>
            <Link
              href={advancedHref}
              className="flex items-center gap-1.5 shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <ListFilter size={14} />
              {t('workshop.partsEpc.advancedSearch')}
            </Link>
          </div>

          {/* Step 1 — the car. Everything below is filtered to it. */}
          <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_120px] gap-2">
            <select
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setModel('');
                setCategory('');
              }}
              className={selectClass}
            >
              <option value="">{t('workshop.partsEpc.chooseBrand')}</option>
              {facets?.brands.map((b) => (
                <option key={b.brand} value={b.brand}>{b.brand}</option>
              ))}
            </select>
            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setCategory('');
              }}
              disabled={!brand}
              className={selectClass}
            >
              <option value="">{t('workshop.partsEpc.chooseModel')}</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder={t('workshop.partsEpc.year')}
              className={`${selectClass} col-span-2 sm:col-span-1`}
            />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}

        {!brand || !model ? (
          <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-10 text-center">
            <Car size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="font-medium text-gray-700">{t('workshop.partsEpc.pickCarTitle')}</p>
            <p className="text-sm text-gray-500 mt-1">{t('workshop.partsEpc.pickCarHint')}</p>
          </div>
        ) : loading && !shown ? (
          <div className="p-8 text-center text-sm text-gray-500">{t('workshop.partsEpc.loading')}</div>
        ) : shown && categories.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">{t('workshop.partsEpc.noParts')}</div>
        ) : shown ? (
          <>
            {/* The car, as the catalogue understands it */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className={`${display.className} text-lg font-bold`}>
                {shown.vehicle.brand} {shown.vehicle.model}
                {shown.vehicle.year ? ` ${shown.vehicle.year}` : ''}
              </span>
              {shown.vehicle.generations.map((g) => (
                <span key={g.name} className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-600">
                  {g.name}
                  {g.yearFrom ? ` · ${g.yearFrom}–${g.yearTo ?? t('workshop.partsEpc.present')}` : ''}
                </span>
              ))}
            </div>

            {/* Step 2 — category grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
              {categories.map((c) => (
                <button
                  key={c.itemType}
                  type="button"
                  onClick={() => {
                    setCategory(c.itemType);
                    setFind('');
                  }}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    !find && c.itemType === activeCategory
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  <div className="text-sm font-semibold truncate">{c.itemType}</div>
                  <div className={`text-xs ${!find && c.itemType === activeCategory ? 'text-blue-100' : 'text-gray-500'}`}>
                    {t('workshop.partsEpc.partsCount', { count: c.items.length })}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3 mb-4 shadow-sm focus-within:border-blue-500/50">
              <Search size={16} className="text-blue-600/70 shrink-0" />
              <input
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder={t('workshop.partsEpc.findPlaceholder')}
                className="flex-1 min-w-0 text-sm outline-none bg-transparent placeholder:text-gray-400"
              />
            </div>

            {/* Step 3 — one card per part */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((i) => {
                const conf = CONFIDENCE[i.confidence];
                const ConfIcon = conf.icon;
                const exact = i.inStock.filter((p) => !p.equivalentVia);
                const stock = exact.length ? exact : i.inStock;
                const qty = stock.reduce((s, p) => s + p.quantity, 0);
                const mainOem = i.oems[0];
                return (
                  <div key={`${i.itemType}|${i.item}`} className="rounded-xl border-2 border-gray-200 bg-white p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 min-w-0">
                        <PartThumb thumbKey={i.thumbKey} alt={i.item} />
                        <div className="min-w-0">
                          <div className="font-semibold">{i.item}</div>
                          {find && <div className="text-xs text-gray-500">{i.itemType}</div>}
                          <div className="mt-1">
                            <PartSearchLinks
                              query={`${i.item} ${shown.vehicle.brand} ${shown.vehicle.model} ${mainOem?.number ?? i.specs[0]?.value ?? ''}`}
                            />
                          </div>
                        </div>
                      </div>
                      <span
                        title={t(`workshop.partsEpc.confidenceHint.${i.confidence}`)}
                        className={`inline-flex items-center gap-1 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${conf.cls}`}
                      >
                        <ConfIcon size={12} />
                        {t(`workshop.partsEpc.confidence.${i.confidence}`)}
                      </span>
                    </div>

                    {(i.specs.length > 0 || mainOem) && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 space-y-1.5">
                        {i.specs.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 text-sm">
                            <span className="text-xs text-gray-500 w-14 shrink-0">{t('workshop.partsEpc.use')}</span>
                            <span className="font-mono font-semibold text-slate-900">{i.specs[0].value}</span>
                            {i.specs.slice(1, 3).map((s) => (
                              <span key={s.value} className="font-mono text-xs text-gray-500">/ {s.value}</span>
                            ))}
                          </div>
                        )}
                        {mainOem && (
                          <div className="flex flex-wrap items-center gap-1.5 text-sm">
                            <span className="text-xs text-gray-500 w-14 shrink-0">{t('workshop.partsEpc.oem')}</span>
                            <Link
                              href={`/workshop/parts/oem/${encodeURIComponent(mainOem.number)}`}
                              className="font-mono font-semibold text-blue-800 hover:underline"
                            >
                              {mainOem.number}
                            </Link>
                            <button type="button" onClick={() => copy(mainOem.number)} title={t('workshop.partsEpc.copy')}>
                              {copied === mainOem.number ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} className="text-gray-400" />}
                            </button>
                            {mainOem.genuine && (
                              <span className="rounded bg-emerald-100 px-1.5 text-[11px] font-medium text-emerald-700">
                                {t('workshop.partsEpc.genuine')}
                              </span>
                            )}
                            {i.oems.slice(1, 3).map((o) => (
                              <Link
                                key={o.normalized}
                                href={`/workshop/parts/oem/${encodeURIComponent(o.number)}`}
                                className="font-mono text-xs text-gray-500 hover:text-blue-700"
                              >
                                {o.number}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {i.workshop && (i.workshop.spec || i.workshop.oem) && (() => {
                      const w = (i.workshop.spec ?? i.workshop.oem)!;
                      const tone =
                        i.workshop.agreement === 'agrees'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : i.workshop.agreement === 'differs'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-blue-200 bg-blue-50 text-blue-800';
                      return (
                        <div className={`rounded-lg border px-3 py-1.5 text-xs ${tone}`} title={t('workshop.partsEpc.workshopHint')}>
                          {t(`workshop.partsEpc.workshop.${i.workshop.agreement ?? 'listed'}`, {
                            value: w.value,
                            count: w.workshops,
                          })}
                        </div>
                      );
                    })()}

                    {i.brands.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-gray-500">{t('workshop.partsEpc.alternatives')}</span>
                        {i.brands.slice(0, 6).map((b) => (
                          <span key={b.value} className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700">
                            {b.value}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-auto flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
                      {stock.length ? (
                        <Link
                          href={`/inventory/stock/${stock[0].productId}`}
                          title={stock.map((p) => `${p.name} (${p.oem})${p.equivalentVia ? ` — ${p.equivalentVia}` : ''}`).join('\n')}
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                            qty > 0 ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-red-50 text-red-600 border-red-200'
                          }`}
                        >
                          {exact.length ? '' : '≈ '}
                          {qty > 0
                            ? t('workshop.partsEpc.inStock', { qty: qty.toLocaleString(locale) })
                            : t('workshop.partsEpc.outOfStock')}
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">{t('workshop.partsEpc.notStocked')}</span>
                      )}
                      <Link
                        href={`/workshop/parts/search?${new URLSearchParams({
                          brand: shown.vehicle.brand,
                          model: shown.vehicle.model,
                          ...(shown.vehicle.year ? { year: String(shown.vehicle.year) } : {}),
                          itemType: i.itemType,
                          item: i.item,
                          minSellers: '1',
                        }).toString()}`}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        {t('workshop.partsEpc.allListings', { count: i.sellers })}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
            {items.length === 0 && <div className="p-8 text-center text-sm text-gray-500">{t('workshop.partsEpc.noMatch')}</div>}
          </>
        ) : null}
      </div>
    </main>
  );
}
