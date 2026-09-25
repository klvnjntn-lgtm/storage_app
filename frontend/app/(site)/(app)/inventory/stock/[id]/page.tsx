'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Package, ImageOff, Upload, Trash2, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import Pagination from '@/app/components/shared/Pagination';
import MediaLibraryModal, { MediaAsset } from '@/app/components/shared/MediaLibraryModal';
import { useLanguage } from '@/app/context/LanguageContext';


type StockRow = {
  location: {
    id: string;
    name: string;
  };
  quantity: number;
};

type EventRow = {
  id: number;
  type: string;
  quantity: number;
  createdAt: string;
  userId?: string | null;
  user?: { email: string } | null;

  product: string | null;
  from: string | null;
  to: string | null;
  reason?: string | null;
  sessionId?: string | null;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  category?: { name: string };
  brand?: { name: string };
  // Primary product image. Optional — most fields on this page assume a
  // product may never get one, and the UI treats that as a normal, not an
  // error, state. The data model future-proofs for multiple images per
  // product (a gallery), but only the primary one is used here and in
  // Grid View / POS — see the "Product Image" section below.
  image: string | null;
};

type OrgLocation = { id: string; name: string };

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t, language } = useLanguage();

const eventColor = (type: string) => {
  switch (type) {
    case 'IMPORT_REPLACE':
    case 'IMPORT_INCREMENT':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'RECEIVE':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'MOVE':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'SHIP':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'PICK':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'PACK':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    case 'RETURNS':
      return 'bg-teal-100 text-teal-800 border-teal-300';
    case 'ADJUSTMENT':
      return 'bg-indigo-100 text-indigo-800 border-indigo-300';
    case 'SALE':
      return 'bg-pink-100 text-pink-800 border-pink-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
};
  const [product, setProduct] = useState<Product | null>(null);
  const [locationId, setLocationId] = useState('');
  const [qtyDelta, setQtyDelta] = useState<number>(0);
  const [reason, setReason] = useState('');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const totalStock = stock.reduce((acc, s) => acc + s.quantity, 0);

  // --- Product image ---
  // /products/[id] is the source of truth for image management — this is
  // the only place with the full Change/Remove/Upload flow. Grid View on
  // the stock list has a quick preview/edit action, but it's a shortcut
  // into this same flow, not a second implementation of it.
  //
  // Picking a photo goes through the shared media library modal (also used
  // by AppShell's avatar picker) rather than a direct file input — this is
  // where reuse across products/uploads-as-library actually happens.
  const [showLibrary, setShowLibrary] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  function openImagePicker() {
    setImageError('');
    setShowLibrary(true);
  }

  async function handleAssetSelected(asset: MediaAsset) {
    if (!product) return;
    setImageError('');
    setImageUploading(true);
    try {
      const res = await apiFetch(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ image: asset.url }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || t('inventory.stockDetail.imageUploadFailed'));
      }

      setImageLoadFailed(false);
      setProduct((p) => (p ? { ...p, image: asset.url } : p));
    } catch (err: any) {
      console.error(err);
      setImageError(err.message || t('inventory.stockDetail.imageUploadFailed'));
    } finally {
      setImageUploading(false);
    }
  }

  async function removeImage() {
    if (!product || !product.image) return;
    setImageError('');
    setImageUploading(true);
    try {
      const res = await apiFetch(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ image: null }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || t('inventory.stockDetail.imageRemoveFailed'));
      }

      setProduct((p) => (p ? { ...p, image: null } : p));
    } catch (err: any) {
      console.error(err);
      setImageError(err.message || t('inventory.stockDetail.imageRemoveFailed'));
    } finally {
      setImageUploading(false);
    }
  }

  // --- Event history pagination (client-side — the events endpoint returns
  // the full list in one shot, so we slice it here rather than round-trip
  // to the server for each page). ---
  // Seeded from the URL so pressing the browser's Back button from a
  // session opened out of the event history restores the same page.
  const [eventsPage, setEventsPage] = useState(() => getInitialNumberParam('eventsPage', 1));
  const [eventsPageSize, setEventsPageSize] = useState(() => getInitialNumberParam('eventsPageSize', 10));
  const eventsTotalPages = Math.max(1, Math.ceil(events.length / eventsPageSize));

  useSyncQueryParams({
    eventsPage: eventsPage !== 1 ? eventsPage : null,
    eventsPageSize: eventsPageSize !== 10 ? eventsPageSize : null,
  });

  useEffect(() => {
    if (eventsPage > eventsTotalPages) setEventsPage(eventsTotalPages);
  }, [eventsPage, eventsTotalPages]);

  const paginatedEvents = useMemo(
    () => events.slice((eventsPage - 1) * eventsPageSize, eventsPage * eventsPageSize),
    [events, eventsPage, eventsPageSize],
  );

  // --- Module gating for the location picker ---
  // Orgs without WAREHOUSE_OPS only ever have one location, "CENTRE" — so
  // making them pick it from a dropdown every time is pure friction. We
  // fetch enabled modules + the org's locations, and for non-warehouse
  // orgs, auto-select CENTRE and hide the picker entirely instead of
  // showing a single-option dropdown.
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [orgLocations, setOrgLocations] = useState<OrgLocation[]>([]);
  const hasWarehouseModule = enabledModules.includes('WAREHOUSE_OPS');
  const centreLocation = orgLocations.find((l) => l.name.trim().toUpperCase() === 'CENTRE');

  useEffect(() => {
    async function loadModules() {
      const res = await apiFetch('/organizations/modules');
      if (!res.ok) return;
      setEnabledModules(await res.json());
    }
    loadModules();
  }, []);

  useEffect(() => {
    async function loadLocations() {
      try {
        const res = await apiFetch('/locations');
        if (!res.ok) return;
        setOrgLocations(await res.json());
      } catch (err) {
        console.error(err);
      }
    }
    loadLocations();
  }, []);

  // Once we know the org isn't on the warehouse module and we've found its
  // CENTRE location, lock the adjustment target to it. Guarded so it won't
  // clobber a value if this ever runs again after the field is already set.
  useEffect(() => {
    if (hasWarehouseModule) return;
    if (locationId) return;
    if (centreLocation) setLocationId(centreLocation.id);
  }, [hasWarehouseModule, centreLocation, locationId]);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      try {
        const [productRes, stockRes, eventsRes] = await Promise.all([
          apiFetch(`/products/${id}`),
          apiFetch(`/stock/${id}`),
          apiFetch(`/products/${id}/events`),
        ]);

        setProduct(await productRes.json());
        setStock(await stockRes.json());
        setEvents(await eventsRes.json());
      } catch (err) {
        console.error(err);
      }
    };

    load();
  }, [id]);

  if (!product) {
    return (
      <main
        className="min-h-screen text-black p-8"
        style={{
          backgroundColor: '#f8fafc',
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      >
        {t('inventory.stockDetail.loadingProduct')}
      </main>
    );
  }

  const showImage = product.image && !imageLoadFailed;

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Header — sticky, blue-outline + backdrop-blur treatment matching
          /vehicles/search, /labels, and /inventory/stock */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Package size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  {product.name}
                </h1>
                <p className="text-xs text-gray-500 truncate">
                  SKU: <span className="font-mono">{product.sku}</span> ·{' '}
                  {product.category?.name ?? t('inventory.stockDetail.noCategory')} • {product.brand?.name ?? t('inventory.stockDetail.noBrand')}
                </p>
              </div>
            </div>
          </div>

          <div className="px-3 py-2 rounded-md bg-blue-600/10 border border-blue-600/20 text-sm font-semibold text-blue-800 shrink-0">
            {t('inventory.stockDetail.totalPcs', { total: totalStock })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-8">

        {/* PRODUCT IMAGE */}
        <section className="border-2 border-gray-300 rounded-md p-4 bg-white">
          <h2 className="text-lg font-bold mb-3">{t('inventory.stockDetail.productImage')}</h2>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="w-full sm:w-40 shrink-0">
              {showImage ? (
                <div className="w-full aspect-square rounded-md bg-gray-50 border-2 border-gray-200 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={product.image as string}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    onError={() => setImageLoadFailed(true)}
                  />
                </div>
              ) : (
                <div className="w-full aspect-square rounded-md bg-gray-50 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-1.5 text-gray-400">
                  <ImageOff size={26} strokeWidth={1.75} />
                  <span className="text-[11px] text-center px-2">{t('inventory.stockDetail.noPhotoYet')}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 justify-center">
              <p className="text-xs text-gray-500 max-w-xs">
                {t('inventory.stockDetail.imageHint')}
              </p>

              {imageError && <p className="text-xs text-red-600">{imageError}</p>}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={openImagePicker}
                  disabled={imageUploading}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {imageUploading ? (
                    <Loader2 size={15} strokeWidth={2.5} className="animate-spin" />
                  ) : (
                    <Upload size={15} strokeWidth={2.5} />
                  )}
                  {product.image ? t('inventory.stockDetail.changePhoto') : t('inventory.stockDetail.addPhoto')}
                </button>

                {product.image && (
                  <button
                    type="button"
                    onClick={removeImage}
                    disabled={imageUploading}
                    className="flex items-center gap-1.5 px-3 py-2 text-red-700 border-2 border-red-200 rounded-md text-sm font-semibold hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 size={15} strokeWidth={2.5} />
                    {t('inventory.stockDetail.removePhoto')}
                  </button>
                )}
              </div>

              <MediaLibraryModal
                open={showLibrary}
                onClose={() => setShowLibrary(false)}
                onSelect={handleAssetSelected}
              />
            </div>
          </div>
        </section>

        {/* ADJUST STOCK */}
        <section className="border-2 border-gray-300 rounded-md p-4 space-y-3 bg-white">
          <h2 className="text-lg font-bold">{t('inventory.stockDetail.adjustStock')}</h2>

          <div className="flex flex-wrap gap-3 items-end">
            {/* Location picker only shown for warehouse orgs. Non-warehouse
                orgs are silently locked to CENTRE via the effect above — no
                picker needed since there's nothing to choose between. */}
            {hasWarehouseModule ? (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">{t('inventory.stockDetail.location')}</label>
                <select
                  className="border-2 border-gray-300 rounded-md p-2 w-44 outline-none focus:border-blue-500"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">{t('inventory.stockDetail.selectLocation')}</option>
                  {stock.map((s, i) => (
                    <option key={i} value={s.location.id}>
                      {s.location.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-600">{t('inventory.stockDetail.location')}</span>
                <span className="border-2 border-gray-200 bg-gray-50 rounded-md p-2 w-44 text-gray-700 text-sm">
                  {centreLocation?.name ?? 'CENTRE'}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">{t('inventory.stockDetail.qtyInOut')}</label>
              <input
                type="number"
                className="border-2 border-gray-300 rounded-md p-2 w-28 outline-none focus:border-blue-500"
                value={qtyDelta}
                onChange={(e) => setQtyDelta(Number(e.target.value))}
              />
            </div>

            <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-gray-600">{t('inventory.stockDetail.reason')}</label>
              <input
                type="text"
                placeholder={t('inventory.stockDetail.reasonPlaceholder')}
                className="border-2 border-gray-300 rounded-md p-2 w-full outline-none focus:border-blue-500"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <button
              className="bg-blue-600 text-white font-semibold px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              disabled={!locationId || !reason.trim() || qtyDelta === 0 || Number.isNaN(qtyDelta)}
              onClick={async () => {
                if (!locationId || !reason.trim() || qtyDelta === 0 || Number.isNaN(qtyDelta)) return;

                const res = await apiFetch('/stock/adjust', {
                  method: 'POST',
                  body: JSON.stringify({
                    productId: product.id,
                    locationId,
                    qtyDelta: Number(qtyDelta),
                    reason: reason.trim(),
                  }),
                });

                const data = await res.json().catch(() => null);

                console.log('STATUS:', res.status);
                console.log('RESPONSE:', data);

                if (!res.ok) {
                  alert(data?.message || t('inventory.stockDetail.adjustFailed'));
                  return;
                }

                setQtyDelta(0);
                setReason('');
                // Note: locationId is intentionally NOT cleared here — for
                // warehouse orgs it used to reset to force a re-pick each
                // time; now that non-warehouse orgs depend on it staying
                // put, we leave it as-is for both cases and let the admin
                // change it manually if they want a different location next.

                const eventsRes = await apiFetch(`/products/${product.id}/events`);
                const eventsData = await eventsRes.json();
                setEvents(eventsData);
                setEventsPage(1);
              }}
            >
              {t('inventory.stockDetail.apply')}
            </button>
          </div>
        </section>

        {/* STOCK BY LOCATION */}
        <section>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            {t('inventory.stockDetail.stockByLocation')}
            <span className="text-xs px-2 py-1 rounded-md bg-blue-600/10 text-blue-800 border border-blue-600/20 font-normal">
              {t('inventory.stockDetail.totalPcs', { total: totalStock })}
            </span>
          </h2>

          <div className="border-2 border-gray-300 rounded-md overflow-hidden bg-white">
            <table className="w-full text-base">
              <thead className="bg-blue-50/60 border-b-2 border-gray-300 text-left">
                <tr>
                  <th className="p-3 font-semibold">{t('inventory.stockDetail.colLocation')}</th>
                  <th className="p-3 font-semibold">{t('inventory.stockDetail.colQty')}</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s, idx) => (
                  <tr
                    key={s.location.id}
                    className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                  >
                    <td className="p-3">{s.location.name}</td>
                    <td className="p-3 font-bold">{s.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* EVENT HISTORY */}
        <section>
          <h2 className="text-lg font-bold mb-3">{t('inventory.stockDetail.eventHistory')}</h2>

          <div className="border-2 border-gray-300 rounded-md overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-blue-50/60 border-b-2 border-gray-300 text-left">
                <tr>
                  <th className="p-3 font-semibold">{t('inventory.stockDetail.colType')}</th>
                  <th className="p-3 font-semibold">{t('inventory.stockDetail.colQty')}</th>
                  <th className="p-3 font-semibold">{t('inventory.stockDetail.colReason')}</th>
                  <th className="p-3 font-semibold">{t('inventory.stockDetail.colUser')}</th>
                  <th className="p-3 font-semibold">{t('inventory.stockDetail.colDate')}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEvents.map((e, idx) => (
                  <tr
                    key={e.id}
                    className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded-md text-xs font-semibold border ${eventColor(e.type)}`}>
                          {e.type}
                        </span>
                        {e.sessionId && (
                          <button
                            onClick={() => router.push(`/sessions/${e.sessionId}`)}
                            className="text-[10px] px-2 py-1 rounded-md border-2 border-gray-300 hover:bg-blue-50 font-semibold"
                          >
                            {t('inventory.stockDetail.viewSession')}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-semibold">{e.quantity}</td>
                    <td className="p-3 text-gray-700">{e.reason ?? '-'}</td>
                    <td className="p-3 text-gray-700">{e.user?.email ?? '—'}</td>
                    <td className="p-3 text-gray-500 text-xs">
                      {new Date(e.createdAt).toLocaleString(language === 'id' ? 'id-ID' : 'en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {events.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">{t('inventory.stockDetail.noEvents')}</div>
            )}
          </div>

          {/* Pagination */}
          {events.length > 0 && (
            <div className="mt-3">
              <Pagination
                page={eventsPage}
                pageSize={eventsPageSize}
                totalItems={events.length}
                onPageChange={setEventsPage}
                onPageSizeChange={(size) => {
                  setEventsPageSize(size);
                  setEventsPage(1);
                }}
              />
            </div>
          )}
        </section>

      </div>

    </main>
  );
}