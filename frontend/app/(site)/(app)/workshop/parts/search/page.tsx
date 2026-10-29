// app/(app)/workshop/parts/search/page.tsx — "Advanced search": the flat, filterable table of every row
'use client';

import { YearSelect, type CatalogGeneration } from '@/app/components/workshop/YearSelect';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Wrench, Search, Copy, Check, X, ExternalLink } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import Pagination from '@/app/components/shared/Pagination';
import { useLanguage } from '@/app/context/LanguageContext';
import { FitmentBadge, PartSearchLinks } from '../PartMedia';


type Facets = {
  brands: { brand: string; models: string[] }[];
  itemTypes: { itemType: string; items: string[] }[];
  generations?: CatalogGeneration[];
  totalEntries: number;
  lastUpdated: string | null;
};

type Origin = 'Official' | 'Aftermarket' | 'Unknown';

type PartRow = {
  id: number;
  carBrand: string;
  model: string;
  generation: string;
  yearFrom: number | null;
  yearTo: number | null;
  itemType: string;
  item: string;
  oemNumber: string;
  origin: Origin;
  partBrand: string;
  spec: string;
  sellers: number;
  exampleUrl: string;
  fitment: string;
  // equivalentVia: set when the product is stocked under an interchangeable OEM number, e.g.
  // "Sakura C-1109 (Oil Filter)" — fits the same way, but isn't necessarily the identical part.
  inStock: { productId: string; name: string; quantity: number; oem: string; equivalentVia: string | null }[];
  // Kode rangka / kode mesin of the row's generation (older backends don't send it).
  codes?: { chassis: string[]; engine: string[] };
};

// How the backend read the search box (null when it matched it as plain text).
type Interpretation = {
  vehicles: { carBrand: string; model?: string; generations?: string[] }[];
  year?: number;
  items: { itemType: string; item: string }[];
  oems: string[];
  partBrands: string[];
  codes: { kind: 'chassis' | 'engine'; typed: string; code: string }[];
  specs?: string[]; // H4, NS60, 10W-40 (older backends don't send it)
  corrections: { typed: string; as: string }[];
  ignored: string[];
};

type PartPage = {
  items: PartRow[];
  interpretation?: Interpretation | null;
  // When nothing matched: rows the year / shop-count filter hid.
  relax?: { otherYears: number | null; fewerSellers: number | null };
  specSummary: { spec: string; sellers: number }[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const DEBOUNCE_MS = 350;
const PAGE_SIZE_DEFAULT = 25;
// A fitment is shown once this many different shops agree (the API applies the same default).
const MIN_SELLERS_DEFAULT = '2';

const ORIGIN_STYLE: Record<Origin, string> = {
  Official: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Aftermarket: 'bg-amber-50 text-amber-700 border-amber-200',
  Unknown: 'bg-gray-50 text-gray-500 border-gray-200',
};

// FIX — useSearchParams() requires a Suspense boundary for static
// prerendering, or `next build` fails outright. See login/page.tsx.
export default function PartsCatalogPage() {
  return (
    <Suspense fallback={null}>
      <PartsCatalogPageInner />
    </Suspense>
  );
}

function PartsCatalogPageInner() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const locale = language === 'id' ? 'id-ID' : 'en-US';

  const [facets, setFacets] = useState<Facets | null>(null);

  // Every filter is seeded from the URL so Back from a product page restores the same search.
  const [query, setQuery] = useState<string>(() => getInitialParam('q', ''));
  const [brand, setBrand] = useState<string>(() => getInitialParam('brand', ''));
  const [model, setModel] = useState<string>(() => getInitialParam('model', ''));
  const [year, setYear] = useState<string>(() => getInitialParam('year', ''));
  const [itemType, setItemType] = useState<string>(() => getInitialParam('itemType', ''));
  const [item, setItem] = useState<string>(() => getInitialParam('item', ''));
  const [origin, setOrigin] = useState<string>(() => getInitialParam('origin', ''));
  const [spec, setSpec] = useState<string>(() => getInitialParam('spec', ''));
  const [minSellers, setMinSellers] = useState<string>(() => getInitialParam('minSellers', MIN_SELLERS_DEFAULT));
  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', PAGE_SIZE_DEFAULT));

  const [data, setData] = useState<PartPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useSyncQueryParams({
    q: query.trim(),
    brand: brand || null,
    model: model || null,
    year: year || null,
    itemType: itemType || null,
    item: item || null,
    origin: origin || null,
    spec: spec || null,
    minSellers: minSellers !== MIN_SELLERS_DEFAULT ? minSellers : null,
    page: page !== 1 ? page : null,
    pageSize: pageSize !== PAGE_SIZE_DEFAULT ? pageSize : null,
  });

  useEffect(() => {
    apiFetch('/part-catalog/facets')
      .then((res) => (res.ok ? res.json() : null))
      .then((f: Facets | null) => f && setFacets(f))
      .catch(() => {});
  }, []);

  const models = useMemo(
    () => facets?.brands.find((b) => b.brand === brand)?.models ?? [],
    [facets, brand],
  );
  const items = useMemo(
    () => facets?.itemTypes.find((i) => i.itemType === itemType)?.items ?? [],
    [facets, itemType],
  );

  // Back to page 1 whenever the result set changes — skipped on mount so a
  // page restored from the URL isn't clobbered before the first load.
  const isFirstResetRef = useRef(true);
  useEffect(() => {
    if (isFirstResetRef.current) {
      isFirstResetRef.current = false;
      return;
    }
    setPage(1);
  }, [query, brand, model, year, itemType, item, origin, spec, minSellers, pageSize]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (brand) params.set('brand', brand);
    if (model) params.set('model', model);
    if (/^\d{4}$/.test(year)) params.set('year', year);
    if (itemType) params.set('itemType', itemType);
    if (item) params.set('item', item);
    if (origin) params.set('origin', origin);
    if (spec) params.set('spec', spec);
    params.set('minSellers', minSellers);
    params.set('page', String(page));
    params.set('limit', String(pageSize));

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await apiFetch(`/part-catalog?${params.toString()}`);
        if (cancelled) return;
        if (res.ok) {
          setData(await res.json());
        } else {
          const body = await res.json().catch(() => null);
          setError(body?.message ?? t('workshop.partsCatalog.loadFailed', { status: res.status }));
        }
      } catch {
        if (!cancelled) setError(t('workshop.partsCatalog.serverError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, brand, model, year, itemType, item, origin, spec, minSellers, page, pageSize]);

  const hasFilters = !!(
    query || brand || model || year || itemType || item || origin || spec || minSellers !== MIN_SELLERS_DEFAULT
  );

  function clearFilters() {
    setQuery('');
    setBrand('');
    setModel('');
    setYear('');
    setItemType('');
    setItem('');
    setOrigin('');
    setSpec('');
    setMinSellers(MIN_SELLERS_DEFAULT);
  }

  async function copyOem(row: PartRow) {
    try {
      await navigator.clipboard.writeText(row.oemNumber);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId((id) => (id === row.id ? null : id)), 1500);
    } catch {
      // Clipboard can be blocked (http, permissions) — the number is still visible to copy by hand.
    }
  }

  function yearsLabel(r: PartRow): string {
    if (r.yearFrom == null) return '—';
    if (r.yearTo === r.yearFrom) return String(r.yearFrom);
    return `${r.yearFrom}–${r.yearTo ?? t('workshop.partsCatalog.present')}`;
  }

  function originLabel(o: Origin): string {
    if (o === 'Official') return t('workshop.partsCatalog.originOfficial');
    if (o === 'Aftermarket') return t('workshop.partsCatalog.originAftermarket');
    return t('workshop.partsCatalog.originUnknown');
  }

  // "Show other years": clear the year box, or the year typed in the search ("avanza 2006 …").
  function dropYear() {
    if (/^\d{4}$/.test(year)) setYear('');
    else if (data?.interpretation?.year)
      setQuery((q) => q.replace(new RegExp(`\\b${data.interpretation!.year}\\b`), '').replace(/\s+/g, ' ').trim());
  }

  const read = data?.interpretation;
  const readChips: string[] = read
    ? [
        ...read.vehicles.map((v) =>
          [v.carBrand, v.model, v.generations?.length ? `(${v.generations.join(', ')})` : ''].filter(Boolean).join(' '),
        ),
        ...(read.year ? [String(read.year)] : []),
        ...read.codes.map(
          (c) => `${t(c.kind === 'chassis' ? 'workshop.partsCatalog.chassisCode' : 'workshop.partsCatalog.engineCode')} ${c.code}`,
        ),
        ...read.items.map((i) => i.item),
        ...(read.specs ?? []),
        ...read.oems,
        ...read.partBrands,
      ]
    : [];

  const selectClass =
    'min-w-0 rounded-lg border border-blue-500/20 bg-white px-3 py-2 text-sm outline-none transition-colors hover:border-blue-500/35 focus:border-blue-500/50 disabled:bg-gray-50 disabled:text-gray-400';

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Header — sticky, blue-outline + backdrop-blur treatment matching /workshop/vehicles. */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 min-w-0 mb-4">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Wrench size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('workshop.partsCatalog.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('workshop.partsCatalog.subtitle')}</p>
            </div>
            <Link
              href={`/workshop/parts?${new URLSearchParams({ ...(brand ? { brand } : {}), ...(model ? { model } : {}), ...(year ? { year } : {}) }).toString()}`}
              className="ml-auto shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('workshop.partsCatalog.backToCatalog')}
            </Link>
          </div>

          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('workshop.partsCatalog.searchPlaceholder')}
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
          </div>

          {/* How the search was read — so "WHELL HUB" visibly became Hub Bearing, and a nomor mesin its car. */}
          {read && query.trim() && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-gray-500">{t('workshop.partsCatalog.readAs')}</span>
              {readChips.map((c) => (
                <span key={c} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-800">
                  {c}
                </span>
              ))}
              {read.corrections.map((c) => (
                <span key={c.typed} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                  <span className="line-through opacity-60">{c.typed}</span> → {c.as}
                </span>
              ))}
              {read.ignored.length > 0 && (
                <span className="text-gray-400">
                  {t('workshop.partsCatalog.readIgnored')} {read.ignored.join(' ')}
                </span>
              )}
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setModel('');
                setYear('');
              }}
              className={selectClass}
            >
              <option value="">{t('workshop.partsCatalog.allBrands')}</option>
              {facets?.brands.map((b) => (
                <option key={b.brand} value={b.brand}>{b.brand}</option>
              ))}
            </select>
            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setYear('');
              }}
              disabled={!brand}
              className={selectClass}
            >
              <option value="">{t('workshop.partsCatalog.allModels')}</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <YearSelect
              generations={facets?.generations}
              brand={brand}
              model={model}
              value={year}
              onChange={setYear}
              className={selectClass}
            />
            <select
              value={itemType}
              onChange={(e) => {
                setItemType(e.target.value);
                setItem('');
                setSpec('');
              }}
              className={selectClass}
            >
              <option value="">{t('workshop.partsCatalog.allItemTypes')}</option>
              {facets?.itemTypes.map((i) => (
                <option key={i.itemType} value={i.itemType}>{i.itemType}</option>
              ))}
            </select>
            <select
              value={item}
              onChange={(e) => {
                setItem(e.target.value);
                setSpec('');
              }}
              disabled={!itemType}
              className={selectClass}
            >
              <option value="">{t('workshop.partsCatalog.allItems')}</option>
              {items.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
            <select value={origin} onChange={(e) => setOrigin(e.target.value)} className={selectClass}>
              <option value="">{t('workshop.partsCatalog.allOrigins')}</option>
              <option value="Official">{t('workshop.partsCatalog.originOfficial')}</option>
              <option value="Aftermarket">{t('workshop.partsCatalog.originAftermarket')}</option>
              <option value="Unknown">{t('workshop.partsCatalog.originUnknown')}</option>
            </select>
            <select
              value={minSellers}
              onChange={(e) => setMinSellers(e.target.value)}
              title={t('workshop.partsCatalog.confirmedHint')}
              className={selectClass}
            >
              <option value="1">{t('workshop.partsCatalog.confirmedAny')}</option>
              <option value="2">{t('workshop.partsCatalog.confirmed', { count: 2 })}</option>
              <option value="3">{t('workshop.partsCatalog.confirmed', { count: 3 })}</option>
            </select>
            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasFilters}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <X size={14} />
              {t('workshop.partsCatalog.clearFilters')}
            </button>
          </div>

          {/* Most-confirmed specs for the current filters — e.g. Avanza + Headlamp Bulb → H4 first.
              Clicking one filters the table to it; clicking it again clears it. */}
          {/* `?? []` guards: an older backend build returns neither specSummary nor inStock. */}
          {(data?.specSummary ?? []).length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500 mr-1">{t('workshop.partsCatalog.commonSpecs')}</span>
              {(data?.specSummary ?? []).map((sp, i) => (
                <button
                  key={sp.spec}
                  type="button"
                  onClick={() => setSpec((cur) => (cur === sp.spec ? '' : sp.spec))}
                  title={t('workshop.partsCatalog.specSellers', { count: sp.sellers })}
                  className={`rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors ${
                    spec === sp.spec
                      ? 'bg-blue-600 text-white border-blue-600'
                      : i === 0
                        ? 'bg-blue-50 text-blue-800 border-blue-300 font-semibold hover:bg-blue-100'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {sp.spec}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2 text-xs text-gray-500">
          <span>{data ? t('workshop.partsCatalog.results', { count: data.total.toLocaleString(locale) }) : ''}</span>
          {facets?.lastUpdated && (
            <span>
              {t('workshop.partsCatalog.summary', {
                count: facets.totalEntries.toLocaleString(locale),
                date: new Date(facets.lastUpdated).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
              })}
            </span>
          )}
        </div>

        {/* Dense reference table — scrolls horizontally on narrow screens, same trade-off as /workshop/vehicles. */}
        <div className="border-2 border-gray-300 rounded-md overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead className="bg-blue-50/60 border-b-2 border-gray-300">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.partsCatalog.colCar')}</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.partsCatalog.colYears')}</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.partsCatalog.colItem')}</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.partsCatalog.colOem')}</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.partsCatalog.colSpec')}</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.partsCatalog.colOrigin')}</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.partsCatalog.colPartBrand')}</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.partsCatalog.colStock')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r, idx) => {
                  const viaOem = r.generation.endsWith('(via OEM)');
                  const generation = viaOem ? r.generation.replace(/\s*\(via OEM\)$/, '') : r.generation;
                  // Prefer exact OEM matches; fall back to interchangeable ones, shown with "≈".
                  const inStock = r.inStock ?? [];
                  const exact = inStock.filter((p) => !p.equivalentVia);
                  const stock = exact.length ? exact : inStock;
                  const equivalent = !exact.length && inStock.length > 0;
                  const qty = stock.reduce((sum, p) => sum + p.quantity, 0);
                  return (
                    <tr key={r.id} className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium whitespace-nowrap">{r.carBrand} {r.model}</div>
                        {generation && (
                          <div
                            className={`text-xs whitespace-nowrap ${viaOem ? 'text-gray-400 italic' : 'text-gray-500'}`}
                            title={viaOem ? t('workshop.partsCatalog.viaOem') : undefined}
                          >
                            {generation}
                          </div>
                        )}
                        {!!r.codes?.chassis.length && (
                          <div className="text-[11px] text-gray-500 font-mono whitespace-nowrap" title={r.codes.chassis.join(', ')}>
                            {t('workshop.partsCatalog.chassisCode')} {r.codes.chassis.slice(0, 3).join(', ')}
                            {r.codes.chassis.length > 3 ? ` +${r.codes.chassis.length - 3}` : ''}
                          </div>
                        )}
                        {!!r.codes?.engine.length && (
                          <div className="text-[11px] text-gray-500 font-mono whitespace-nowrap" title={r.codes.engine.join(', ')}>
                            {t('workshop.partsCatalog.engineCode')} {r.codes.engine.slice(0, 3).join(', ')}
                            {r.codes.engine.length > 3 ? ` +${r.codes.engine.length - 3}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-gray-600 whitespace-nowrap">{yearsLabel(r)}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="min-w-0">
                        {r.exampleUrl ? (
                          <a
                            href={r.exampleUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t('workshop.partsCatalog.viewListing')}
                            className="inline-flex items-center gap-1 whitespace-nowrap hover:text-blue-700"
                          >
                            {r.item}
                            <ExternalLink size={12} className="opacity-50" />
                          </a>
                        ) : (
                          <div className="whitespace-nowrap">{r.item}</div>
                        )}
                        <div className="text-xs text-gray-500 whitespace-nowrap">{r.itemType}</div>
                        <PartSearchLinks compact query={`${r.item} ${r.carBrand} ${r.model} ${r.oemNumber || r.spec}`} />
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        {r.oemNumber ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Link
                              href={`/workshop/parts/oem/${encodeURIComponent(r.oemNumber)}`}
                              className="font-mono text-[13px] text-blue-800 hover:text-blue-600 hover:underline"
                            >
                              {r.oemNumber}
                            </Link>
                            <button type="button" onClick={() => copyOem(r)} title={t('workshop.partsCatalog.copyOem')}>
                              {copiedId === r.id ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} className="opacity-40" />}
                            </button>
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                        {r.oemNumber && (
                          <div className="mt-1">
                            <FitmentBadge fitment={r.fitment} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        {r.spec ? (
                          <span className="inline-block rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-[13px] text-slate-800">
                            {r.spec}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${ORIGIN_STYLE[r.origin] ?? ORIGIN_STYLE.Unknown}`}>
                          {originLabel(r.origin)}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-gray-600 whitespace-nowrap">{r.partBrand || '—'}</td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        {stock.length === 0 ? (
                          <span className="text-gray-400">{t('workshop.partsCatalog.notStocked')}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => router.push(`/inventory/stock/${stock[0].productId}`)}
                            title={
                              equivalent
                                ? stock
                                    .map((p) => t('workshop.partsCatalog.equivalentHint', { name: p.name, oem: p.oem, via: p.equivalentVia ?? '' }))
                                    .join('\n')
                                : stock.map((p) => p.name).join(', ')
                            }
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                              qty > 0
                                ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                                : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                            }`}
                          >
                            {equivalent && '≈ '}
                            {qty > 0
                              ? t('workshop.partsCatalog.inStock', { qty: qty.toLocaleString(locale) })
                              : t('workshop.partsCatalog.outOfStock')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!loading && data && data.items.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">
              {facets && facets.totalEntries === 0 ? t('workshop.partsCatalog.emptyCatalog') : t('workshop.partsCatalog.empty')}
              {/* Not a dead end: offer the filter that hid everything. */}
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {!!data.relax?.otherYears && (
                  <button
                    type="button"
                    onClick={dropYear}
                    className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100"
                  >
                    {t('workshop.partsCatalog.relaxYears', {
                      year: /^\d{4}$/.test(year) ? year : (data.interpretation?.year ?? ''),
                      count: data.relax.otherYears,
                    })}
                  </button>
                )}
                {!!data.relax?.fewerSellers && (
                  <button
                    type="button"
                    onClick={() => setMinSellers('1')}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {t('workshop.partsCatalog.relaxSellers', { count: data.relax.fewerSellers })}
                  </button>
                )}
              </div>
            </div>
          )}
          {loading && !data && <div className="p-8 text-center text-sm text-gray-500">{t('workshop.partsCatalog.loading')}</div>}
        </div>

        {data && data.total > 0 && (
          <div className="mt-4">
            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={data.total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>
    </main>
  );
}
