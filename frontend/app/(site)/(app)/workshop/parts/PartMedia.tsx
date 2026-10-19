// Shared bits for the parts catalogue pages: the "search elsewhere" links.
'use client';

import { Search, Image as ImageIcon } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

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
