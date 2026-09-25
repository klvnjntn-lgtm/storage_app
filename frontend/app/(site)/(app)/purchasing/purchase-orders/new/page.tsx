// app/(app)/purchasing/purchase-orders/new/page.tsx
'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { ClipboardList, Trash2, Plus } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { POProductSearch } from '@/app/components/purchase-orders/POProductSearch';
import { SupplierPicker } from '@/app/components/purchase-orders/SupplierPicker';
import { Supplier } from '@/app/components/suppliers/types';
import { LocationOption, POCartLine, PONewProductLine, POProduct, TaxRate } from '@/app/components/purchase-orders/types';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { useLanguage } from '@/app/context/LanguageContext';


const AUTOSAVE_DEBOUNCE_MS = 1000;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// True once there's anything worth persisting as a draft — a cart line, a
// started "new product" row, or just a chosen supplier with an empty cart.
// The last case matters for exit-save: picking a supplier and closing the
// tab should still leave a draft behind, not just once there's a line item.
function hasSaveableContent(
  cart: Record<string, POCartLine>,
  newProductLines: PONewProductLine[],
  supplier: Supplier | null,
): boolean {
  return (
    Object.keys(cart).length > 0 ||
    newProductLines.some((l) => l.name.trim() || l.sku.trim() || l.category.trim()) ||
    !!supplier
  );
}

// FIX — useSearchParams() requires a Suspense boundary for static
// prerendering, or `next build` fails outright. See login/page.tsx.
export default function PurchaseOrderFormPage() {
  return (
    <Suspense fallback={null}>
      <PurchaseOrderFormPageInner />
    </Suspense>
  );
}

function PurchaseOrderFormPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');
  const { t } = useLanguage();

  const hasWarehouseOps = useHasModule('WAREHOUSE_OPS');
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [locationId, setLocationId] = useState('');
  const [taxRateId, setTaxRateId] = useState<string | null>(null);
  const [discountAmount, setDiscountAmount] = useState('0');

  const [cart, setCart] = useState<Record<string, POCartLine>>({});
  const [newProductLines, setNewProductLines] = useState<PONewProductLine[]>([]);
  const newProductCounterRef = useUuidCounter();

  const [loading, setLoading] = useState(Boolean(editId));
  const [notEditable, setNotEditable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Draft id this "new" page has adopted — starts as whatever ?id= was in
  // the URL, but autosave can also mint a fresh one client-side (see
  // adoptId below), same as the sales-side new pages.
  const [currentId, setCurrentId] = useState<string | null>(editId);
  const skipAutosaveRef = useRef(false);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef(false);

  const cartRef = useRef(cart);
  const newProductLinesRef = useRef(newProductLines);
  const supplierRef = useRef(supplier);
  useEffect(() => {
    cartRef.current = cart;
    newProductLinesRef.current = newProductLines;
    supplierRef.current = supplier;
  }, [cart, newProductLines, supplier, locationId, taxRateId, discountAmount]);

  useEffect(() => {
    (async () => {
      const [locRes, taxRes] = await Promise.all([
        apiFetch('/locations'),
        apiFetch('/organization/tax-rates'),
      ]);
      if (locRes.ok) setLocations(await locRes.json());
      if (taxRes.ok) {
        const rates = await taxRes.json();
        setTaxRates(
          rates
            .filter((r: any) => !r.archivedAt)
            .map((r: any) => ({ id: r.id, name: r.name, percentage: r.percentage, isDefault: !!r.isDefault })),
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await apiFetch(`/purchase-orders/${editId}`);
        if (!res.ok) {
          setError(t('purchasing.purchaseOrderNew.loadError', { status: res.status }));
          return;
        }
        const po = await res.json();
        if (po.status !== 'DRAFT') {
          // update() hard-rejects anything past DRAFT — don't pretend
          // this form can edit it.
          setNotEditable(true);
          return;
        }

        setLocationId(po.locationId ?? '');
        setTaxRateId(po.taxRateId ?? null);
        setDiscountAmount(String(Number(po.discountAmount ?? 0)));

        if (po.supplierId) {
          const supRes = await apiFetch(`/suppliers/${po.supplierId}`);
          if (supRes.ok) setSupplier(await supRes.json());
        }

        const restoredCart: Record<string, POCartLine> = {};
        for (const item of po.items ?? []) {
          if (item.productId && item.product) {
            restoredCart[item.productId] = {
              product: { id: item.productId, name: item.product.name, sku: item.product.sku ?? null, barcode: null, image: null },
              quantity: Number(item.quantity),
              unitCost: Number(item.unitCost),
            };
          }
          // else: pre-migration line with no linked product — it can't
          // be represented in this form (no newProduct payload to
          // reconstruct), so it's silently excluded from the editable
          // cart. Surface via a read-only banner elsewhere if needed.
        }
        skipAutosaveRef.current = true;
        setCart(restoredCart);
        // Draft POs never contain unsaved "new product" rows — those
        // only exist client-side until save, at which point they become
        // ordinary linked items on reload. Nothing to restore here.
      } catch {
        setError(t('purchasing.purchaseOrderNew.serverError'));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  function addProduct(product: POProduct, details: { quantity: number; unitCost: number }) {
    setCart((prev) => {
      const existing = prev[product.id];
      return {
        ...prev,
        [product.id]: {
          product,
          quantity: (existing?.quantity ?? 0) + details.quantity,
          unitCost: details.unitCost,
        },
      };
    });
  }

  function changeQty(productId: string, raw: string) {
    setCart((prev) => {
      const line = prev[productId];
      if (!line) return prev;
      const parsed = Number(raw);
      const qty = Number.isFinite(parsed) && parsed > 0 ? parsed : line.quantity;
      return { ...prev, [productId]: { ...line, quantity: qty } };
    });
  }

  function changeUnitCost(productId: string, raw: string) {
    setCart((prev) => {
      const line = prev[productId];
      if (!line) return prev;
      const parsed = Number(raw);
      const cost = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      return { ...prev, [productId]: { ...line, unitCost: cost } };
    });
  }

  function removeProduct(productId: string) {
    setCart((prev) => {
      const { [productId]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function addNewProductLine() {
    setNewProductLines((prev) => [
      ...prev,
      { key: `newp_${newProductCounterRef()}`, name: '', sku: '', category: '', quantity: 1, unitCost: 0 },
    ]);
  }
  function updateNewProductLine(key: string, patch: Partial<PONewProductLine>) {
    setNewProductLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeNewProductLine(key: string) {
    setNewProductLines((prev) => prev.filter((l) => l.key !== key));
  }

  const cartLines = Object.values(cart).map((l) => ({ ...l, lineTotal: round2(l.quantity * l.unitCost) }));
  const newProductLineTotals = newProductLines.map((l) => ({ ...l, lineTotal: round2(l.quantity * l.unitCost) }));
  const subtotal = round2(
    cartLines.reduce((sum, l) => sum + l.lineTotal, 0) +
      newProductLineTotals.reduce((sum, l) => sum + l.lineTotal, 0),
  );
  const parsedDiscount = Number(discountAmount) || 0;
  const clampedDiscount = Math.min(Math.max(parsedDiscount, 0), subtotal);
  const selectedTaxRate = taxRates.find((r) => r.id === taxRateId) ?? null;
  const taxAmount = selectedTaxRate ? round2((subtotal - clampedDiscount) * (selectedTaxRate.percentage / 100)) : 0;
  const total = round2(subtotal - clampedDiscount + taxAmount);
  const itemCount = cartLines.length + newProductLineTotals.length;

  function buildPayload() {
    const invalidNewProduct = newProductLines.find(
      (l) => !l.name.trim() || !l.sku.trim() || !l.category.trim(),
    );
    if (invalidNewProduct) {
      throw new Error(t('purchasing.purchaseOrderNew.newProductValidation'));
    }
    return {
      locationId: locationId || undefined,
      supplierId: supplier?.id,
      discountAmount: clampedDiscount,
      taxRateId: taxRateId || undefined,
      items: [
        ...cartLines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitCost: l.unitCost })),
        ...newProductLines.map((l) => ({
          newProduct: {
            name: l.name.trim(),
            sku: l.sku.trim(),
            category: l.category.trim(),
            brand: l.brand?.trim() || undefined,
            oem: l.oem?.trim() || undefined,
            barcode: l.barcode?.trim() || undefined,
          },
          quantity: l.quantity,
          unitCost: l.unitCost,
        })),
      ],
    };
  }

  // Autosave-only payload: unlike buildPayload() (used for the explicit
  // Save button) this never throws on a half-filled "new product" row —
  // it just leaves that row out of the draft until it's complete, the
  // same way the sales-side pages silently drop half-filled service lines.
  function buildAutosavePayload() {
    const validNewProductLines = newProductLines.filter(
      (l) => l.name.trim() && l.sku.trim() && l.category.trim(),
    );
    return {
      locationId: locationId || undefined,
      supplierId: supplier?.id,
      discountAmount: clampedDiscount,
      taxRateId: taxRateId || undefined,
      items: [
        ...cartLines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitCost: l.unitCost })),
        ...validNewProductLines.map((l) => ({
          newProduct: {
            name: l.name.trim(),
            sku: l.sku.trim(),
            category: l.category.trim(),
            brand: l.brand?.trim() || undefined,
            oem: l.oem?.trim() || undefined,
            barcode: l.barcode?.trim() || undefined,
          },
          quantity: l.quantity,
          unitCost: l.unitCost,
        })),
      ],
    };
  }

  function adoptId(id: string) {
    setCurrentId(id);
    window.history.replaceState(null, '', `/purchasing/purchase-orders/new?id=${id}`);
  }

  // useKeepalive is set from the pagehide handler below, so the request
  // can outlive the page (tab close/refresh/navigating away) instead of
  // being cancelled mid-flight like a normal fetch would be.
  async function autosaveDraft(useKeepalive = false) {
    if (savedRef.current) return;
    if (!hasSaveableContent(cartRef.current, newProductLinesRef.current, supplierRef.current)) return;

    const payload = buildAutosavePayload();
    try {
      if (currentId) {
        await apiFetch(`/purchase-orders/${currentId}`, {
          method: 'PATCH',
          keepalive: useKeepalive,
          body: JSON.stringify(payload),
        });
      } else {
        const res = await apiFetch('/purchase-orders', {
          method: 'POST',
          keepalive: useKeepalive,
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const draft = await res.json();
          adoptId(draft.id);
        }
      }
    } catch (e) {
      console.error('Draft autosave failed', e);
    }
  }

  const autosaveDraftRef = useRef(autosaveDraft);
  useEffect(() => {
    autosaveDraftRef.current = autosaveDraft;
  });

  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    if (savedRef.current) return;
    if (!hasSaveableContent(cart, newProductLines, supplier)) return;

    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = setTimeout(() => {
      autosaveDraft();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, newProductLines, supplier, locationId, taxRateId, discountAmount]);

  // Safety net for leaving via client-side navigation (component unmount) —
  // the debounce above may not have fired yet.
  useEffect(() => {
    return () => {
      if (savedRef.current) return;
      if (hasSaveableContent(cartRef.current, newProductLinesRef.current, supplierRef.current)) {
        autosaveDraftRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Covers exits the unmount cleanup above can't see: closing the tab,
  // refreshing, or navigating to a different site. pagehide (not
  // beforeunload) is used so it doesn't block the back/forward cache; the
  // fetch is fired with keepalive so it can complete after the page is gone.
  useEffect(() => {
    function handlePageHide() {
      if (savedRef.current) return;
      if (hasSaveableContent(cartRef.current, newProductLinesRef.current, supplierRef.current)) {
        autosaveDraftRef.current(true);
      }
    }
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setError('');
    if (itemCount === 0) {
      setError(t('purchasing.purchaseOrderNew.addAtLeastOneItem'));
      return;
    }
    let payload;
    try {
      payload = buildPayload();
    } catch (e: any) {
      setError(e.message ?? t('purchasing.purchaseOrderNew.checkNewProductRows'));
      return;
    }
    setSaving(true);
    savedRef.current = true;
    try {
      const res = currentId
        ? await apiFetch(`/purchase-orders/${currentId}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await apiFetch('/purchase-orders', { method: 'POST', body: JSON.stringify(payload) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        savedRef.current = false;
        setError(body?.message ?? t('purchasing.purchaseOrderNew.requestFailed', { status: res.status }));
        return;
      }
      router.push(`/purchasing/purchase-orders/${body.id}`);
    } catch {
      savedRef.current = false;
      setError(t('purchasing.purchaseOrderNew.serverError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white text-black p-6">
        <p className="text-sm text-gray-500">{t('purchasing.purchaseOrderNew.loading')}</p>
      </main>
    );
  }

  if (notEditable) {
    return (
      <main className="min-h-screen bg-white text-black p-6">
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3 mb-4">
          {t('purchasing.purchaseOrderNew.notEditable')}
        </p>
        <button
          onClick={() => router.push(`/purchasing/purchase-orders/${editId}`)}
          className="text-sm underline"
        >
          {t('purchasing.purchaseOrderNew.viewInstead')}
        </button>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <ClipboardList size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight`}>
              {currentId ? t('purchasing.purchaseOrderNew.titleEdit') : t('purchasing.purchaseOrderNew.titleNew')}
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-4">
          <POProductSearch onAddProduct={addProduct} />

          {cartLines.length === 0 && newProductLineTotals.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t('purchasing.purchaseOrderNew.noItemsYet')}</p>
          ) : (
            <div className="border-2 border-gray-200 rounded-md overflow-hidden bg-white">
              <table className="w-full text-sm">
                <thead className="bg-blue-50/60 border-b-2 border-gray-200">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">{t('purchasing.purchaseOrderNew.colItem')}</th>
                    <th className="text-right font-semibold px-3 py-2 w-20">{t('purchasing.purchaseOrderNew.colQty')}</th>
                    <th className="text-right font-semibold px-3 py-2 w-32">{t('purchasing.purchaseOrderNew.colUnitCost')}</th>
                    <th className="text-right font-semibold px-3 py-2 w-32">{t('purchasing.purchaseOrderNew.colLineTotal')}</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {cartLines.map((l) => (
                    <tr key={l.product.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium">{l.product.name}</p>
                        {l.product.sku && <p className="text-xs text-gray-500">{t('purchasing.purchaseOrderNew.skuLabel', { sku: l.product.sku })}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) => changeQty(l.product.id, e.target.value)}
                          className="w-16 text-right border-2 border-gray-300 focus:border-blue-500 rounded-md px-2 py-1 text-sm outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          value={l.unitCost}
                          onChange={(e) => changeUnitCost(l.product.id, e.target.value)}
                          className="w-28 text-right border-2 border-gray-300 focus:border-blue-500 rounded-md px-2 py-1 text-sm outline-none"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{formatIDR(l.lineTotal)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => removeProduct(l.product.id)} className="text-red-500 hover:text-red-700">
                          <Trash2 size={15} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {newProductLineTotals.map((l) => (
                    <tr key={l.key} className="border-b border-gray-100 last:border-0 align-top">
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <input
                            type="text"
                            placeholder={t('purchasing.purchaseOrderNew.productNamePlaceholder')}
                            value={l.name}
                            onChange={(e) => updateNewProductLine(l.key, { name: e.target.value })}
                            className={`w-full border-2 rounded-md px-2 py-1 text-sm outline-none ${
                              l.name.trim() ? 'border-gray-300 focus:border-blue-500' : 'border-red-300 focus:border-red-500'
                            }`}
                          />
                          <div className="flex gap-1">
                            <input
                              type="text"
                              placeholder={t('purchasing.purchaseOrderNew.skuPlaceholder')}
                              value={l.sku}
                              onChange={(e) => updateNewProductLine(l.key, { sku: e.target.value })}
                              className={`w-1/2 border-2 rounded-md px-2 py-1 text-xs outline-none ${
                                l.sku.trim() ? 'border-gray-300 focus:border-blue-500' : 'border-red-300 focus:border-red-500'
                              }`}
                            />
                            <input
                              type="text"
                              placeholder={t('purchasing.purchaseOrderNew.categoryPlaceholder')}
                              value={l.category}
                              onChange={(e) => updateNewProductLine(l.key, { category: e.target.value })}
                              className={`w-1/2 border-2 rounded-md px-2 py-1 text-xs outline-none ${
                                l.category.trim() ? 'border-gray-300 focus:border-blue-500' : 'border-red-300 focus:border-red-500'
                              }`}
                            />
                          </div>
                          <p className="text-xs text-gray-400 italic">{t('purchasing.purchaseOrderNew.newProductLabel')}</p>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) => {
                            const parsed = Number(e.target.value);
                            updateNewProductLine(l.key, {
                              quantity: Number.isFinite(parsed) && parsed > 0 ? parsed : l.quantity,
                            });
                          }}
                          className="w-16 text-right border-2 border-gray-300 focus:border-blue-500 rounded-md px-2 py-1 text-sm outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          value={l.unitCost}
                          onChange={(e) => {
                            const parsed = Number(e.target.value);
                            updateNewProductLine(l.key, {
                              unitCost: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                            });
                          }}
                          className="w-28 text-right border-2 border-gray-300 focus:border-blue-500 rounded-md px-2 py-1 text-sm outline-none"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{formatIDR(l.lineTotal)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => removeNewProductLine(l.key)} className="text-red-500 hover:text-red-700">
                          <Trash2 size={15} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            onClick={addNewProductLine}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-dashed border-gray-300 text-gray-600 hover:border-blue-500/50 hover:text-blue-700 hover:bg-blue-50/40 transition-colors"
          >
            <Plus size={14} strokeWidth={2} />
            {t('purchasing.purchaseOrderNew.addNewProduct')}
          </button>
        </div>

        <div className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
          )}

          <div>
            <label className="block text-sm font-semibold mb-1">{t('purchasing.purchaseOrderNew.supplier')}</label>
            <SupplierPicker supplier={supplier} onChange={setSupplier} />
          </div>

          {hasWarehouseOps && (
            <div>
              <label className="block text-sm font-semibold mb-1">{t('purchasing.purchaseOrderNew.receivingLocation')}</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full border-2 border-gray-300 focus:border-blue-500 rounded-md px-3 py-2 text-sm outline-none"
              >
                <option value="">{t('purchasing.purchaseOrderNew.selectLocationPlaceholder')}</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold mb-1">{t('purchasing.purchaseOrderNew.tax')}</label>
            <select
              value={taxRateId ?? ''}
              onChange={(e) => setTaxRateId(e.target.value || null)}
              className="w-full border-2 border-gray-300 focus:border-blue-500 rounded-md px-3 py-2 text-sm outline-none"
            >
              <option value="">{t('purchasing.purchaseOrderNew.none')}</option>
              {taxRates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.percentage}%)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">{t('purchasing.purchaseOrderNew.discount')}</label>
            <input
              type="number"
              min={0}
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              className="w-full border-2 border-gray-300 focus:border-blue-500 rounded-md px-3 py-2 text-sm outline-none"
            />
          </div>

          <div className="border-t-2 border-gray-200 pt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">{t('purchasing.purchaseOrderNew.subtotal')}</span>
              <span>{formatIDR(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t('purchasing.purchaseOrderNew.discountRow')}</span>
              <span>-{formatIDR(clampedDiscount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t('purchasing.purchaseOrderNew.taxRow')}</span>
              <span>{formatIDR(taxAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-base pt-1">
              <span>{t('purchasing.purchaseOrderNew.total')}</span>
              <span>{formatIDR(total)}</span>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || itemCount === 0}
            className="w-full bg-blue-600 text-white font-semibold px-4 py-2.5 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? t('purchasing.purchaseOrderNew.saving') : currentId ? t('purchasing.purchaseOrderNew.saveChanges') : t('purchasing.purchaseOrderNew.saveDraft')}
          </button>
        </div>
      </div>
    </main>
  );
}

// Small stable-id generator for local-only new-product-line keys, so a
// fast-double-click on "Add new product" can't collide on Date.now().
function useUuidCounter() {
  const ref = useRef(0);
  return () => {
    ref.current += 1;
    return `${Date.now()}_${ref.current}`;
  };
}