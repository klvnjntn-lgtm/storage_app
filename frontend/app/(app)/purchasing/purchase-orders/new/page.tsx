// app/(app)/purchasing/purchase-orders/new/page.tsx
'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ClipboardList, Trash2, Plus } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { POProductSearch } from '@/app/components/purchase-orders/POProductSearch';
import { SupplierPicker } from '@/app/components/purchase-orders/SupplierPicker';
import { Supplier } from '@/app/components/suppliers/types';
import { LocationOption, POCartLine, PONewProductLine, POProduct, TaxRate } from '@/app/components/purchase-orders/types';
import { useHasModule } from '@/lib/useHasModule';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export default function PurchaseOrderFormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');

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
          setError(`Could not load this purchase order (${res.status}).`);
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
              product: { id: item.productId, name: item.product.name, sku: item.product.sku ?? null, barcode: null },
              quantity: Number(item.quantity),
              unitCost: Number(item.unitCost),
            };
          }
          // else: pre-migration line with no linked product — it can't
          // be represented in this form (no newProduct payload to
          // reconstruct), so it's silently excluded from the editable
          // cart. Surface via a read-only banner elsewhere if needed.
        }
        setCart(restoredCart);
        // Draft POs never contain unsaved "new product" rows — those
        // only exist client-side until save, at which point they become
        // ordinary linked items on reload. Nothing to restore here.
      } catch {
        setError('Could not reach the server.');
      } finally {
        setLoading(false);
      }
    })();
  }, [editId]);

  function addProduct(product: POProduct) {
    setCart((prev) => {
      const existing = prev[product.id];
      return {
        ...prev,
        [product.id]: {
          product,
          quantity: (existing?.quantity ?? 0) + 1,
          unitCost: existing?.unitCost ?? 0,
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
      throw new Error('Each new product needs a name, SKU, and category');
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

  async function handleSave() {
    setError('');
    if (itemCount === 0) {
      setError('Add at least one item.');
      return;
    }
    let payload;
    try {
      payload = buildPayload();
    } catch (e: any) {
      setError(e.message ?? 'Please check the new product rows.');
      return;
    }
    setSaving(true);
    try {
      const res = editId
        ? await apiFetch(`/purchase-orders/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await apiFetch('/purchase-orders', { method: 'POST', body: JSON.stringify(payload) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      router.push(`/purchasing/purchase-orders/${body.id}`);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white text-black p-6">
        <p className="text-sm text-gray-500">Loading...</p>
      </main>
    );
  }

  if (notEditable) {
    return (
      <main className="min-h-screen bg-white text-black p-6">
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3 mb-4">
          This purchase order is no longer a draft and can't be edited here.
        </p>
        <button
          onClick={() => router.push(`/purchasing/purchase-orders/${editId}`)}
          className="text-sm underline"
        >
          View it instead
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/purchasing/purchase-orders')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>
          <div className="flex items-center gap-2">
            <ClipboardList size={20} strokeWidth={2} className="text-gray-700" />
            <h1 className="text-xl sm:text-2xl font-bold">{editId ? 'Edit Purchase Order' : 'New Purchase Order'}</h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-4">
          <POProductSearch onAddProduct={addProduct} />

          {cartLines.length === 0 && newProductLineTotals.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No items yet — search above to add products.</p>
          ) : (
            <div className="border-2 border-gray-200 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b-2 border-gray-200">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Item</th>
                    <th className="text-right font-semibold px-3 py-2 w-20">Qty</th>
                    <th className="text-right font-semibold px-3 py-2 w-32">Unit Cost</th>
                    <th className="text-right font-semibold px-3 py-2 w-32">Line Total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {cartLines.map((l) => (
                    <tr key={l.product.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium">{l.product.name}</p>
                        {l.product.sku && <p className="text-xs text-gray-500">SKU: {l.product.sku}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) => changeQty(l.product.id, e.target.value)}
                          className="w-16 text-right border-2 border-gray-300 focus:border-black rounded-md px-2 py-1 text-sm outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          value={l.unitCost}
                          onChange={(e) => changeUnitCost(l.product.id, e.target.value)}
                          className="w-28 text-right border-2 border-gray-300 focus:border-black rounded-md px-2 py-1 text-sm outline-none"
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
                            placeholder="Product name"
                            value={l.name}
                            onChange={(e) => updateNewProductLine(l.key, { name: e.target.value })}
                            className={`w-full border-2 rounded-md px-2 py-1 text-sm outline-none ${
                              l.name.trim() ? 'border-gray-300 focus:border-black' : 'border-red-300 focus:border-red-500'
                            }`}
                          />
                          <div className="flex gap-1">
                            <input
                              type="text"
                              placeholder="SKU"
                              value={l.sku}
                              onChange={(e) => updateNewProductLine(l.key, { sku: e.target.value })}
                              className={`w-1/2 border-2 rounded-md px-2 py-1 text-xs outline-none ${
                                l.sku.trim() ? 'border-gray-300 focus:border-black' : 'border-red-300 focus:border-red-500'
                              }`}
                            />
                            <input
                              type="text"
                              placeholder="Category"
                              value={l.category}
                              onChange={(e) => updateNewProductLine(l.key, { category: e.target.value })}
                              className={`w-1/2 border-2 rounded-md px-2 py-1 text-xs outline-none ${
                                l.category.trim() ? 'border-gray-300 focus:border-black' : 'border-red-300 focus:border-red-500'
                              }`}
                            />
                          </div>
                          <p className="text-xs text-gray-400 italic">New product</p>
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
                          className="w-16 text-right border-2 border-gray-300 focus:border-black rounded-md px-2 py-1 text-sm outline-none"
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
                          className="w-28 text-right border-2 border-gray-300 focus:border-black rounded-md px-2 py-1 text-sm outline-none"
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
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-dashed border-gray-300 text-gray-600 hover:border-black hover:text-black"
          >
            <Plus size={14} strokeWidth={2} />
            Add new product
          </button>
        </div>

        <div className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
          )}

          <div>
            <label className="block text-sm font-semibold mb-1">Supplier</label>
            <SupplierPicker supplier={supplier} onChange={setSupplier} />
          </div>

          {hasWarehouseOps && (
            <div>
              <label className="block text-sm font-semibold mb-1">Receiving Location</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full border-2 border-gray-300 focus:border-black rounded-md px-3 py-2 text-sm outline-none"
              >
                <option value="">Select location...</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold mb-1">Tax</label>
            <select
              value={taxRateId ?? ''}
              onChange={(e) => setTaxRateId(e.target.value || null)}
              className="w-full border-2 border-gray-300 focus:border-black rounded-md px-3 py-2 text-sm outline-none"
            >
              <option value="">None</option>
              {taxRates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.percentage}%)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Discount (flat amount)</label>
            <input
              type="number"
              min={0}
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              className="w-full border-2 border-gray-300 focus:border-black rounded-md px-3 py-2 text-sm outline-none"
            />
          </div>

          <div className="border-t-2 border-gray-200 pt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal</span>
              <span>{formatIDR(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Discount</span>
              <span>-{formatIDR(clampedDiscount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Tax</span>
              <span>{formatIDR(taxAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-base pt-1">
              <span>Total</span>
              <span>{formatIDR(total)}</span>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || itemCount === 0}
            className="w-full bg-black text-white font-semibold px-4 py-2.5 rounded-md hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Saving...' : editId ? 'Save Changes' : 'Save Draft'}
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