// app/(app)/invoices/[id]/edit/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Save, Minus, Plus, Trash2, Pencil, Percent, Wrench, X, AlertCircle, CalendarClock, MessageSquareText, UserRound } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { ProductSearch } from '@/app/components/invoices/ProductSearch';
import { LineDiscountControl } from '@/app/components/shared/LineDiscountControl';
import {
  CartLine,
  DiscountType,
  Employee,
  InvoiceFormat,
  LocationOption,
  ProductSearchResult,
  ServiceLine,
  TaxRate,
} from '@/app/components/invoices/types';
import { useLanguage } from '@/app/context/LanguageContext';

type RawTaxRate = TaxRate & { archivedAt: string | null };

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Mirrors invoices/new/page.tsx's lineDiscountAmount exactly — FIXED is
// capped at the line's gross subtotal so a mistyped discount can't push
// a single line negative; PERCENTAGE is clamped to 0-100 in the change
// handlers below, not here.
function lineDiscountAmount(
  lineSubtotal: number,
  discountType: DiscountType | null,
  discountValue: number | null,
): number {
  if (discountType === 'PERCENTAGE') return round2(lineSubtotal * ((discountValue ?? 0) / 100));
  if (discountType === 'FIXED') return round2(Math.min(discountValue ?? 0, lineSubtotal));
  return 0;
}

export default function EditIssuedInvoicePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');
  const { t } = useLanguage();

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

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');

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
    async function loadEmployees() {
      const res = await apiFetch('/payroll/employees');
      if (!res.ok) return;
      setEmployees(await res.json());
    }
    loadEmployees();
  }, []);

  useEffect(() => {
    async function loadInvoice() {
      setLoading(true);
      setLoadError('');
      try {
        const res = await apiFetch(`/invoices/${params.id}/edit-detail`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setLoadError(body?.message ?? t('sales.invoiceEdit.failedToLoadInvoice', { status: res.status }));
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
        setEmployeeId(invoice.employeeId ?? '');

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
      sku: item.product?.sku ?? '',
      unit: item.product?.unit ?? '',
      barcode: item.product?.barcode ?? '',
      image: null,
      sellingPrice: Number(item.unitPrice ?? 0),
      stockByLocation: [],
    },
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    locationId,
    unit: item.unit ?? null,
    locationName,
    // FIX — was defaulting to 'PERCENTAGE' with value 0 regardless of
    // whether the line actually had a discount, which fabricated a
    // discountType on lines that never had one. null means "no discount,"
    // matching how addToCart()/new-invoice's restore both treat it.
    discountType: item.discountType ?? null,
    discountValue: item.discountValue != null ? Number(item.discountValue) : null,
    taxRateIds,
    // NEW — floor for changeQty()'s decrement below. The backend now
    // refuses to save a line below its fulfilledQuantity (physical stock
    // already left for that amount), so the stepper enforces the same
    // floor here rather than letting the user hit a save-time error.
    // Requires CartLine to declare `fulfilledQuantity?: number` — see
    // 07-frontend-type-patches.md.
    fulfilledQuantity: item.fulfilledQuantity ?? 0,
  };
} else {
  // FIX — this branch never existed, so restoredServices stayed []
  // forever and setServices([]) below silently wiped every service
  // (labor) line off the invoice the moment it was opened for edit —
  // saving any change then permanently dropped those lines server-side.
  restoredServices.push({
    key: `svc_restored_${item.id}`,
    description: item.description ?? '',
    unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
    unit: item.unit ?? null,
    discountType: item.discountType ?? null,
    discountValue: item.discountValue != null ? Number(item.discountValue) : null,
    taxRateIds,
  });
}
        }
        setCart(restoredCart);
        setServices(restoredServices);
      } catch {
        setLoadError(t('sales.invoiceEdit.serverUnreachable'));
      } finally {
        setLoading(false);
      }
    }
    loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

function addToCart(
  product: ProductSearchResult,
  details: {
    quantity: number;
    unitPrice: number;
    unit: string | null;
    taxRateIds: string[];
    discountType: DiscountType | null;
    discountValue: number | null;
  },
): boolean {
  setError('');
  let target;
  if (locationFilter) {
    target = product.stockByLocation.find((s) => s.locationId === locationFilter.id);
    if (!target || target.quantity <= 0) {
      setError(t('sales.invoiceEdit.stockNotAtLocation', { name: product.name, location: locationFilter.name }));
      return false;
    }
  } else {
    target = [...product.stockByLocation].sort((a, b) => b.quantity - a.quantity)[0];
    if (!target || target.quantity <= 0) {
      setError(t('sales.invoiceEdit.noStockAnywhere', { name: product.name }));
      return false;
    }
  }
  const resolvedTarget = target;
  const key = cartKey(product.id, resolvedTarget.locationId);

  // Still respects real stock on this first add, same as every sibling
  // page — POS mode's overselling allowance only kicks in later, on the
  // stepper for a line already in the cart (see changeQty below).
  const existing = cart[key];
  const nextQty = (existing?.quantity ?? 0) + details.quantity;
  if (!posPricingEnabled && nextQty > resolvedTarget.quantity) {
    setError(t('sales.invoiceEdit.onlyAvailable', { qty: resolvedTarget.quantity, name: product.name, location: resolvedTarget.locationName }));
    return false;
  }

  setCart((prev) => {
    const existing = prev[key];
    return {
      ...prev,
      [key]: {
        product,
        unit: details.unit,
        quantity: nextQty,
        unitPrice: details.unitPrice,
        locationId: resolvedTarget.locationId,
        locationName: resolvedTarget.locationName,
        discountType: details.discountType,
        discountValue: details.discountValue,
        taxRateIds: details.taxRateIds,
        // A newly added line has nothing fulfilled yet, whether or not
        // one already existed with a floor from the restored invoice —
        // if `existing` came from the restored cart it already carries
        // its own fulfilledQuantity forward via the spread-free object
        // literal here, so default to that, not always 0.
        fulfilledQuantity: existing?.fulfilledQuantity ?? 0,
      },
    };
  });
  return true;
}
  function changeQty(key: string, delta: number) {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      const nextQty = line.quantity + delta;
      const floor = line.fulfilledQuantity ?? 0;
      // CHANGED — can't shrink below what's already been fulfilled;
      // physical stock already left for that amount. Mirrors the
      // BadRequestException InvoiceService.editIssuedInvoice() now
      // throws for the same case, but catches it here before the user
      // ever hits Save.
      if (nextQty < floor) return prev;
      if (nextQty <= 0) {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      }
      // FIX — was an unconditional ceiling with no POS bypass, while the
      // "+" button's disabled state (below, in the JSX) already implied
      // one (`disabled={!posPricingEnabled && line.quantity >= available}`).
      // The button looked enabled in POS mode past available stock but
      // silently did nothing — the "sell past stock in POS mode" feature
      // never actually worked. Mirrors CartPanel.tsx's posModeEnabled bypass.
      const available = stockAtLineLocation(line);
      if (!posPricingEnabled && nextQty > available) return prev;
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

  // NEW — this page had no discount UI/handlers at all, even though
  // restored lines could already carry a discount from the original
  // invoice (see loadInvoice() above). Percentage is clamped to 0-100 —
  // unlike invoices/new's changeLineDiscount, which doesn't clamp the
  // upper bound and can drive a line's net amount negative.
  function changeLineDiscount(key: string, discountType: DiscountType | null, rawValue?: string) {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      if (discountType === null) return { ...prev, [key]: { ...line, discountType: null, discountValue: null } };
      const parsed = Number(rawValue);
      const clamped = discountType === 'PERCENTAGE' ? Math.min(parsed, 100) : parsed;
      const nextValue = Number.isFinite(clamped) && clamped >= 0 ? clamped : (line.discountValue ?? 0);
      return { ...prev, [key]: { ...line, discountType, discountValue: nextValue } };
    });
  }

  function changeServiceDiscount(key: string, discountType: DiscountType | null, rawValue?: string) {
    setServices((prev) =>
      prev.map((s) => {
        if (s.key !== key) return s;
        if (discountType === null) return { ...s, discountType: null, discountValue: null };
        const parsed = Number(rawValue);
        const clamped = discountType === 'PERCENTAGE' ? Math.min(parsed, 100) : parsed;
        const nextValue = Number.isFinite(clamped) && clamped >= 0 ? clamped : (s.discountValue ?? 0);
        return { ...s, discountType, discountValue: nextValue };
      }),
    );
  }

function addService() {
  serviceCounterRef.current += 1;
  const key = `svc_${serviceCounterRef.current}_${Date.now()}`;
  const defaultRate = taxRates.find((r) => r.isDefault);
  setServices((prev) => [
    ...prev,
    {
      key,
      description: '',
      unitPrice: null,
      unit: null,
      // FIX — was 'PERCENTAGE'/0, fabricating a discount on every newly
      // added service. null means "no discount."
      discountType: null,
      discountValue: null,
      taxRateIds: defaultRate ? [defaultRate.id] : [],
    },
  ]);
}
function changeServiceUnit(key: string, value: string) {
  setServices((prev) =>
    prev.map((s) => (s.key === key ? { ...s, unit: value === '' ? null : value } : s)),
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

  // FIX — was computing tax on the gross lineSubtotal with no discount
  // netted out at all, unlike invoices/new/page.tsx which explicitly nets
  // the discount out before tax ("otherwise a 100% discounted line would
  // still carry tax"). A discounted line showed/submitted a total ~the
  // discount amount too high.
  const cartLines = Object.entries(cart).map(([key, line]) => {
    const lineSubtotal = line.unitPrice * line.quantity;
    const discAmt = lineDiscountAmount(lineSubtotal, line.discountType, line.discountValue);
    const netAmount = round2(lineSubtotal - discAmt);
    const lineRates = taxRates.filter((r) => line.taxRateIds.includes(r.id));
    const lineTaxAmount = round2(lineRates.reduce((sum, r) => sum + netAmount * (r.percentage / 100), 0));
    return {
      key,
      ...line,
      lineSubtotal,
      lineDiscountAmount: discAmt,
      netAmount,
      lineTaxAmount,
      lineTotal: round2(netAmount + lineTaxAmount),
    };
  });

  const serviceLinesWithTotals = services.map((s) => {
    const lineSubtotal = s.unitPrice ?? 0;
    const discAmt = lineDiscountAmount(lineSubtotal, s.discountType, s.discountValue);
    const netAmount = round2(lineSubtotal - discAmt);
    const lineRates = taxRates.filter((r) => s.taxRateIds.includes(r.id));
    const lineTaxAmount = round2(lineRates.reduce((sum, r) => sum + netAmount * (r.percentage / 100), 0));
    return {
      ...s,
      lineSubtotal,
      lineDiscountAmount: discAmt,
      netAmount,
      lineTaxAmount,
      lineTotal: round2(netAmount + lineTaxAmount),
    };
  });

  const subtotal =
    cartLines.reduce((sum, l) => sum + l.lineSubtotal, 0) +
    serviceLinesWithTotals.reduce((sum, s) => sum + s.lineSubtotal, 0);
  const discount = round2(
    cartLines.reduce((sum, l) => sum + l.lineDiscountAmount, 0) +
      serviceLinesWithTotals.reduce((sum, s) => sum + s.lineDiscountAmount, 0),
  );
  const taxAmount = round2(
    cartLines.reduce((sum, l) => sum + l.lineTaxAmount, 0) +
      serviceLinesWithTotals.reduce((sum, s) => sum + s.lineTaxAmount, 0),
  );
  const total = round2(subtotal - discount + taxAmount);

  const hasEmptyServicePrice = services.some((s) => s.unitPrice === null);
  const hasEmptyServiceDescription = services.some((s) => !s.description.trim());
  const nothingLeft = cartLines.length === 0 && services.length === 0;

  async function handleSave() {
    if (nothingLeft) {
      setError(t('sales.invoiceEdit.needAtLeastOneItem'));
      return;
    }
    if (hasWorkshopRms && (hasEmptyServicePrice || hasEmptyServiceDescription)) {
      setError(t('sales.invoiceEdit.emptyServiceError'));
      return;
    }
    if (!reason.trim()) {
      setError(t('sales.invoiceEdit.reasonRequired'));
      return;
    }

    setSaving(true);
    setError('');
    try {
      // FIX — both item types were missing discountType/discountValue
      // entirely, so saving any change to a discounted invoice silently
      // dropped the discount, permanently inflating the invoice total.
      const productItems = cartLines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        locationId: line.locationId,
        unitPrice: line.unitPrice,
        unit: line.unit ?? undefined,
        taxRateIds: line.taxRateIds,
        discountType: line.discountType ?? undefined,
        discountValue: line.discountValue ?? undefined,
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
              discountType: s.discountType ?? undefined,
              discountValue: s.discountValue ?? undefined,
            }))
        : [];

      const payload = {
        items: [...productItems, ...serviceItems],
        dueDate: dueDate || undefined,
        employeeId: employeeId || null,
        reason: reason.trim(),
      };
      let res = await apiFetch(`/invoices/${params.id}/edit`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        const confirmed =
          body?.error === 'STOCK_CONFIRMATION_REQUIRED' && window.confirm(body.message as string);
        if (!confirmed) {
          setSaving(false);
          return;
        }
        res = await apiFetch(`/invoices/${params.id}/edit`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, confirmOversell: true }),
        });
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || t('sales.invoiceEdit.failedToSaveChanges', { status: res.status }));
      }
      router.push(`/sales/invoices/${params.id}`);
    } catch (e: any) {
      setError(e.message || t('sales.invoiceEdit.couldNotSaveChanges'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-3 sm:px-6 py-3 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-xl sm:text-2xl font-bold truncate">
            {t('sales.invoiceEdit.editTitle', { number: invoiceNumber ?? t('sales.invoiceEdit.invoiceFallback') })}
          </h1>
          <p className="text-xs text-gray-500 truncate">
            {customerName ?? t('sales.invoiceEdit.noCustomer')}
            {vehicleLabel ? ` · ${vehicleLabel}` : ''}
          </p>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500 p-4 sm:p-6 max-w-5xl mx-auto">{t('common.loading')}</p>}
      {loadError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 m-4 sm:m-6 max-w-5xl mx-auto">
          {loadError}
        </p>
      )}

      {!loading && !loadError && (
        <div className="max-w-5xl mx-auto p-3 sm:p-6 grid grid-cols-1 md:grid-cols-[1fr_360px] gap-4 sm:gap-6">
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
            taxRates={taxRates}
          />

          <div className="border-2 border-gray-300 rounded-md p-3 sm:p-4 h-fit">
            <div className="mb-3">
              <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <CalendarClock size={12} strokeWidth={2} />
                {t('sales.invoiceEdit.dueDateLabel')}
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
              />
            </div>

            {employees.length > 0 && (
              <div className="mb-3">
                <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <UserRound size={12} strokeWidth={2} />
                  {t('sales.invoiceEdit.employeeLabel')}
                </label>
                <select
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
                >
                  <option value="">{t('sales.invoiceEdit.noEmployee')}</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.position ? ` — ${e.position}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Reason for edit — required, sent as dto.reason and shown
                later in the invoice detail page's Edit History list. */}
            <div className="mb-3">
              <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <MessageSquareText size={12} strokeWidth={2} />
                {t('sales.invoiceEdit.reasonLabel')}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder={t('sales.invoiceEdit.reasonPlaceholder')}
className={`w-full border-2 rounded-md p-2 text-sm outline-none resize-none focus:border-black ${
  !reason.trim() ? 'border-red-300' : 'border-gray-300'
}`}
              />
            </div>

            {cartLines.length === 0 && services.length === 0 && (
              <p className="text-sm text-gray-400">{t('sales.invoiceEdit.noItems')}</p>
            )}

            <div className="flex flex-col divide-y divide-gray-200">
              {cartLines.map((line) => {
                const available = stockAtLineLocation(line);
                const editing = editingPriceKey === line.key;
                const floor = line.fulfilledQuantity ?? 0;
                return (
                  <div key={line.key} className="flex flex-col gap-2 py-2.5">
                    {/* Wraps on very narrow screens instead of squeezing
                        the price/qty-summary text against the stepper
                        controls — name + price/summary can now drop to
                        their own line above the steppers if needed. */}
                    <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{line.product.name}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {/* FIX — was unconditionally editable regardless
                              of POS pricing mode, unlike CartPanel.tsx's
                              `priceEditable = posModeEnabled` gate used by
                              the create flow. An org that locks prices
                              outside POS mode lost that guarantee the
                              moment a document reached this edit flow. */}
                          {posPricingEnabled ? (
                            editing ? (
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
                            )
                          ) : (
                            <span className="text-xs text-gray-500">{formatIDR(line.unitPrice)}</span>
                          )}
<span className="text-xs text-gray-400">
  × {line.quantity}
  {line.unit ? ` ${line.unit}` : ''} = <span className="font-medium text-gray-700">{formatIDR(line.lineSubtotal)}</span>
</span>
                        </div>
                        {/* NEW — surfaces why the stepper below might
                            refuse to go lower than expected. */}
                        {floor > 0 && (
                          <p className="text-xs text-amber-700 mt-1">
                            {t(floor === 1 ? 'sales.invoiceEdit.unitFulfilledOne' : 'sales.invoiceEdit.unitFulfilledOther', { count: floor })}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => changeQty(line.key, -1)}
                          disabled={line.quantity <= floor}
                          className="w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-40"
                        >
                          <Minus size={14} strokeWidth={2} />
                        </button>
                        <span className="w-5 text-center text-sm">{line.quantity}</span>
                        <button
                          onClick={() => changeQty(line.key, 1)}
                          disabled={!posPricingEnabled && line.quantity >= available}
                          className="w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-40"
                        >
                          <Plus size={14} strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => removeFromCart(line.key)}
                          className="w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-red-50 hover:border-red-300 text-red-600"
                        >
                          <Trash2 size={14} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                    <LineDiscountControl
                      discountType={line.discountType}
                      discountValue={line.discountValue}
                      discountAmount={line.lineDiscountAmount}
                      onChange={(type, raw) => changeLineDiscount(line.key, type, raw)}
                    />
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
                    <Wrench size={12} strokeWidth={2} /> {t('sales.invoiceEdit.servicesLabel')}
                  </span>
                  <button onClick={addService} className="text-xs px-2 py-1 rounded-md border border-gray-300 hover:border-black hover:bg-gray-50">
                    {t('sales.invoiceEdit.addService')}
                  </button>
                </div>
                <div className="flex flex-col divide-y divide-gray-200">
                  {serviceLinesWithTotals.map((s) => {
                    const priceMissing = s.unitPrice === null;
                    return (
                      <div key={s.key} className="flex flex-col gap-2 py-2.5">
                        <div className="flex items-start gap-2">
                          <textarea
                            value={s.description}
                            onChange={(e) => changeServiceDescription(s.key, e.target.value)}
                            rows={2}
                            placeholder={t('sales.invoiceEdit.serviceDescriptionPlaceholder')}
                            className="flex-1 min-w-0 border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black resize-none"
                          />
                          <button onClick={() => removeService(s.key)} className="w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-red-50 hover:border-red-300 text-red-600 shrink-0">
                            <X size={14} strokeWidth={2} />
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
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
                            placeholder={t('sales.invoiceEdit.unitPlaceholder')}
                            className="w-28 border-2 border-gray-300 rounded-md px-2 py-1 text-xs outline-none focus:border-black"
                          />
                        </div>
                        <LineDiscountControl
                          discountType={s.discountType}
                          discountValue={s.discountValue}
                          discountAmount={s.lineDiscountAmount}
                          onChange={(type, raw) => changeServiceDiscount(s.key, type, raw)}
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
                <span>{t('common.subtotal')}</span>
                <span>{formatIDR(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-sm text-gray-600">
                  <span>{t('sales.invoiceEdit.discount')}</span>
                  <span>−{formatIDR(discount)}</span>
                </div>
              )}
              {taxAmount > 0 && (
                <div className="flex justify-between text-sm text-gray-600">
                  <span>{t('sales.invoiceEdit.tax')}</span>
                  <span>{formatIDR(taxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold pt-1">
                <span>{t('common.total')}</span>
                <span>{formatIDR(total)}</span>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || nothingLeft || !reason.trim()}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-black text-white rounded-md p-3 text-sm font-semibold disabled:bg-gray-300"
            >
              <Save size={16} strokeWidth={2} />
              {saving ? t('common.saving') : t('sales.invoiceEdit.saveChanges')}
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