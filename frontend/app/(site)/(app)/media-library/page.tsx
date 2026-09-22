'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Images, Search, Upload, Trash2, Copy, Check, ImageOff, Loader2, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';
import Pagination from '@/app/components/shared/Pagination';
import type { MediaAsset } from '@/app/components/shared/MediaLibraryModal';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — mirrors MediaLibraryModal's limit

const MIME_FILTERS: { value: string; label: string | null }[] = [
  { value: '', label: null },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/webp', label: 'WebP' },
];

export default function MediaLibraryPage() {
  const router = useRouter();
  const { profile, loading: authLoading, error: authError } = useAuth();
  const { t, language } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [search, setSearch] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [brokenIds, setBrokenIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaAsset | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Same reasoning as settings/page.tsx: redirect before firing any
  // org-scoped request so a non-admin never even triggers the list call.
  useEffect(() => {
    if (authLoading) return;
    if (!profile) {
      if (!authError) router.replace('/login');
      return;
    }
    if (profile.role !== 'ADMIN') {
      router.replace('/inventory/stock');
    }
  }, [authLoading, profile, authError, router]);

  useEffect(() => {
    setPage(1);
  }, [search, mimeType]);

  useEffect(() => {
    if (authLoading || profile?.role !== 'ADMIN') return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (search.trim()) params.set('q', search.trim());
        if (mimeType) params.set('mimeType', mimeType);

        const res = await apiFetch(`/media?${params.toString()}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (cancelled) return;
        setAssets(data.items ?? []);
        setTotalItems(data.totalItems ?? 0);
      } catch {
        if (!cancelled) setError(t('shared.mediaLibrary.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, profile, page, pageSize, search, mimeType]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError('');
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError(t('shared.mediaLibrary.imageTypeError'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(t('shared.mediaLibrary.imageSizeError'));
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    setUploading(true);
    try {
      const res = await apiFetch('/media', { method: 'POST', body: formData });
      if (!res.ok) throw new Error();
      const asset: MediaAsset = await res.json();
      setAssets((prev) => [asset, ...prev]);
      setTotalItems((n) => n + 1);
    } catch {
      setError(t('shared.mediaLibrary.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function copyUrl(asset: MediaAsset) {
    const absolute = `${window.location.origin}${asset.url}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopiedId(asset.id);
      setTimeout(() => setCopiedId((id) => (id === asset.id ? null : id)), 1500);
    } catch {
      // clipboard API can be unavailable (insecure context / permissions) — non-critical, ignore
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      const res = await apiFetch(`/media/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setAssets((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      setTotalItems((n) => Math.max(0, n - 1));
      setDeleteTarget(null);
    } catch {
      setError(t('shared.mediaLibrary.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  if (authLoading || profile?.role !== 'ADMIN') {
    return null;
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Images size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{t('shared.mediaLibrary.title')}</h1>
              <p className="text-xs text-gray-500 truncate">{t('shared.mediaLibrary.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">{error}</div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('shared.mediaLibrary.searchPlaceholder')}
              className="w-full pl-8 pr-3 py-2 text-sm border border-blue-500/20 rounded-lg outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
            />
          </div>

          <select
            value={mimeType}
            onChange={(e) => setMimeType(e.target.value)}
            className="text-sm border border-blue-500/20 rounded-lg py-2 px-2 outline-none focus:border-blue-500/50"
          >
            {MIME_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label ?? t('shared.mediaLibrary.allTypes')}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {uploading ? (
              <Loader2 size={15} strokeWidth={2.5} className="animate-spin" />
            ) : (
              <Upload size={15} strokeWidth={2.5} />
            )}
            {uploading ? t('shared.mediaLibrary.uploading') : t('shared.mediaLibrary.upload')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            onChange={handleUpload}
            className="hidden"
          />
        </div>

        {!loading && (
          <p className="text-xs text-gray-400">{t('shared.mediaLibrary.itemCount', { count: totalItems })}</p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-gray-400">
            <ImageOff size={32} strokeWidth={1.75} />
            <span className="text-sm">{t('shared.mediaLibrary.noResults')}</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="group relative rounded-lg border border-blue-500/15 overflow-hidden bg-white shadow-sm"
              >
                <div className="aspect-square bg-gray-50">
                  {brokenIds[asset.id] ? (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <ImageOff size={20} strokeWidth={1.75} />
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.url}
                      alt={asset.originalName ?? ''}
                      className="w-full h-full object-cover"
                      onError={() => setBrokenIds((prev) => ({ ...prev, [asset.id]: true }))}
                    />
                  )}
                </div>

                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <p className="text-[11px] text-white/90 truncate" title={asset.originalName ?? undefined}>
                    {asset.originalName ?? '—'}
                  </p>
                  <p className="text-[10px] text-white/60">
                    {t('shared.mediaLibrary.uploadedOn', {
                      date: new Date(asset.createdAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US'),
                    })}
                  </p>
                </div>

                <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => copyUrl(asset)}
                    title={t('shared.mediaLibrary.copyUrl')}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-white/90 text-gray-600 hover:text-blue-700 shadow-sm"
                  >
                    {copiedId === asset.id ? (
                      <Check size={13} strokeWidth={2.5} className="text-green-600" />
                    ) : (
                      <Copy size={13} strokeWidth={2} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(asset)}
                    title={t('shared.mediaLibrary.delete')}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-white/90 text-gray-600 hover:text-red-600 shadow-sm"
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Pagination
          page={page}
          pageSize={pageSize}
          totalItems={totalItems}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizeOptions={[12, 24, 48, 96]}
        />
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/25 flex items-center justify-center z-[60] p-4"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="bg-white rounded-xl border border-blue-500/15 w-full max-w-sm shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[15px] font-semibold">{t('shared.mediaLibrary.deleteConfirmTitle')}</h2>
              <button
                onClick={() => setDeleteTarget(null)}
                className="text-gray-400 hover:text-blue-700 p-1 -m-1"
                aria-label={t('appShell.close')}
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-3 aspect-video rounded-md overflow-hidden bg-gray-50 border border-blue-500/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={deleteTarget.url} alt="" className="w-full h-full object-contain" />
            </div>

            <p className="text-sm text-gray-600 mt-3">{t('shared.mediaLibrary.deleteConfirmBody')}</p>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-3 py-2 text-sm rounded-md border border-blue-500/20 text-gray-600 hover:bg-blue-50 disabled:opacity-40"
              >
                {t('shared.cancel')}
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-3 py-2 text-sm rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-40 flex items-center gap-1.5"
              >
                {deleting && <Loader2 size={14} className="animate-spin" />}
                {t('shared.mediaLibrary.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
