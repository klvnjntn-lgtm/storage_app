'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Upload, Search, ImageOff, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import Pagination from './Pagination';

export type MediaAsset = {
  id: string;
  url: string;
  originalName: string | null;
  mimeType: string;
  createdAt: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: MediaAsset) => void;
};

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

const MIME_FILTERS: { value: string; label: string | null }[] = [
  { value: '', label: null },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/webp', label: 'WebP' },
];

export default function MediaLibraryModal({ open, onClose, onSelect }: Props) {
  const { t } = useLanguage();
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

  useEffect(() => {
    if (!open) return;
    setPage(1);
  }, [open, search, mimeType]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
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
  }, [open, page, pageSize, search, mimeType]);

  if (!open) return null;

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
      const asset = await res.json();
      onSelect(asset);
      onClose();
    } catch {
      setError(t('shared.mediaLibrary.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/25 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-xl sm:rounded-xl border border-blue-500/15 w-full sm:w-[640px] max-w-full sm:max-w-[640px] max-h-[85vh] flex flex-col shadow-xl shadow-blue-900/5 pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/10 shrink-0">
          <span className="text-[15px] font-semibold">{t('shared.mediaLibrary.title')}</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-blue-700 transition-colors p-1 -m-1"
            aria-label={t('appShell.close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-b border-blue-500/10 shrink-0 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('shared.mediaLibrary.searchPlaceholder')}
              className="w-full pl-8 pr-3 py-2 text-sm border-2 border-gray-200 rounded-md outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={mimeType}
            onChange={(e) => setMimeType(e.target.value)}
            className="text-sm border-2 border-gray-200 rounded-md py-2 px-2 outline-none focus:border-blue-500"
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
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
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

        {error && <p className="text-xs text-red-600 px-5 pt-2">{error}</p>}

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
              <ImageOff size={28} strokeWidth={1.75} />
              <span className="text-sm">{t('shared.mediaLibrary.noResults')}</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => {
                    onSelect(asset);
                    onClose();
                  }}
                  className="group aspect-square rounded-md border-2 border-gray-200 hover:border-blue-500 overflow-hidden bg-gray-50 transition-colors"
                  title={asset.originalName ?? undefined}
                >
                  {brokenIds[asset.id] ? (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <ImageOff size={20} strokeWidth={1.75} />
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.url}
                      alt={asset.originalName ?? ''}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      onError={() => setBrokenIds((prev) => ({ ...prev, [asset.id]: true }))}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-blue-500/10 shrink-0">
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
      </div>
    </div>
  );
}
