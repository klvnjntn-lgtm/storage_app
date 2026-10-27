// Shared bits for the parts catalogue pages: the "search elsewhere" links and the fitment badge.
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

// How we know a number fits the car: the car maker lists it, a maker of the same group (Toyota/Daihatsu)
// uses it, or only sellers say it fits. Parts often fit other cars, so seller claims stay, labelled.
const FITMENT_STYLE: Record<string, string> = {
  maker: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  group: 'bg-sky-50 text-sky-700 border-sky-200',
  seller: 'bg-gray-50 text-gray-500 border-gray-200',
};

export function FitmentBadge({ fitment }: { fitment?: string }) {
  const { t } = useLanguage();
  if (!fitment || !FITMENT_STYLE[fitment]) return null;
  const key = fitment === 'maker' ? 'Maker' : fitment === 'group' ? 'Group' : 'Seller';
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-1.5 text-[11px] font-medium ${FITMENT_STYLE[fitment]}`}
      title={t(`workshop.partsCatalog.fitment${key}Hint`)}
    >
      {fitment === 'maker' && '✓ '}
      {t(`workshop.partsCatalog.fitment${key}`)}
    </span>
  );
}
