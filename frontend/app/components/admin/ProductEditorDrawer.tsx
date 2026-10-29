'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Boxes, Hash, Tag, Wallet, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { errorMessage } from '@/lib/api-error';
import { formatIDR } from '@/lib/format';
import { defaultLocation } from '@/lib/locations';
import { usePriceLevels } from '@/lib/price-levels';
import { useLanguage } from '@/app/context/LanguageContext';
import ComboBox from '@/app/components/shared/ComboBox';

export type EditableProduct = {
  id: string;
  sku: string | null;
  oem?: string | null;
  name: string;
  category?: string | null;
  brand?: string | null;
  sellingPrice: number | null;
  costPrice: number | null;
  prices?: { priceLevelId: string; price: number }[];
};

type Option = { id: string; name: string };

type Props = {
  // null = creating a new product.
  product: EditableProduct | null;
  stock?: { totalStock: number; locations: { location: string; qty: number }[] };
  categories: Option[];
  brands: Option[];
  locations: Option[];
  warehouseOps: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
};

type FieldErrors = {
  name?: string;
  sku?: string;
  category?: string;
  costPrice?: string;
  // Keyed by price level id; '' is the default level (sellingPrice).
  levels?: Record<string, string>;
};

const DEFAULT_ADJUST_REASON = 'ADMIN ADJUSTMENT';

const inputBase =
  'w-full border-2 rounded-md px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 bg-white';
const inputOk = 'border-gray-300 focus:border-blue-500';
const inputBad = 'border-red-400 focus:border-red-500 bg-red-50/40';

function fieldClass(err?: string) {
  return `${inputBase} ${err ? inputBad : inputOk}`;
}

// Empty -> undefined (leave unset), invalid -> null (error).
function parsePrice(raw: string): number | undefined | null {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-blue-700/80 uppercase tracking-wide">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
      {error ? <p className="text-xs text-red-600 mt-1">{error}</p> : hint}
    </div>
  );
}

function MoneyInput({
  value,
  onChange,
  placeholder,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">Rp</span>
      <input
        type="number"
        min="0"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${fieldClass(error)} pl-8 text-right tabular-nums`}
      />
    </div>
  );
}

// Create/edit a product in one place: catalog fields, its price at every
// price level (the default level is product.sellingPrice, the rest go in
// prices[] — blank = sell at the default price), and, when editing, an
// optional stock adjustment through /stock/adjust like the Stock page.
export default function ProductEditorDrawer({
  product,
  stock,
  categories,
  brands,
  locations,
  warehouseOps,
  onClose,
  onSaved,
}: Props) {
  const { t } = useLanguage();
  const { levels, defaultLevelId } = usePriceLevels();
  const isNew = product == null;

  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [oem, setOem] = useState(product?.oem ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [costPrice, setCostPrice] = useState(product?.costPrice != null ? String(product.costPrice) : '');
  const [sellingPrice, setSellingPrice] = useState(product?.sellingPrice != null ? String(product.sellingPrice) : '');
  const [levelPrices, setLevelPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries((product?.prices ?? []).map((p) => [p.priceLevelId, String(p.price)])),
  );

  const [pickedLocationId, setPickedLocationId] = useState('');
  const stockLocationId = warehouseOps ? pickedLocationId : (defaultLocation(locations)?.id ?? '');
  const [stockDelta, setStockDelta] = useState('');
  const [stockReason, setStockReason] = useState(DEFAULT_ADJUST_REASON);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [skuTaken, setSkuTaken] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Default level first, then the others in their configured order. With
  // no levels set up at all there's still the one selling price.
  const defaultLevel = levels.find((l) => l.id === defaultLevelId) ?? null;
  const otherLevels = levels.filter((l) => l.id !== defaultLevelId);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Live duplicate-SKU hint; the server stays the source of truth on save.
  useEffect(() => {
    const trimmed = sku.trim();
    const timer = setTimeout(async () => {
      if (!trimmed) return setSkuTaken(false);
      const params = new URLSearchParams({ sku: trimmed, ...(product?.id && { excludeId: product.id }) });
      const res = await apiFetch(`/products/sku-taken?${params}`).catch(() => null);
      if (res?.ok) setSkuTaken((await res.json()).taken);
    }, 300);
    return () => clearTimeout(timer);
  }, [sku, product?.id]);

  const cost = parsePrice(costPrice);
  const defaultPrice = parsePrice(sellingPrice);

  // Margin for one level's effective price (own, else the default's).
  function marginFor(raw: string, fallsBack: boolean) {
    const price = fallsBack ? defaultPrice : parsePrice(raw);
    if (typeof price !== 'number' || typeof cost !== 'number' || price <= 0) return null;
    const profit = price - cost;
    return { profit, pct: (profit / price) * 100 };
  }

  const totalStock = stock?.totalStock ?? 0;
  const stockLocations = useMemo(() => (stock?.locations ?? []).filter((l) => l.qty !== 0), [stock]);

  function clearError(key: keyof FieldErrors) {
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): FieldErrors | null {
    const errs: FieldErrors = {};
    if (!name.trim()) errs.name = t('common.required');
    if (!sku.trim()) errs.sku = t('common.required');
    if (!category.trim()) errs.category = t('common.required');
    if (cost === null) errs.costPrice = t('admin.products.mustBeNonNegativeNumber');
    const levelErrs: Record<string, string> = {};
    if (defaultPrice === null) levelErrs[''] = t('admin.products.mustBeNonNegativeNumber');
    for (const level of otherLevels) {
      if (parsePrice(levelPrices[level.id] ?? '') === null) levelErrs[level.id] = t('admin.products.mustBeNonNegativeNumber');
    }
    if (Object.keys(levelErrs).length) errs.levels = levelErrs;
    return Object.keys(errs).length ? errs : null;
  }

  async function save() {
    setFormError('');
    const errs = validate();
    setErrors(errs ?? {});
    if (errs) return;

    const trimmedDelta = stockDelta.trim();
    const deltaNum = trimmedDelta ? Number(trimmedDelta) : 0;
    const wantsStockAdjust = !isNew && trimmedDelta !== '' && deltaNum !== 0;
    if (trimmedDelta && Number.isNaN(deltaNum)) return setFormError(t('admin.products.stockAdjustMustBeNumber'));
    if (wantsStockAdjust && !stockLocationId) return setFormError(t('admin.products.pickLocationForAdjust'));
    if (wantsStockAdjust && !stockReason.trim()) return setFormError(t('admin.products.reasonRequiredForAdjust'));

    // Every non-default level is sent so clearing one removes its price.
    const prices = otherLevels.map((level) => ({
      priceLevelId: level.id,
      price: (parsePrice(levelPrices[level.id] ?? '') as number | undefined) ?? null,
    }));
    // Creating: blank levels have nothing to clear.
    const pricesToSend = isNew ? prices.filter((p) => p.price != null) : prices;

    setSaving(true);
    try {
      const res = await apiFetch(isNew ? '/products' : `/products/${product.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim(),
          oem: oem.trim() || undefined,
          category: category.trim(),
          brand: brand.trim() || undefined,
          sellingPrice: defaultPrice ?? undefined,
          costPrice: cost ?? undefined,
          ...(pricesToSend.length > 0 && { prices: pricesToSend }),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || t(isNew ? 'admin.products.createFailed' : 'admin.products.updateFailed'));
      }

      // Same endpoint as the Stock page, so it shows on the product's
      // Event History — tagged "ADMIN ADJUSTMENT" unless changed.
      if (wantsStockAdjust) {
        const stockRes = await apiFetch('/stock/adjust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: product.id,
            locationId: stockLocationId,
            qtyDelta: deltaNum,
            reason: stockReason.trim(),
          }),
        });
        if (!stockRes.ok) {
          const data = await stockRes.json().catch(() => null);
          throw new Error(data?.message || t('admin.products.stockAdjustFailed'));
        }
      }

      onSaved(
        t(isNew ? 'admin.products.createdSuccess' : 'admin.products.updatedSuccess', { name: name.trim() }),
      );
    } catch (err) {
      console.error(err);
      setFormError(errorMessage(err) || t(isNew ? 'admin.products.createFailed' : 'admin.products.updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }

  const levelRows = [
    { id: '', name: defaultLevel?.name ?? t('admin.products.sellingPriceColumn'), isDefault: true },
    ...otherLevels.map((l) => ({ id: l.id, name: l.name, isDefault: false })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-editor-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex flex-col w-full sm:w-[560px] h-full bg-white shadow-2xl border-l border-blue-500/15"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-blue-500/15 bg-blue-50/60">
          <div className="min-w-0">
            <h2 id="product-editor-title" className="font-bold text-base truncate">
              {isNew ? t('admin.products.newProduct') : t('admin.products.editProductTitle')}
            </h2>
            {!isNew && (
              <p className="text-xs text-gray-500 truncate">
                {product.name}
                {product.sku && <span className="font-mono"> · {product.sku}</span>}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 -m-1.5 rounded-md text-gray-500 hover:text-blue-700"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">
          <Section icon={<Tag size={12} strokeWidth={2.5} />} title={t('admin.products.identity')}>
            <Field label={`${t('common.name')} *`} error={errors.name}>
              <input
                ref={firstFieldRef}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError('name');
                }}
                placeholder={t('admin.products.namePlaceholder')}
                className={fieldClass(errors.name)}
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field
                label="SKU *"
                error={errors.sku}
                hint={
                  skuTaken && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <AlertTriangle size={11} strokeWidth={2.5} />
                      {t('admin.products.skuExists')}
                    </p>
                  )
                }
              >
                <input
                  value={sku}
                  onChange={(e) => {
                    setSku(e.target.value);
                    clearError('sku');
                  }}
                  className={`${fieldClass(errors.sku)} font-mono`}
                />
              </Field>
              <Field label={t('admin.products.oemNumberLabel')}>
                <input
                  value={oem}
                  onChange={(e) => setOem(e.target.value)}
                  placeholder={t('common.optional')}
                  className={`${fieldClass()} font-mono`}
                />
              </Field>
            </div>
          </Section>

          <Section icon={<Hash size={12} strokeWidth={2.5} />} title={t('admin.products.catalog')}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={`${t('admin.products.categoryColumn')} *`} error={errors.category}>
                <ComboBox
                  noMatchesLabel={t('admin.products.noMatches')}
                  createOptionLabel={(v) => t('admin.products.createOption', { value: v })}
                  value={category}
                  onChange={(v) => {
                    setCategory(v);
                    clearError('category');
                  }}
                  options={categories}
                  placeholder={t('admin.products.categoryHint')}
                  className={fieldClass(errors.category)}
                />
              </Field>
              <Field label={t('admin.products.brandColumn')}>
                <ComboBox
                  noMatchesLabel={t('admin.products.noMatches')}
                  createOptionLabel={(v) => t('admin.products.createOption', { value: v })}
                  value={brand}
                  onChange={setBrand}
                  options={brands}
                  placeholder={t('admin.products.brandHint')}
                  className={fieldClass()}
                />
              </Field>
            </div>
          </Section>

          <Section icon={<Wallet size={12} strokeWidth={2.5} />} title={t('admin.products.pricing')}>
            <div className="sm:w-1/2 sm:pr-1.5">
              <Field label={t('admin.products.costPriceLabel')} error={errors.costPrice}>
                <MoneyInput
                  value={costPrice}
                  onChange={(v) => {
                    setCostPrice(v);
                    clearError('costPrice');
                  }}
                  placeholder="0"
                  error={errors.costPrice}
                />
              </Field>
            </div>

            <div className="rounded-lg border border-blue-500/15 overflow-hidden">
              <div className="grid grid-cols-[1fr_10rem_6rem] gap-3 px-3 py-2 bg-blue-50/60 border-b border-blue-500/15 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <span>{t('admin.products.priceLevelColumn')}</span>
                <span className="text-right">{t('admin.products.priceColumn')}</span>
                <span className="text-right">{t('admin.products.marginColumn')}</span>
              </div>
              {levelRows.map((row) => {
                const raw = row.isDefault ? sellingPrice : (levelPrices[row.id] ?? '');
                const fallsBack = !row.isDefault && raw.trim() === '';
                const margin = marginFor(raw, fallsBack);
                const err = errors.levels?.[row.id];
                return (
                  <div
                    key={row.id || 'default'}
                    className={`grid grid-cols-[1fr_10rem_6rem] gap-3 items-center px-3 py-2.5 border-t first:border-t-0 border-blue-500/10 ${
                      row.isDefault ? 'bg-blue-50/30' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-medium text-gray-900 truncate">{row.name}</span>
                        {row.isDefault && defaultLevel && (
                          <span className="shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-blue-600/10 text-blue-700">
                            {t('admin.products.defaultBadge')}
                          </span>
                        )}
                      </div>
                      {fallsBack && (
                        <p className="text-[11px] text-gray-400 truncate">
                          {defaultPrice != null
                            ? t('admin.products.usesDefault', { price: formatIDR(defaultPrice) })
                            : t('admin.products.levelPrices.blank')}
                        </p>
                      )}
                      {err && <p className="text-[11px] text-red-600">{err}</p>}
                    </div>
                    <MoneyInput
                      value={raw}
                      onChange={(v) => {
                        if (row.isDefault) setSellingPrice(v);
                        else setLevelPrices((p) => ({ ...p, [row.id]: v }));
                        if (err) setErrors((e) => ({ ...e, levels: { ...e.levels, [row.id]: '' } }));
                      }}
                      placeholder={row.isDefault ? '0' : defaultPrice != null ? String(defaultPrice) : ''}
                      error={err}
                    />
                    <div className="text-right">
                      {margin ? (
                        <>
                          <div
                            className={`text-sm font-semibold tabular-nums ${
                              margin.profit < 0 ? 'text-red-600' : fallsBack ? 'text-gray-400' : 'text-green-700'
                            }`}
                          >
                            {margin.pct.toFixed(1)}%
                          </div>
                          <div className="text-[11px] text-gray-400 tabular-nums truncate">
                            {margin.profit < 0 ? t('admin.products.belowCost') : formatIDR(margin.profit)}
                          </div>
                        </>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400">
              {otherLevels.length > 0 ? t('admin.products.levelsHint') : t('admin.products.levelPrices.noLevels')}
            </p>
          </Section>

          <Section icon={<Boxes size={12} strokeWidth={2.5} />} title={t('admin.products.stockSection')}>
            {isNew ? (
              <p className="text-xs text-gray-500">{t('admin.products.stockNote')}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {t('admin.products.totalStockColumn')}: {totalStock}
                  </span>
                  {warehouseOps &&
                    stockLocations.map((l) => (
                      <span
                        key={l.location}
                        className="text-xs px-2 py-0.5 rounded-md border border-blue-500/15 bg-blue-50/40 text-gray-700 tabular-nums"
                      >
                        {l.location}: {l.qty}
                      </span>
                    ))}
                </div>

                <div className="rounded-lg border border-blue-500/15 p-3 space-y-3 bg-gray-50/50">
                  <div className="text-xs font-semibold text-gray-600">{t('admin.products.adjustStock')}</div>
                  <div className={`grid gap-3 ${warehouseOps ? 'sm:grid-cols-[1fr_7rem]' : 'sm:grid-cols-[7rem_1fr]'}`}>
                    {warehouseOps && (
                      <Field label={t('admin.products.locationLabel')}>
                        <select
                          value={pickedLocationId}
                          onChange={(e) => setPickedLocationId(e.target.value)}
                          className={fieldClass()}
                        >
                          <option value="">{t('admin.products.selectLocation')}</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    <Field label={t('admin.products.qtyLabel')}>
                      <input
                        type="number"
                        value={stockDelta}
                        onChange={(e) => setStockDelta(e.target.value)}
                        placeholder="0"
                        className={`${fieldClass()} tabular-nums`}
                      />
                    </Field>
                    {!warehouseOps && (
                      <Field label={t('admin.products.reasonLabel')}>
                        <input value={stockReason} onChange={(e) => setStockReason(e.target.value)} className={fieldClass()} />
                      </Field>
                    )}
                  </div>
                  {warehouseOps && (
                    <Field label={t('admin.products.reasonLabel')}>
                      <input value={stockReason} onChange={(e) => setStockReason(e.target.value)} className={fieldClass()} />
                    </Field>
                  )}
                  <p className="text-xs text-gray-400">
                    {t('admin.products.stockAdjustNote', { reason: DEFAULT_ADJUST_REASON })}
                  </p>
                </div>
              </>
            )}
          </Section>
        </div>

        {/* Footer */}
        <div className="border-t border-blue-500/15 px-5 py-3 bg-white">
          {formError && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 mb-2">
              <AlertTriangle size={14} strokeWidth={2.5} className="shrink-0 mt-0.5" />
              {formError}
            </p>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 hidden sm:inline mr-auto">{t('admin.products.shortcutHint')}</span>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 sm:flex-none px-4 py-2 rounded-md border border-blue-500/15 text-sm font-medium text-gray-600 hover:bg-blue-50 disabled:opacity-40"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex-1 sm:flex-none px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40"
            >
              {saving
                ? isNew
                  ? t('common.creating')
                  : t('common.saving')
                : isNew
                  ? t('admin.products.createProduct')
                  : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
