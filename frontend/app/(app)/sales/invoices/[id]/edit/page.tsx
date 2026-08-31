// app/(app)/invoices/[id]/edit/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, Minus, Plus, Trash2, Pencil, Percent, Wrench, X, AlertCircle, CalendarClock, MessageSquareText } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useHasModule } from '@/lib/useHasModule';
import { ProductSearch } from '@/app/components/invoices/ProductSearch';
import {
  CartLine,
  InvoiceFormat,
  LocationOption,
  ProductSearchResult,
  ServiceLine,
  TaxRate,
} from '@/app/components/invoices/types';

type RawTaxRate = TaxRate & { archivedAt: string | null };

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export default function EditIssuedInvoicePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [format, setFormat] = useState<InvoiceFormat>('RECEIPT');
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [vehicleLabel, setVehicleLabel] = useState<string | null>(null);

  const [dueDate, setDueDate] = useState('');

  // Required justification for the edit — sent to the backend and
  // surfaced in the invoice detail page's edit-history list.
  const [reason, setReason] = useState('');

  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceLine[]>([]);
  const serviceCounterRef = useRef(0);

  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [posPricingEnabled, setPosPricingEnabled] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationFilter, setLocationFilter] = useState<LocationOption | null>(null);

  useEffect(() => {
    async function loadSettings() {
      const res = await apiFetch('/organization/settings');
      if (!res.ok) return;
      const settings = await res.json();
      setPosPricingEnabled(!!settings.posPricingEnabled);
    }
    loadSettings();
  }, []);

  useEffect(() => {
    async function loadLocations() {
      const res = await apiFetch('/locations');
      if (!res.ok) return;
      setLocations(await res.json());
    }
    loadLocations();
  }, []);

  useEffect(() => {
    async function loadTaxRates() {
      const res = await apiFetch('/organization/tax-rates');
      if (!res.ok) return;
      const rates: RawTaxRate[] = await res.json();
      setTaxRates(
        rates
          .filter((r) => !r.archivedAt)
          .map((r) => ({ id: r.id, name: r.name, percentage: r.percentage, isDefault: r.isDefault })),
      );
    }
    loadTaxRates();
  }, []);

  useEffect(() => {
    async function loadInvoice() {
      setLoading(true);
      setLoadError('');
      try {
        const res = await apiFetch(`/invoices/${params.id}/edit-detail`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setLoadError(body?.message ?? `Failed to load invoice (${res.status})`);
          return;
        }
        const invoice = await res.json();

        setFormat(invoice.format);
        setInvoiceNumber(invoice.invoiceNumber ?? null);
        setCustomerName(invoice.customer?.name ?? invoice.customerName ?? null);
        setVehicleLabel(
          invoice.vehicle ? `${invoice.vehicle.plateNumber} · ${invoice.vehicle.vehicleModel}` : null,
        );
        setDueDate(invoice.dueDate ? String(invoice.dueDate).slice(0, 10) : '');

        const restoredCart: Record<string, CartLine> = {};
        const restoredServices: ServiceLine[] = [];
        for (const item of invoice.items) {
          const taxRateIds = (item.taxes ?? [])
            .map((t: { taxRateId: string | null }) => t.taxRateId)
            .filter((id: string | null): id is string => !!id);

          if (item.productId) {
            const locationId = item.locationId ?? invoice.locationId;
            const locationName = item.location?.name ?? invoice.location?.name ?? '';
            const key = `${item.productId}__${locationId}`;
            restoredCart[key] = {
              product: {
                id: item.productId,
                name: item.product?.name ?? '',
                sku: item.product?.sku ?? null,
                unit: item.product?.unit ?? item.unit ?? null,
                barcode: item.product?.barcode ?? null,
                sellingPrice: Number(item.unitPrice),
                // Empty on purpose — stock isn't refetched for restored
                // lines, so stockAtLineLocation() below treats this as
                // "unknown" and doesn't cap the quantity stepper.
                stockByLocation: [],
              },
              quantity: item.quantity,
              unitPrice: Number(item.unitPrice),
              locationId,
              unit: item.unit ?? null,
              locationName,
              taxRateIds,
            };
          } else {
            serviceCounterRef.current += 1;
            restoredServices.push({
              key: `svc_${serviceCounterRef.current}_${Date.now()}`,
              description: item.description ?? '',
              unitPrice: Number(item.unitPrice),
              unit: item.unit ?? null,
              taxRateIds,
            });
          }
        }
        setCart(restoredCart);
        setServices(restoredServices);
      } catch {
        setLoadError('Could not reach the server.');
      } finally {
        setLoading(false);
      }
    }
    loadInvoice();
  }, [params.id]);

  useEffect(() => {
    if (!query.trim() && !locationFilter) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(() => performSearch(query, locationFilter), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, locationFilter]);

  async function performSearch(q: string, loc: LocationOption | null) {
    if (!q.trim() && !loc) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const p = new URLSearchParams({ q: q.trim() });
      if (loc) p.set('locationId', loc.id);
      const res = await apiFetch(`/products/search-for-invoice?${p.toString()}`);
      if (!res.ok) return;
      setResults(await res.json());
    } finally {
      setSearching(false);
    }
  }

  function selectLocationFilter(loc: LocationOption | null) {
    setLocationFilter(loc);
    performSearch(query, loc);
  }

  function cartKey(productId: string, locationId: string) {
    return `${productId}__${locationId}`;
  }

  // Unknown (empty stockByLocation, i.e. a restored line) reads as
  // unlimited — the server still enforces real availability on save.
  function stockAtLineLocation(line: CartLine): number {
    if (line.product.stockByLocation.length === 0) return Infinity;
    return line.product.stockByLocation.find((s) => s.locationId === line.locationId)?.quantity ?? 0;
  }

  function addToCart(product: ProductSearchResult) {
    setError('');
    let target;
    if (locationFilter) {
      target = product.stockByLocation.find((s) => s.locationId === locationFilter.id);
      if (!target || target.quantity <= 0) {
        setError(`"${product.name}" isn't stocked at ${locationFilter.name}.`);
        return;
      }
    } else {
      target = [...product.stockByLocation].sort((a, b) => b.quantity - a.quantity)[0];
      if (!target || target.quantity <= 0) {
        setError(`"${product.name}" has no stock at any location.`);
        return;
      }
    }
    const resolvedTarget = target;
    const key = cartKey(product.id, resolvedTarget.locationId);
    setCart((prev) => {
      const existing = prev[key];
      const nextQty = (existing?.quantity ?? 0) + 1;
      const defaultRate = taxRates.find((r) => r.isDefault);
      return {
        ...prev,
        [key]: {
          product,
          unit: existing?.unit ?? product.unit ?? null,
          quantity: nextQty,
          unitPrice: existing?.unitPrice ?? product.sellingPrice ?? 0,
          locationId: resolvedTarget.locationId,
          locationName: resolvedTarget.locationName,
          taxRateIds: existing?.taxRateIds ?? (defaultRate ? [defaultRate.id] : []),
        },
      };
    });
  }

  function changeQty(key: string, delta: number) {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      const nextQty = line.quantity + delta;
      if (nextQty <= 0) {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      }
      const available = stockAtLineLocation(line);
      if (nextQty > available) return prev;
      return { ...prev, [key]: { ...line, quantity: nextQty } };
    });
  }

  function changeUnitPrice(key: string, raw: string) {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      const parsed = Number(raw);
      const nextPrice = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      return { ...prev, [key]: { ...line, unitPrice: nextPrice } };
    });
  }

  function removeFromCart(key: string) {
    setCart((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function toggleLineTaxRate(key: string, taxRateId: string) {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      const has = line.taxRateIds.includes(taxRateId);
      return {
        ...prev,
        [key]: {
          ...line,
          taxRateIds: has ? line.taxRateIds.filter((id) => id !== taxRateId) : [...line.taxRateIds, taxRateId],
        },
      };
    });
  }

  function addService() {
    serviceCounterRef.current += 1;
    const key = `svc_${serviceCounterRef.current}_${Date.now()}`;
    const defaultRate = taxRates.find((r) => r.isDefault);
    setServices((prev) => [
      ...prev,
      { key, description: '', unitPrice: null,unit: null, taxRateIds: defaultRate ? [defaultRate.id] : [] },
    ]);
  }
function changeServiceUnit(key: string, value: string) {
  setServices((prev) =>
    prev.map((s) => (s.key === key ? { ...s, unit: value.trim() || null } : s)),
  );
}
  function changeServiceDescription(key: string, value: string) {
    setServices((prev) => prev.map((s) => (s.key === key ? { ...s, description: value } : s)));
  }

  function changeServicePrice(key: string, raw: string) {
    setServices((prev) =>
      prev.map((s) => {
        if (s.key !== key) return s;
        if (raw.trim() === '') return { ...s, unitPrice: null };
        const parsed = Number(raw);
        return { ...s, unitPrice: Number.isFinite(parsed) && parsed >= 0 ? parsed : s.unitPrice };
      }),
    );
  }

  function removeService(key: string) {
    setServices((prev) => prev.filter((s) => s.key !== key));
  }

  function toggleServiceTaxRate(key: string, taxRateId: string) {
    setServices((prev) =>
      prev.map((s) => {
        if (s.key !== key) return s;
        const has = s.taxRateIds.includes(taxRateId);
        return { ...s, taxRateIds: has ? s.taxRateIds.filter((id) => id !== taxRateId) : [...s.taxRateIds, taxRateId] };
      }),
    );
  }

  const cartLines = Object.entries(cart).map(([key, line]) => {
    const lineSubtotal = line.unitPrice * line.quantity;
    const lineRates = taxRates.filter((r) => line.taxRateIds.includes(r.id));
    const lineTaxAmount = round2(lineRates.reduce((sum, r) => sum + lineSubtotal * (r.percentage / 100), 0));
    return { key, ...line, lineSubtotal, lineTaxAmount, lineTotal: round2(lineSubtotal + lineTaxAmount) };
  });

  const serviceLinesWithTotals = services.map((s) => {
    const lineSubtotal = s.unitPrice ?? 0;
    const lineRates = taxRates.filter((r) => s.taxRateIds.includes(r.id));
    const lineTaxAmount = round2(lineRates.reduce((sum, r) => sum + lineSubtotal * (r.percentage / 100), 0));
    return { ...s, lineSubtotal, lineTaxAmount, lineTotal: round2(lineSubtotal + lineTaxAmount) };
  });

  const subtotal =
    cartLines.reduce((sum, l) => sum + l.lineSubtotal, 0) +
    serviceLinesWithTotals.reduce((sum, s) => sum + s.lineSubtotal, 0);
  const taxAmount = round2(
    cartLines.reduce((sum, l) => sum + l.lineTaxAmount, 0) +
      serviceLinesWithTotals.reduce((sum, s) => sum + s.lineTaxAmount, 0),
  );
  const total = subtotal + taxAmount;

  const hasEmptyServicePrice = services.some((s) => s.unitPrice === null);
  const hasEmptyServiceDescription = services.some((s) => !s.description.trim());
  const nothingLeft = cartLines.length === 0 && services.length === 0;

  async function handleSave() {
    if (nothingLeft) {
      setError('An invoice needs at least one item or service.');
      return;
    }
    if (hasWorkshopRms && (hasEmptyServicePrice || hasEmptyServiceDescription)) {
      setError('Enter a description and price for every service (use 0 if free).');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required to edit an issued invoice.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const productItems = cartLines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        locationId: line.locationId,
        unitPrice: line.unitPrice,
        unit: line.unit ?? undefined,
        taxRateIds: line.taxRateIds,
      }));
      const serviceItems = hasWorkshopRms
        ? services
            .filter((s) => s.description.trim() && s.unitPrice !== null)
            .map((s) => ({
              description: s.description.trim(),
              quantity: 1,
              unit: s.unit ?? undefined,   
              unitPrice: s.unitPrice as number,
              taxRateIds: s.taxRateIds,
            }))
        : [];

      const res = await apiFetch(`/invoices/${params.id}/edit`, {
        method: 'PATCH',
        body: JSON.stringify({
          items: [...productItems, ...serviceItems],
          dueDate: dueDate || undefined,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to save changes (${res.status})`);
      }
      router.push(`/sales/invoices/${params.id}`);
    } catch (e: any) {
      setError(e.message || 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push(`/sales/invoices/${params.id}`)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to invoice
          </button>
          <h1 className="text-xl sm:text-2xl font-bold">
            Edit {invoiceNumber ?? 'Invoice'}
          </h1>
          <p className="text-xs text-gray-500">
            {customerName ?? 'No customer'}
            {vehicleLabel ? ` · ${vehicleLabel}` : ''}
          </p>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500 p-6 max-w-5xl mx-auto">Loading...</p>}
      {loadError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 m-6 max-w-5xl mx-auto">
          {loadError}
        </p>
      )}

      {!loading && !loadError && (
        <div className="max-w-5xl mx-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6">
          <ProductSearch
            query={query}
            setQuery={setQuery}
            results={results}
            searching={searching}
            locations={locations}
            locationFilter={locationFilter}
            onSelectLocationFilter={selectLocationFilter}
            onAddToCart={addToCart}
            posModeEnabled={posPricingEnabled}
          />

          <div className="border-2 border-gray-300 rounded-md p-4 h-fit">
            <div className="mb-3">
              <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <CalendarClock size={12} strokeWidth={2} />
                Due date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
              />
            </div>

            {/* Reason for edit — required, sent as dto.reason and shown
                later in the invoice detail page's Edit History list. */}
            <div className="mb-3">
              <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <MessageSquareText size={12} strokeWidth={2} />
                Reason for edit
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="e.g. Customer requested one more oil filter"
className={`w-full border-2 rounded-md p-2 text-sm outline-none resize-none focus:border-black ${
  !reason.trim() ? 'border-red-300' : 'border-gray-300'
}`}
              />
            </div>

            {cartLines.length === 0 && services.length === 0 && (
              <p className="text-sm text-gray-400">No items on this invoice</p>
            )}

            <div className="flex flex-col divide-y divide-gray-200">
              {cartLines.map((line) => {
                const available = stockAtLineLocation(line);
                const editing = editingPriceKey === line.key;
                return (
                  <div key={line.key} className="flex flex-col gap-2 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{line.product.name}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {editing ? (
                            <div className="flex items-center gap-1 bg-white border-2 border-black rounded-md pl-2 pr-1 py-1">
                              <span className="text-xs text-gray-400">Rp</span>
                              <input
                                type="number"
                                min={0}
                                autoFocus
                                value={line.unitPrice}
                                onChange={(e) => changeUnitPrice(line.key, e.target.value)}
                                onBlur={() => setEditingPriceKey(null)}
                                onKeyDown={(e) => e.key === 'Enter' && setEditingPriceKey(null)}
                                className="w-20 text-xs outline-none"
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingPriceKey(line.key)}
                              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:border-black hover:bg-gray-50"
                            >
                              <Pencil size={10} strokeWidth={2} className="text-gray-400" />
                              {formatIDR(line.unitPrice)}
                            </button>
                          )}
<span className="text-xs text-gray-400">
  × {line.quantity}
  {line.unit ? ` ${line.unit}` : ''} = <span className="font-medium text-gray-700">{formatIDR(line.lineSubtotal)}</span>
</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => changeQty(line.key, -1)} className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-gray-100">
                          <Minus size={14} strokeWidth={2} />
                        </button>
                        <span className="w-5 text-center text-sm">{line.quantity}</span>
                        <button
                          onClick={() => changeQty(line.key, 1)}
                          disabled={!posPricingEnabled && line.quantity >= available}
                          className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-40"
                        >
                          <Plus size={14} strokeWidth={2} />
                        </button>
                        <button onClick={() => removeFromCart(line.key)} className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-red-50 hover:border-red-300 text-red-600">
                          <Trash2 size={14} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                    {taxRates.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Percent size={10} strokeWidth={2} className="text-gray-400" />
                        {taxRates.map((rate) => (
                          <label key={rate.id} className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                            <input type="checkbox" checked={line.taxRateIds.includes(rate.id)} onChange={() => toggleLineTaxRate(line.key, rate.id)} className="w-3.5 h-3.5 accent-black" />
                            {rate.name} ({rate.percentage}%)
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {hasWorkshopRms && (
              <div className="mt-3 pt-3 border-t-2 border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                    <Wrench size={12} strokeWidth={2} /> Services
                  </span>
                  <button onClick={addService} className="text-xs px-2 py-1 rounded-md border border-gray-300 hover:border-black hover:bg-gray-50">
                    + Add service
                  </button>
                </div>
                <div className="flex flex-col divide-y divide-gray-200">
                  {services.map((s) => {
                    const priceMissing = s.unitPrice === null;
                    return (
                      <div key={s.key} className="flex flex-col gap-2 py-2.5">
                        <div className="flex items-start gap-2">
                          <textarea
                            value={s.description}
                            onChange={(e) => changeServiceDescription(s.key, e.target.value)}
                            rows={2}
                            placeholder="What service was done?"
                            className="flex-1 border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black resize-none"
                          />
                          <button onClick={() => removeService(s.key)} className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-red-50 hover:border-red-300 text-red-600 shrink-0">
                            <X size={14} strokeWidth={2} />
                          </button>
                        </div>
                        <div className={`flex items-center gap-1 border-2 rounded-md pl-2 pr-1 py-1 w-fit ${priceMissing ? 'border-red-300' : 'border-gray-300'}`}>
                          <span className="text-xs text-gray-400">Rp</span>
                          <input
                            type="number"
                            min={0}
                            value={s.unitPrice ?? ''}
                            onChange={(e) => changeServicePrice(s.key, e.target.value)}
                            placeholder="0"
                            className="w-24 text-xs outline-none"
                          />
                        </div>
                        <input
  type="text"
  value={s.unit ?? ''}
  onChange={(e) => changeServiceUnit(s.key, e.target.value)}
  placeholder="Unit (optional)"
  className="w-28 border-2 border-gray-300 rounded-md px-2 py-1 text-xs outline-none focus:border-black mt-2"
/>
                        {taxRates.length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <Percent size={10} strokeWidth={2} className="text-gray-400" />
                            {taxRates.map((rate) => (
                              <label key={rate.id} className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                                <input type="checkbox" checked={s.taxRateIds.includes(rate.id)} onChange={() => toggleServiceTaxRate(s.key, rate.id)} className="w-3.5 h-3.5 accent-black" />
                                {rate.name} ({rate.percentage}%)
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="border-t-2 border-gray-300 mt-3 pt-3 space-y-1">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span>
                <span>{formatIDR(subtotal)}</span>
              </div>
              {taxAmount > 0 && (
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Tax</span>
                  <span>{formatIDR(taxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold pt-1">
                <span>Total</span>
                <span>{formatIDR(total)}</span>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || nothingLeft || !reason.trim()}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-black text-white rounded-md p-3 text-sm font-semibold disabled:bg-gray-300"
            >
              <Save size={16} strokeWidth={2} />
              {saving ? 'Saving...' : 'Save changes'}
            </button>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm mt-3">
                <AlertCircle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}