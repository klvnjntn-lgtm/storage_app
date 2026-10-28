'use client';

import { useMemo } from 'react';
import { useLanguage } from '@/app/context/LanguageContext';

// Production years per generation, from GET /part-catalog/facets (yearTo = this year while still built).
export type CatalogGeneration = { brand: string; model: string; generation: string; yearFrom: number; yearTo: number };

// The year picker for the parts catalogue: only the years the chosen model was built, newest first, each
// with its generation(s), so the counter picks from what the catalogue knows instead of a typed number
// that may match nothing. '' = any year.
export function YearSelect({
  generations,
  brand,
  model,
  value,
  onChange,
  className,
}: {
  generations: CatalogGeneration[] | undefined;
  brand: string;
  model: string;
  value: string;
  onChange: (year: string) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const years = useMemo(() => {
    const byYear = new Map<number, string[]>();
    for (const g of generations ?? []) {
      if (g.brand !== brand || g.model !== model) continue;
      for (let y = g.yearFrom; y <= g.yearTo && y - g.yearFrom < 60; y++)
        byYear.set(y, [...(byYear.get(y) ?? []), ...(g.generation ? [g.generation] : [])]);
    }
    return [...byYear].sort((a, b) => b[0] - a[0]).map(([year, names]) => ({ year, generations: [...new Set(names)] }));
  }, [generations, brand, model]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={!model}
      aria-label={t('workshop.partsEpc.year')}
      className={className}
    >
      <option value="">{t('workshop.partsEpc.anyYear')}</option>
      {/* A year from a link or an older bookmark stays selectable even if the catalogue has no range. */}
      {value && !years.some((y) => String(y.year) === value) && <option value={value}>{value}</option>}
      {years.map((y) => (
        <option key={y.year} value={String(y.year)}>
          {y.year}
          {y.generations.length ? ` — ${y.generations.join(' / ')}` : ''}
        </option>
      ))}
    </select>
  );
}
