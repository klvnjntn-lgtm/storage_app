'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, ChevronDown, ChevronUp, Tag, Hash, Wallet, Boxes, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';
import ComboBox from '@/app/components/shared/ComboBox';

type Option = { id: string; name: string };

type FieldErrors = {
  name?: string;
  sku?: string;
  category?: string;
  sellingPrice?: string;
  costPrice?: string;
  stock?: string;
};

const inputBase =
  'w-full border-2 rounded-md px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 bg-white';
const inputOk = 'border-gray-300 focus:border-blue-500';
const inputBad = 'border-red-400 focus:border-red-500 bg-red-50/40';

function fieldClass(err?: string) {
  return `${inputBase} ${err ? inputBad : inputOk}`;
}

// The Stock page's "New product" panel (admins only): a product with its
// opening stock, and a margin preview where cost prices are visible.
export function NewProductForm({
  categories,
  brands,
  showCostPrice,
  onCreated,
}: {
  categories: Option[];
  brands: Option[];
  showCostPrice: boolean;
  onCreated: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [oem, setOem] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [brandInput, setBrandInput] = useState('');
  const [sellingPriceInput, setSellingPriceInput] = useState('');
  const [costPriceInput, setCostPriceInput] = useState('');
  const [stockInput, setStockInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccessMsg, setCreateSuccessMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // --- New Product form logic ---

  function parsePriceInput(raw: string): number | undefined | null {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    if (Number.isNaN(n) || n < 0) return null;
    return n;
  }

  function parseStockInput(raw: string): number | undefined | null {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) return null;
    return n;
  }

  // Advisory duplicate-SKU hint while typing; the backend enforces it.
  const [takenSku, setTakenSku] = useState<string | null>(null);
  const duplicateSku = !!takenSku && takenSku === sku.trim().toLowerCase();
  useEffect(() => {
    const trimmed = sku.trim().toLowerCase();
    if (!trimmed) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/products/sku-taken?sku=${encodeURIComponent(trimmed)}`);
        if (!res.ok || stale) return;
        if ((await res.json()).taken) setTakenSku(trimmed);
      } catch {
        // advisory only
      }
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [sku]);

  // Margin preview only makes sense (and is only shown) where cost price
  // itself is visible — i.e. admins with the invoicing module enabled.
  const marginPreview = useMemo(() => {
    if (!showCostPrice) return null;
    const sell = parsePriceInput(sellingPriceInput);
    const cost = parsePriceInput(costPriceInput);
    if (typeof sell !== 'number' || typeof cost !== 'number' || sell <= 0) return null;
    const profit = sell - cost;
    const pct = (profit / sell) * 100;
    return { profit, pct };
  }, [sellingPriceInput, costPriceInput, showCostPrice]);

  function resetCreateForm() {
    setName('');
    setSku('');
    setOem('');
    setCategoryInput('');
    setBrandInput('');
    setSellingPriceInput('');
    setCostPriceInput('');
    setStockInput('');
    setFieldErrors({});
  }

  function validateCreateForm(): FieldErrors | null {
    const errs: FieldErrors = {};

    if (!name.trim()) errs.name = t('common.required');
    if (!sku.trim()) errs.sku = t('common.required');
    if (!categoryInput.trim()) errs.category = t('common.required');

    const sellingPrice = parsePriceInput(sellingPriceInput);
    if (sellingPrice === null) errs.sellingPrice = t('inventory.stockPage.mustBeNonNegativeNumber');

    if (showCostPrice) {
      const costPrice = parsePriceInput(costPriceInput);
      if (costPrice === null) errs.costPrice = t('inventory.stockPage.mustBeNonNegativeNumber');
    }

    const stock = parseStockInput(stockInput);
    if (stock === null) errs.stock = t('inventory.stockPage.mustBeWholeNumber');

    return Object.keys(errs).length > 0 ? errs : null;
  }

  async function createProduct() {
    setCreateError('');
    setCreateSuccessMsg('');

    const errs = validateCreateForm();
    setFieldErrors(errs ?? {});
    if (errs) return;

    const sellingPrice = parsePriceInput(sellingPriceInput) as number | undefined;
    // Non-admins never see (or set) cost price — omit it entirely rather
    // than send an empty value the user never had a chance to view.
    const costPrice = showCostPrice ? (parsePriceInput(costPriceInput) as number | undefined) : undefined;
    const stock = parseStockInput(stockInput) as number | undefined;

    setCreating(true);

    try {
      const res = await apiFetch('/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim(),
          oem: oem.trim() || undefined,
          category: categoryInput.trim(),
          brand: brandInput.trim() || undefined,
          sellingPrice,
          costPrice,
          stock,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || t('inventory.stockPage.createProductFailed'));
      }

      setCreateSuccessMsg(t('inventory.stockPage.createSuccess', { name: name.trim() }));
      resetCreateForm();
      await onCreated();
    } catch (err: unknown) {
      console.error(err);
      setCreateError(err instanceof Error && err.message ? err.message : t('inventory.stockPage.createProductFailed'));
    } finally {
      setCreating(false);
    }
  }

  function handleCreateFormKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      createProduct();
    }
  }

  return (
    <div className="border-2 border-gray-300 rounded-md overflow-hidden bg-white">
      <button
        onClick={() => setFormOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-blue-50/60 hover:bg-blue-50 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Plus size={16} strokeWidth={2.5} className="text-blue-700" />
          {t('inventory.stockPage.newProduct')}
        </span>
        {formOpen ? (
          <ChevronUp size={16} strokeWidth={2} className="text-blue-700" />
        ) : (
          <ChevronDown size={16} strokeWidth={2} className="text-blue-700" />
        )}
      </button>

      {formOpen && (
        <div className="p-4 space-y-5" onKeyDown={handleCreateFormKeyDown}>
          {createError && (
            <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
              <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
              {createError}
            </div>
          )}

          {createSuccessMsg && (
            <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
              <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
              {createSuccessMsg}
            </div>
          )}

          {/* Section: Identity */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700/80 uppercase tracking-wide">
              <Tag size={12} strokeWidth={2.5} />
              {t('inventory.stockPage.sectionIdentity')}
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }));
                  }}
                  placeholder={t('inventory.stockPage.namePlaceholder')}
                  className={fieldClass(fieldErrors.name)}
                />
                {fieldErrors.name && <p className="text-xs text-red-600 mt-1">{fieldErrors.name}</p>}
              </div>
              <div>
                <input
                  value={oem}
                  onChange={(e) => setOem(e.target.value)}
                  placeholder={t('inventory.stockPage.oemPlaceholder')}
                  className={fieldClass()}
                />
              </div>
            </div>
          </div>

          {/* Section: Catalog identifiers */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700/80 uppercase tracking-wide">
              <Hash size={12} strokeWidth={2.5} />
              {t('inventory.stockPage.sectionCatalog')}
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <input
                  value={sku}
                  onChange={(e) => {
                    setSku(e.target.value);
                    if (fieldErrors.sku) setFieldErrors((f) => ({ ...f, sku: undefined }));
                  }}
                  placeholder={t('inventory.stockPage.skuPlaceholder')}
                  className={fieldClass(fieldErrors.sku)}
                />
                {fieldErrors.sku && <p className="text-xs text-red-600 mt-1">{fieldErrors.sku}</p>}
                {!fieldErrors.sku && duplicateSku && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <AlertTriangle size={11} strokeWidth={2.5} />
                    {t('inventory.stockPage.skuDuplicate')}
                  </p>
                )}
              </div>
              <div>
                <ComboBox
          noMatchesLabel={t('inventory.stockPage.comboBoxNoMatches')}
          createOptionLabel={(v) => t('inventory.stockPage.comboBoxCreateOption', { value: v })}
          tone="gray"

                  value={categoryInput}
                  onChange={(v) => {
                    setCategoryInput(v);
                    if (fieldErrors.category) setFieldErrors((f) => ({ ...f, category: undefined }));
                  }}
                  options={categories}
                  placeholder={t('inventory.stockPage.categoryPlaceholder')}
                  className={fieldClass(fieldErrors.category)}
                />
                {fieldErrors.category ? (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.category}</p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">{t('inventory.stockPage.categoryHint')}</p>
                )}
              </div>
              <div>
                <ComboBox
          noMatchesLabel={t('inventory.stockPage.comboBoxNoMatches')}
          createOptionLabel={(v) => t('inventory.stockPage.comboBoxCreateOption', { value: v })}
          tone="gray"

                  value={brandInput}
                  onChange={setBrandInput}
                  options={brands}
                  placeholder={t('inventory.stockPage.brandPlaceholder')}
                  className={fieldClass()}
                />
                <p className="text-xs text-gray-400 mt-1">{t('inventory.stockPage.brandHint')}</p>
              </div>
            </div>
          </div>

          {/* Section: Pricing & Inventory */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700/80 uppercase tracking-wide">
              <Wallet size={12} strokeWidth={2.5} />
              {t('inventory.stockPage.sectionPricingInventory')}
            </div>
            <div className={`grid gap-3 ${showCostPrice ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('inventory.stockPage.sellingPriceLabel')}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                    Rp
                  </span>
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={sellingPriceInput}
                    onChange={(e) => {
                      setSellingPriceInput(e.target.value);
                      if (fieldErrors.sellingPrice) setFieldErrors((f) => ({ ...f, sellingPrice: undefined }));
                    }}
                    placeholder="150000"
                    className={`${fieldClass(fieldErrors.sellingPrice)} pl-8`}
                  />
                </div>
                {fieldErrors.sellingPrice && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.sellingPrice}</p>
                )}
              </div>

              {/* Cost price is invoicing/margin data — only rendered for admins with
                  the invoicing module on, matching the same gate as the table column. */}
              {showCostPrice && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('inventory.stockPage.costPriceLabel')}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                      Rp
                    </span>
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={costPriceInput}
                      onChange={(e) => {
                        setCostPriceInput(e.target.value);
                        if (fieldErrors.costPrice) setFieldErrors((f) => ({ ...f, costPrice: undefined }));
                      }}
                      placeholder="100000"
                      className={`${fieldClass(fieldErrors.costPrice)} pl-8`}
                    />
                  </div>
                  {fieldErrors.costPrice && (
                    <p className="text-xs text-red-600 mt-1">{fieldErrors.costPrice}</p>
                  )}
                </div>
              )}

              <div>
                <label className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                  <Boxes size={12} strokeWidth={2.5} />
                  {t('inventory.stockPage.stockOnHandLabel')}
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={stockInput}
                  onChange={(e) => {
                    setStockInput(e.target.value);
                    if (fieldErrors.stock) setFieldErrors((f) => ({ ...f, stock: undefined }));
                  }}
                  placeholder="0"
                  className={fieldClass(fieldErrors.stock)}
                />
                {fieldErrors.stock && <p className="text-xs text-red-600 mt-1">{fieldErrors.stock}</p>}
              </div>
            </div>

            {marginPreview && (
              <div
                className={`text-xs rounded-md px-3 py-2 border-2 inline-flex items-center gap-1.5 ${
                  marginPreview.profit >= 0
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {t('inventory.stockPage.marginPreview', {
                  profit: formatIDR(marginPreview.profit),
                  pct: marginPreview.pct.toFixed(1),
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={createProduct}
              disabled={creating}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? t('common.creating') : t('inventory.stockPage.createProductButton')}
            </button>
            <button
              onClick={resetCreateForm}
              disabled={creating}
              className="px-4 py-2 text-gray-500 text-sm hover:text-blue-700 disabled:opacity-40 transition-colors"
            >
              {t('common.clear')}
            </button>
            <span className="text-xs text-gray-400 ml-auto hidden md:inline">{t('inventory.stockPage.submitHint')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
