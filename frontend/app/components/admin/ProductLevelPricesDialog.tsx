'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { readErrorMessage } from '@/lib/api-error';
import { formatIDR } from '@/lib/format';
import { usePriceLevels } from '@/lib/price-levels';
import { useLanguage } from '@/app/context/LanguageContext';

type Props = {
  product: {
    id: string;
    name: string;
    sellingPrice: number | null;
    prices?: { priceLevelId: string; price: number }[];
  };
  onClose: () => void;
  onSaved: () => void;
};

// One product's price for each non-default price level. Blank = no price
// for that level (sales lines at it fall back to the default price, with a
// visible note). The default level's price is the product's selling price,
// edited in the products table itself.
export default function ProductLevelPricesDialog({ product, onClose, onSaved }: Props) {
  const { t } = useLanguage();
  const { levels, defaultLevelId, nameOf } = usePriceLevels();
  const others = levels.filter((l) => l.id !== defaultLevelId);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((product.prices ?? []).map((p) => [p.priceLevelId, String(p.price)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    const prices: { priceLevelId: string; price: number | null }[] = [];
    for (const level of others) {
      const raw = (values[level.id] ?? '').trim();
      if (raw === '') {
        prices.push({ priceLevelId: level.id, price: null });
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setError(t('admin.products.levelPrices.invalid', { level: level.name }));
        return;
      }
      prices.push({ priceLevelId: level.id, price: n });
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="level-prices-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-[420px] max-h-[85dvh] overflow-y-auto bg-white rounded-t-xl sm:rounded-xl border border-blue-500/15 shadow-xl p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 id="level-prices-title" className="font-bold text-[15px]">
            {t('admin.products.levelPrices.title')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 -m-1.5 rounded-md text-gray-500 hover:text-blue-700"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-4 break-words">{product.name}</p>

        <div className="flex items-center justify-between gap-3 rounded-lg bg-blue-50/60 border border-blue-500/15 px-3 py-2 mb-3">
          <span className="text-sm font-medium text-gray-900">{nameOf(defaultLevelId)}</span>
          <span className="text-sm text-gray-700">
            {product.sellingPrice != null ? formatIDR(product.sellingPrice) : t('admin.products.noPrice')}
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-4">{t('admin.products.levelPrices.defaultHint')}</p>

        {others.length === 0 ? (
          <p className="text-sm text-gray-500">{t('admin.products.levelPrices.noLevels')}</p>
        ) : (
          <div className="space-y-3">
            {others.map((level) => (
              <label key={level.id} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-800">{level.name}</span>
                <span className="relative w-40">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">Rp</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={values[level.id] ?? ''}
                    placeholder={t('admin.products.levelPrices.blank')}
                    onChange={(e) => setValues((v) => ({ ...v, [level.id]: e.target.value }))}
                    className="w-full border-2 border-gray-300 rounded-md py-1.5 pl-8 pr-2 text-sm outline-none focus:border-blue-500"
                  />
                </span>
              </label>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 mt-3">
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-md border border-blue-500/15 text-sm font-medium text-gray-600 hover:bg-blue-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || others.length === 0}
            onClick={save}
            className="flex-1 py-2.5 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
