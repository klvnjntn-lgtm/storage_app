'use client';

import { AlertTriangle, Tag } from 'lucide-react';
import { formatIDR } from '@/lib/format';
import { LevelPriced, resolveLinePrice, usePriceLevels } from '@/lib/price-levels';
import { useLanguage } from '@/app/context/LanguageContext';

type Props = {
  product: LevelPriced;
  /** The level picked for this line (null = default level). */
  value: string | null;
  onChange: (levelId: string) => void;
  /** POS pricing: the line's price was typed and matches no level. */
  custom?: boolean;
  disabled?: boolean;
};

// Per-line price level picker: "Wholesale — Rp100.000". The server
// resolves the real price from the level; this only shows the same
// resolution so the salesperson knows why a price is being used.
export default function PriceLevelSelect({ product, value, onChange, custom = false, disabled = false }: Props) {
  const { t } = useLanguage();
  const { levels, defaultLevelId, nameOf } = usePriceLevels();
  if (levels.length === 0) return null;

  const selected = value ?? defaultLevelId;
  const resolved = resolveLinePrice(product, selected, defaultLevelId);
  const defaultName = nameOf(defaultLevelId) ?? '';

  // Restored lines (no live product prices) or a single level: just say
  // where the price came from.
  if (!product.prices || levels.length === 1) {
    if (levels.length === 1 && !custom) return null;
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600">
        <Tag size={11} strokeWidth={2.25} aria-hidden="true" className="text-blue-600/70" />
        {custom ? t('shared.priceLevel.custom') : nameOf(selected)}
      </span>
    );
  }

  return (
    <div data-tour="sales-price-level" className="min-w-0">
      <div className="relative inline-flex max-w-full items-center">
        <Tag size={11} strokeWidth={2.25} aria-hidden="true" className="pointer-events-none absolute left-1.5 text-blue-600/70" />
        <select
          value={selected ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={t('shared.priceLevel.label')}
          className="max-w-full truncate rounded-md border border-blue-500/20 bg-white py-0.5 pl-5 pr-6 text-[11px] font-medium text-gray-700 hover:border-blue-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 disabled:opacity-60 cursor-pointer"
        >
          {levels.map((l) => {
            const r = resolveLinePrice(product, l.id, defaultLevelId);
            const price = r.unitPrice != null ? formatIDR(r.unitPrice) : t('shared.priceLevel.noPriceShort');
            return (
              <option key={l.id} value={l.id}>
                {r.fallback ? `${l.name} — ${t('shared.priceLevel.notSet')} (${price})` : `${l.name} — ${price}`}
              </option>
            );
          })}
        </select>
      </div>
      {custom ? (
        <p className="mt-0.5 text-[11px] font-medium text-violet-700">{t('shared.priceLevel.custom')}</p>
      ) : (
        resolved.fallback && (
          <p className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-700">
            <AlertTriangle size={11} strokeWidth={2.25} aria-hidden="true" className="mt-px shrink-0" />
            {t('shared.priceLevel.fallback', { level: nameOf(selected) ?? '', default: defaultName })}
          </p>
        )
      )}
    </div>
  );
}
