// app/(app)/purchasing/purchase-orders/new/page.tsx
'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { CalendarClock, ClipboardList } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { SupplierPicker } from '@/app/components/purchase-orders/SupplierPicker';
import { DocumentHeader } from '@/app/components/shared/DocumentHeader';
import { LineItemsTable, type TableLine } from '@/app/components/shared/LineItemsTable';
import { describeSalesProduct, searchSalesProducts } from '@/app/components/shared/salesLineTable';
import DatePicker from '@/app/components/shared/DatePicker';
import { toCalendarDateString } from '@/lib/dates';
import { Supplier } from '@/app/components/suppliers/types';
import { defaultLocation } from '@/lib/locations';
import { LocationOption, POCartLine, PONewProductLine, POProduct } from '@/app/components/purchase-orders/types';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { useLanguage } from '@/app/context/LanguageContext';
import { errorMessage } from '@/lib/api-error';


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

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [orderDate, setOrderDate] = useState(() => toCalendarDateString(new Date()));
  const [expectedDate, setExpectedDate] = useState('');
  // MASTER picks the branch; '' = the receiving location's, else the first (see BranchPicker).
  const [branchId, setBranchId] = useState('');
  const [locationId, setLocationId] = useState('');
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
  }, [cart, newProductLines, supplier, locationId, discountAmount, orderDate, expectedDate, branchId]);

  useEffect(() => {
    (async () => {
      const [locRes] = await Promise.all([
        apiFetch('/locations'),
      ]);
      if (locRes.ok) setLocations(await locRes.json());
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
        setOrderDate(po.orderDate ? String(po.orderDate).slice(0, 10) : '');
        setExpectedDate(po.expectedDate ? String(po.expectedDate).slice(0, 10) : '');
        setBranchId(po.branchId ?? '');
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

  // The table's edits, routed to a catalogue line (keyed by product id) or a new-product row.
  function tableQty(key: string, qty: number) {
    if (cart[key]) changeQty(key, String(qty));
    else updateNewProductLine(key, { quantity: qty });
  }
  function tableCost(key: string, raw: string) {
    if (cart[key]) return changeUnitCost(key, raw);
    const parsed = Number(raw);
    updateNewProductLine(key, { unitCost: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 });
  }

  const cartLines = Object.values(cart).map((l) => ({ ...l, lineTotal: round2(l.quantity * l.unitCost) }));
  const newProductLineTotals = newProductLines.map((l) => ({ ...l, lineTotal: round2(l.quantity * l.unitCost) }));
  const subtotal = round2(
    cartLines.reduce((sum, l) => sum + l.lineTotal, 0) +
      newProductLineTotals.reduce((sum, l) => sum + l.lineTotal, 0),
  );
  const parsedDiscount = Number(discountAmount) || 0;
  const clampedDiscount = Math.min(Math.max(parsedDiscount, 0), subtotal);
  const total = round2(subtotal - clampedDiscount);
  const itemCount = cartLines.length + newProductLineTotals.length;

  const newProductInput = (missing: boolean) =>
    `w-1/2 h-8 border rounded-md px-2 text-xs bg-white outline-none ${
      missing ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-blue-500/60'
    }`;
  const tableLines: TableLine[] = [
    ...cartLines.map(
      (l): TableLine => ({
        key: l.product.id,
        kind: 'product',
        name: l.product.name,
        sub: l.product.sku,
        quantity: l.quantity,
        unit: null,
        unitPrice: l.unitCost,
        discountType: null,
        discountValue: null,
        discountAmount: 0,
        total: l.lineTotal,
      }),
    ),
    ...newProductLineTotals.map(
      (l): TableLine => ({
        key: l.key,
        kind: 'product',
        typedName: true,
        name: l.name,
        quantity: l.quantity,
        unit: null,
        unitPrice: l.unitCost,
        discountType: null,
        discountValue: null,
        discountAmount: 0,
        total: l.lineTotal,
        // Not in the catalogue yet: it's created with its SKU and category when the PO is saved.
        extra: (
          <div className="space-y-1">
            <div className="flex gap-1">
              <input
                type="text"
                placeholder={t('purchasing.purchaseOrderNew.skuPlaceholder')}
                value={l.sku}
                onChange={(e) => updateNewProductLine(l.key, { sku: e.target.value })}
                className={newProductInput(!l.sku.trim())}
              />
              <input
                type="text"
                placeholder={t('purchasing.purchaseOrderNew.categoryPlaceholder')}
                value={l.category}
                onChange={(e) => updateNewProductLine(l.key, { category: e.target.value })}
                className={newProductInput(!l.category.trim())}
              />
            </div>
            <p className="text-[11px] text-gray-400 italic">{t('purchasing.purchaseOrderNew.newProductLabel')}</p>
          </div>
        ),
      }),
    ),
  ];

  function buildPayload() {
    const invalidNewProduct = newProductLines.find(
      (l) => !l.name.trim() || !l.sku.trim() || !l.category.trim(),
    );
    if (invalidNewProduct) {
      throw new Error(t('purchasing.purchaseOrderNew.newProductValidation'));
    }
    return {
      locationId: (hasWarehouseOps ? locationId : defaultLocation(locations)?.id) || undefined,
      supplierId: supplier?.id,
      orderDate: orderDate || undefined,
      expectedDate: expectedDate || undefined,
      ...(branchId && { branchId }),
      discountAmount: clampedDiscount,
      // Explicit null so saving a draft from before tax rates were removed drops its tax.
      taxRateId: null,
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
      locationId: (hasWarehouseOps ? locationId : defaultLocation(locations)?.id) || undefined,
      supplierId: supplier?.id,
      orderDate: orderDate || undefined,
      expectedDate: expectedDate || undefined,
      ...(branchId && { branchId }),
      discountAmount: clampedDiscount,
      // Explicit null so saving a draft from before tax rates were removed drops its tax.
      taxRateId: null,
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
  }, [cart, newProductLines, supplier, locationId, discountAmount, orderDate, expectedDate, branchId]);

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
    } catch (e) {
      setError(errorMessage(e) ?? t('purchasing.purchaseOrderNew.checkNewProductRows'));
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

  const pageStyle = {
    backgroundColor: 'var(--page-bg)',
    backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
    backgroundSize: '24px 24px',
  };

  if (loading) {
    return (
      <main className="min-h-screen text-black" style={pageStyle}>
        <div className="max-w-5xl mx-auto p-4 sm:p-6">
          <p className="text-sm text-gray-500">{t('purchasing.purchaseOrderNew.loading')}</p>
        </div>
      </main>
    );
  }

  if (notEditable) {
    return (
      <main className="min-h-screen text-black" style={pageStyle}>
        <div className="max-w-5xl mx-auto p-4 sm:p-6">
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
            {t('purchasing.purchaseOrderNew.notEditable')}
          </p>
          <button
            onClick={() => router.push(`/purchasing/purchase-orders/${editId}`)}
            className="text-sm underline"
          >
            {t('purchasing.purchaseOrderNew.viewInstead')}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-black" style={pageStyle}>
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <ClipboardList size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  {currentId ? t('purchasing.purchaseOrderNew.titleEdit') : t('purchasing.purchaseOrderNew.titleNew')}
                </h1>
                <p className="text-xs text-gray-500 truncate">{t('purchasing.purchaseOrderNew.subtitle')}</p>
              </div>
            </div>

            <button
              onClick={() => router.push('/purchasing/purchase-orders')}
              className="text-sm px-2 sm:px-3 py-2 rounded-lg text-gray-500 hover:text-blue-700 hover:bg-blue-50/60 shrink-0 transition-colors"
            >
              {t('purchasing.purchaseOrderNew.history')}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* One document card: header, lines, then the discount and save. */}
        <div className="border border-blue-500/15 rounded-xl bg-white shadow-sm divide-y divide-blue-500/15">
          <DocumentHeader
            bare
            date={orderDate}
            onDateChange={setOrderDate}
            party={
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">{t('common.docHeader.supplier')}</label>
                <SupplierPicker supplier={supplier} onChange={setSupplier} />
              </div>
            }
            branch={{ value: branchId, onChange: setBranchId }}
            fields={
              <>
                <div className="mb-3">
                  <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                    <CalendarClock size={12} strokeWidth={2} className="text-blue-600/70" />
                    {t('purchasing.purchaseOrderNew.expectedDate')}
                  </label>
                  <DatePicker clearable value={expectedDate} onChange={setExpectedDate} className="w-full" />
                </div>
                {hasWarehouseOps && (
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">{t('purchasing.purchaseOrderNew.receivingLocation')}</label>
                    <select
                      value={locationId}
                      onChange={(e) => setLocationId(e.target.value)}
                      className="w-full border border-blue-500/20 rounded-lg p-2 text-sm bg-white outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
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
              </>
            }
          />

          <LineItemsTable
            bare
            hideUnit
            priceLabel={t('purchasing.purchaseOrderNew.colUnitCost')}
            lines={tableLines}
            search={searchSalesProducts}
            // Buying, so nothing is out of reach: stock is shown, never greyed out.
            describe={(p) => describeSalesProduct(p, (qty) => t('common.lineTable.inStock', { qty }))}
            onPick={(p) =>
              addProduct({ id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, image: p.image }, { quantity: 1, unitCost: 0 })
            }
            onChangeQty={tableQty}
            onChangePrice={tableCost}
            onChangeDescription={(key, name) => updateNewProductLine(key, { name })}
            onRemove={(key) => (cart[key] ? removeProduct(key) : removeNewProductLine(key))}
            onAddService={addNewProductLine}
            addServiceLabel={t('purchasing.purchaseOrderNew.addNewProduct')}
            totals={{ subtotal, discount: clampedDiscount, total }}
          />

          <div className="p-4 grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('purchasing.purchaseOrderNew.discount')}</label>
              <input
                type="number"
                min={0}
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                className="w-full border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saving || itemCount === 0}
              className="w-full bg-blue-700 hover:bg-blue-800 text-white rounded-lg p-3 text-sm font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {saving
                ? t('purchasing.purchaseOrderNew.saving')
                : currentId
                  ? t('purchasing.purchaseOrderNew.saveChanges')
                  : t('purchasing.purchaseOrderNew.saveDraft')}
            </button>
            {error && (
              <p className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>
            )}
          </div>
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