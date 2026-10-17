// Shared bits for the parts catalogue pages: the cached thumbnail and the "search elsewhere" links.
'use client';

import { useState } from 'react';
import { ImageOff, Search, Image as ImageIcon } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

// Thumbnails are cached by the scraper into the backend's public uploads (part-thumbs/), so they keep
// working after the marketplace listing is gone. No key, or a file that fails to load → placeholder.
export function PartThumb({ thumbKey, size = 64, alt }: { thumbKey?: string | null; size?: number; alt: string }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (!thumbKey || failed) {
    return (
      <span style={box} className="flex shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-300">
        <ImageOff size={Math.round(size * 0.4)} />
      </span>
    );
  }
  return (
    // Plain <img>: a small, already-resized webp from our own /uploads, nothing for next/image to optimise.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/uploads/${thumbKey}`}
      alt={alt}
      style={box}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-md border border-gray-200 bg-white object-contain"
    />
  );
}

// One-click searches built from the part itself, so there's always somewhere to look even when the
// scraped listing has been taken down.
export function PartSearchLinks({ query, compact = false }: { query: string; compact?: boolean }) {
  const { t } = useLanguage();
  const q = encodeURIComponent(query.replace(/\s+/g, ' ').trim());
  const link = 'inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-700';
  return (
    <span className="inline-flex items-center gap-2.5">
      <a href={`https://www.tokopedia.com/search?st=product&q=${q}`} target="_blank" rel="noopener noreferrer" className={link} title={t('workshop.partsEpc.searchTokopedia')}>
        <Search size={12} />
        {!compact && 'Tokopedia'}
      </a>
      <a href={`https://www.google.com/search?tbm=isch&q=${q}`} target="_blank" rel="noopener noreferrer" className={link} title={t('workshop.partsEpc.searchImages')}>
        <ImageIcon size={12} />
        {!compact && 'Google'}
      </a>
    </span>
  );
}
