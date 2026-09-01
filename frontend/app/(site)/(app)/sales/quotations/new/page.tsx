// app/(app)/sales/quotations/new/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FileText, ShoppingCart } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { ProductSearch } from '@/app/components/invoices/ProductSearch';
import { QuotationCartPanel } from '@/app/components/quotations/QuotationCartPanel';
import {
  CartLine,
  Customer,
  DiscountType,
  LocationOption,
  ProductSearchResult,
  ServiceLine,
  TaxRate,
} from '@/app/components/quotations/types';

const SEARCH_DEBOUNCE_MS = 300;
const AUTOSAVE_DEBOUNCE_MS = 1000;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Computes the discount amount for one line given its subtotal and the
// line's own discount settings. FIXED is clamped to the subtotal so a
// mistyped discount can never push a line negative.
function lineDiscountAmount(
  lineSubtotal: number,
  discountType: DiscountType | null,
  discountValue: number | null,
): number {
  if (discountType === 'PERCENTAGE') return round2(lineSubtotal * ((discountValue ?? 0) / 100));
  if (discountType === 'FIXED') return round2(Math.min(discountValue ?? 0, lineSubtotal));
  return 0;
}

// A service line only becomes a real item once it has both a description
// and a price — buildPayload() filters on exactly that (unitPrice !== null).
// This gate has to match that filter exactly: if it's looser (e.g. treats
// a bare description as "saveable"), autosave fires while the service is
// still incomplete, buildPayload() drops it, and a DRAFT gets created (or
// PATCHed) with items: [] even though something is visibly in the cart.
function hasSaveableContent(cart: Record<string, CartLine>, services: ServiceLine[]): boolean {
  return (
    Object.keys(cart).length > 0 ||
    services.some((s) => s.description.trim() && s.unitPrice !== null)
  );
}

export default function QuotationFormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDraftId = searchParams.get('draftId');

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  // Governs whether staff can type a custom price per line, or must use
  // each product's catalog sellingPrice. Same org-level flag the invoice
  // module reads (Settings → Invoice Pricing) — LineItemPricingService
  // ignores any submitted unitPrice when this is false, so the cart's
  // price box only makes sense to show when it's true.
  const [posPricingEnabled, setPosPricingEnabled] = useState<boolean>(false);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [validUntil, setValidUntil] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState('');

  // --- product search (mirrors invoices/new) ---
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locationFilter, setLocationFilter] = useState<LocationOption | null>(null);

  // --- cart ---
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);

  // --- free-text service lines ---
  const [services, setServices] = useState<ServiceLine[]>([]);
  const serviceCounterRef = useRef(0);

  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(urlDraftId));

  const [currentDraftId, setCurrentDraftId] = useState<string | null>(urlDraftId);

  const skipAutosaveRef = useRef(false);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedDraftIdRef = useRef<string | null | undefined>(undefined);
  const savedRef = useRef(false);

  const cartPanelRef = useRef<HTMLDivElement>(null);
  function scrollToCart() {
    cartPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const cartRef = useRef(cart);
  const servicesRef = useRef(services);
  const customerRef = useRef(customer);
  const validUntilRef = useRef(validUntil);
  const termsAndConditionsRef = useRef(termsAndConditions);
  useEffect(() => {
    cartRef.current = cart;
    servicesRef.current = services;
    customerRef.current = customer;
    validUntilRef.current = validUntil;
    termsAndConditionsRef.current = termsAndConditions;
  }, [cart, services, customer, validUntil, termsAndConditions]);

  useEffect(() => {
    (async () => {
      const [locRes, taxRes, settingsRes] = await Promise.all([
        apiFetch('/locations'),
        apiFetch('/organization/tax-rates'),
        apiFetch('/organization/settings'),
      ]);
      if (locRes.ok) {
        const data: LocationOption[] = await locRes.json();
        setLocations(data);
      }
      if (taxRes.ok) {
        const rates = await taxRes.json();
        setTaxRates(
          rates
            .filter((r: any) => !r.archivedAt)
            .map((r: any) => ({
              id: r.id,
              name: r.name,
              percentage: r.percentage,
              isDefault: !!r.isDefault,
            })),
        );
      }
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        setPosPricingEnabled(!!settings.posPricingEnabled);
      }
    })();
  }, [urlDraftId]);

  function resetFormState() {
    setCustomer(null);
    setValidUntil('');
    setTermsAndConditions('');
    setServices([]);
    setCart({});
    setQuery('');
    setResults([]);
    setCurrentDraftId(null);
  }

  async function loadDraftById(id: string) {
    setLoading(true);
    const res = await apiFetch(`/sales-quotations/${id}`);
    if (res.ok) {
      const q = await res.json();
      setCustomer(q.customer ? { id: q.customerId, ...q.customer } : null);
      setValidUntil(q.validUntil ? q.validUntil.slice(0, 10) : '');
      setTermsAndConditions(q.termsAndConditions ?? '');

      const restoredCart: Record<string, CartLine> = {};
      const restoredServices: ServiceLine[] = [];

      for (const item of q.items ?? []) {
        if (item.productId) {
          const itemLocationId = item.locationId ?? q.locationId ?? '';
          const key = `${item.productId}__${itemLocationId}`;
          restoredCart[key] = {
            product: {
              id: item.productId,
              name: item.product?.name ?? '',
              sku: item.product?.sku ?? null,
              barcode: item.product?.barcode ?? null,
              sellingPrice: Number(item.unitPrice),
              unit: item.product?.unit ?? item.unit ?? null,
              stockByLocation: [],
            },
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            unit: item.unit ?? item.product?.unit ?? null,
            locationId: itemLocationId,
            locationName: item.location?.name ?? '',
            taxRateIds: (item.taxes ?? [])
              .map((t: { taxRateId: string | null }) => t.taxRateId)
              .filter((tid: string | null): tid is string => !!tid),
            discountType: item.discountType ?? null,
            discountValue: item.discountValue != null ? Number(item.discountValue) : null,
          };
        } else {
          serviceCounterRef.current += 1;
          restoredServices.push({
            key: item.id ?? `svc_${serviceCounterRef.current}_${Date.now()}`,
            description: item.description ?? '',
            unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
            unit: item.unit ?? null,
            taxRateIds: (item.taxes ?? [])
              .map((t: { taxRateId: string | null }) => t.taxRateId)
              .filter((tid: string | null): tid is string => !!tid),
            discountType: item.discountType ?? null,
            discountValue: item.discountValue != null ? Number(item.discountValue) : null,
          });
        }
      }

      skipAutosaveRef.current = true;
      setCart(restoredCart);
      setServices(restoredServices);
      setCurrentDraftId(id);
    } else {
      setError('Could not load this draft.');
    }
    setLoading(false);
  }

  useEffect(() => {
    if (urlDraftId === loadedDraftIdRef.current) return;
    loadedDraftIdRef.current = urlDraftId;
    if (urlDraftId) {
      loadDraftById(urlDraftId);
    } else {
      resetFormState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDraftId]);

  useEffect(() => {
    if (!query.trim() && !locationFilter) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      performSearch(query, locationFilter);
    }, SEARCH_DEBOUNCE_MS);
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
      const params = new URLSearchParams({ q: q.trim() });
      if (loc) params.set('locationId', loc.id);
      const res = await apiFetch(`/products/search-for-invoice?${params.toString()}`);
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

  function cartKey(productId: string, locId: string) {
    return `${productId}__${locId}`;
  }

  function stockAtLineLocation(line: CartLine): number {
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
      if (nextQty > resolvedTarget.quantity) return prev;
      const defaultRate = taxRates.find((r) => r.isDefault);
      return {
        ...prev,
        [key]: {
          product,
          quantity: nextQty,
          unitPrice: existing?.unitPrice ?? product.sellingPrice ?? 0,
          unit: existing?.unit ?? product.unit ?? null,
          locationId: resolvedTarget.locationId,
          locationName: resolvedTarget.locationName,
          taxRateIds: existing?.taxRateIds ?? (defaultRate ? [defaultRate.id] : []),
          discountType: existing?.discountType ?? null,
          discountValue: existing?.discountValue ?? null,
        },
      };
    });
  }

  function changeQty(key: string, delta: number) {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      const nextQty = Number(line.quantity) + delta;
      if (nextQty <= 0) {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      }
      const available = stockAtLineLocation(line);
      if (nextQty > available) return prev;
      return { ...prev, [key]: { ...line, quantity: nextQty } };
    });
  }

  function changeUnitPrice(key: string, rawValue: string) {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      const parsed = Number(rawValue);
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
          taxRateIds: has
            ? line.taxRateIds.filter((id) => id !== taxRateId)
            : [...line.taxRateIds, taxRateId],
        },
      };
    });
  }

  // Per-line discount setter. discountType === null clears the
  // discount entirely (back to "None" in the UI).
  function changeLineDiscount(key: string, discountType: DiscountType | null, rawValue?: string) {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      if (discountType === null) return { ...prev, [key]: { ...line, discountType: null, discountValue: null } };
      const parsed = Number(rawValue);
      const nextValue = Number.isFinite(parsed) && parsed >= 0 ? parsed : (line.discountValue ?? 0);
      return { ...prev, [key]: { ...line, discountType, discountValue: nextValue } };
    });
  }

  function changeServiceDiscount(key: string, discountType: DiscountType | null, rawValue?: string) {
    setServices((prev) =>
      prev.map((s) => {
        if (s.key !== key) return s;
        if (discountType === null) return { ...s, discountType: null, discountValue: null };
        const parsed = Number(rawValue);
        const nextValue = Number.isFinite(parsed) && parsed >= 0 ? parsed : (s.discountValue ?? 0);
        return { ...s, discountType, discountValue: nextValue };
      }),
    );
  }

  // "Apply to all" shortcuts. Tax stays modeled per-line internally
  // (as agreed) — this just fans one toggle out to every existing line
  // instead of making the user click each checkbox individually.
  function applyTaxToAllLines(taxRateId: string, checked: boolean) {
    setCart((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        const line = next[key];
        const has = line.taxRateIds.includes(taxRateId);
        if (checked && !has) next[key] = { ...line, taxRateIds: [...line.taxRateIds, taxRateId] };
        if (!checked && has) next[key] = { ...line, taxRateIds: line.taxRateIds.filter((id) => id !== taxRateId) };
      }
      return next;
    });
    setServices((prev) =>
      prev.map((s) => {
        const has = s.taxRateIds.includes(taxRateId);
        if (checked && !has) return { ...s, taxRateIds: [...s.taxRateIds, taxRateId] };
        if (!checked && has) return { ...s, taxRateIds: s.taxRateIds.filter((id) => id !== taxRateId) };
        return s;
      }),
    );
  }

  function applyDiscountToAllLines(discountType: DiscountType | null, value: number) {
    setCart((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = { ...next[key], discountType, discountValue: discountType ? value : null };
      }
      return next;
    });
    setServices((prev) => prev.map((s) => ({ ...s, discountType, discountValue: discountType ? value : null })));
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
        taxRateIds: defaultRate ? [defaultRate.id] : [],
        discountType: null,
        discountValue: null,
      },
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
        return {
          ...s,
          taxRateIds: has ? s.taxRateIds.filter((id) => id !== taxRateId) : [...s.taxRateIds, taxRateId],
        };
      }),
    );
  }

  // Tax is computed on the post-discount (net) amount, not the raw
  // subtotal — otherwise a 100% discounted line would still carry tax.
  const cartLines = Object.entries(cart).map(([key, line]) => {
    const lineSubtotal = line.unitPrice * line.quantity;
    const discAmt = lineDiscountAmount(lineSubtotal, line.discountType, line.discountValue);
    const netAmount = round2(lineSubtotal - discAmt);
    const lineRates = taxRates.filter((r) => line.taxRateIds.includes(r.id));
    const lineTaxAmount = round2(
      lineRates.reduce((sum, rate) => sum + netAmount * (rate.percentage / 100), 0),
    );
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
    const lineTaxAmount = round2(
      lineRates.reduce((sum, rate) => sum + netAmount * (rate.percentage / 100), 0),
    );
    return {
      ...s,
      lineSubtotal,
      lineDiscountAmount: discAmt,
      netAmount,
      lineTaxAmount,
      lineTotal: round2(netAmount + lineTaxAmount),
    };
  });

  const distinctLocationNames = Array.from(
    new Set(cartLines.map((l) => l.locationName).filter(Boolean)),
  );

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
  const totalLineCount = cartLines.length + serviceLinesWithTotals.length;

  function buildPayload() {
    const productItems = cartLines.map((line) => ({
      productId: line.product.id,
      quantity: Math.round(Number(line.quantity)),
      locationId: line.locationId,
      unitPrice: line.unitPrice,
      unit: line.unit ?? undefined,
      taxRateIds: line.taxRateIds,
      discountType: line.discountType ?? undefined,
      discountValue: line.discountValue ?? undefined,
    }));
    const serviceItems = services
      .filter((s) => s.description.trim() && s.unitPrice !== null)
      .map((s) => ({
        description: s.description.trim(),
        quantity: 1,
        unit: s.unit ?? undefined,
        unitPrice: s.unitPrice as number,
        taxRateIds: s.taxRateIds,
        discountType: s.discountType ?? undefined,
        discountValue: s.discountValue ?? undefined,
      }));
    return {
      locationId: cartLines[0]?.locationId,
      format: 'A4' as const,
      customerId: customer?.id,
      customerName: customer?.name,
      validUntil: validUntil || undefined,
      termsAndConditions: termsAndConditions.trim() || undefined,
      items: [...productItems, ...serviceItems],
    };
  }

  function adoptDraftId(id: string) {
    loadedDraftIdRef.current = id;
    setCurrentDraftId(id);
    window.history.replaceState(null, '', `/sales/quotations/new?draftId=${id}`);
  }

  async function autosaveDraft() {
    if (savedRef.current) return;
    if (!hasSaveableContent(cartRef.current, servicesRef.current)) return;

    const payload = buildPayload();
    try {
      if (currentDraftId) {
        await apiFetch(`/sales-quotations/${currentDraftId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        const res = await apiFetch('/sales-quotations', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const draft = await res.json();
          adoptDraftId(draft.id);
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
    if (!hasSaveableContent(cart, services)) return;

    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = setTimeout(() => {
      autosaveDraft();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, services, customer, validUntil, termsAndConditions]);

  useEffect(() => {
    return () => {
      if (savedRef.current) return;
      if (hasSaveableContent(cartRef.current, servicesRef.current)) {
        autosaveDraftRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit() {
    setError('');
    if (totalLineCount === 0) return;
    if (!customer) {
      setError('Select a customer for this quotation.');
      return;
    }
    const hasEmptyService = services.some((s) => !s.description.trim() || s.unitPrice === null);
    if (hasEmptyService) {
      setError('Enter a description and price for every service (use 0 if free).');
      return;
    }

    setPrinting(true);
    savedRef.current = true;
    try {
      const payload = buildPayload();
      const res = currentDraftId
        ? await apiFetch(`/sales-quotations/${currentDraftId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await apiFetch('/sales-quotations', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        savedRef.current = false;
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      router.push(`/sales/quotations/${body.id}`);
    } catch {
      savedRef.current = false;
      setError('Could not reach the server.');
    } finally {
      setPrinting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white text-black p-6">
        <p className="text-sm text-gray-500">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/sales/quotations')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={20} strokeWidth={2} className="text-gray-700 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold truncate">
                  {currentDraftId ? 'Edit Quotation Draft' : 'New Quotation'}
                </h1>
                <p className="text-xs text-gray-500 truncate">Search items, build and save a quotation</p>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-between sm:justify-end">
              <button
                onClick={() => router.push('/sales/quotations')}
                className="text-sm px-2 sm:px-3 py-2 rounded-md text-gray-600 hover:text-black hover:bg-gray-100 active:bg-gray-200 shrink-0"
              >
                History
              </button>

              <span className="text-sm px-3 py-1.5 rounded-md bg-gray-100 text-gray-500 font-medium">
                A4
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 pb-24 md:pb-6 grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6">
        <ProductSearch
          query={query}
          setQuery={setQuery}
          results={results}
          searching={searching}
          locations={locations}
          locationFilter={locationFilter}
          onSelectLocationFilter={selectLocationFilter}
          onAddToCart={addToCart}
          posModeEnabled={false}
        />

        <div ref={cartPanelRef} className="scroll-mt-24">
          <QuotationCartPanel
            cartLines={cartLines}
            customer={customer}
            setCustomer={setCustomer}
            editingPriceKey={editingPriceKey}
            setEditingPriceKey={setEditingPriceKey}
            changeQty={changeQty}
            onChangeServiceUnit={changeServiceUnit}
            changeUnitPrice={changeUnitPrice}
            removeFromCart={removeFromCart}
            stockAtLineLocation={stockAtLineLocation}
            subtotal={subtotal}
            discount={discount}
            distinctLocationNames={distinctLocationNames}
            validUntil={validUntil}
            onChangeValidUntil={setValidUntil}
            termsAndConditions={termsAndConditions}
            onChangeTermsAndConditions={setTermsAndConditions}
            onSubmit={handleSubmit}
            printing={printing}
            error={error}
            taxRates={taxRates}
            posPricingEnabled={posPricingEnabled}
            onToggleLineTaxRate={toggleLineTaxRate}
            onApplyTaxToAll={applyTaxToAllLines}
            onChangeLineDiscount={changeLineDiscount}
            onChangeServiceDiscount={changeServiceDiscount}
            onApplyDiscountToAll={applyDiscountToAllLines}
            taxAmount={taxAmount}
            total={total}
            services={serviceLinesWithTotals}
            onAddService={addService}
            onChangeServiceDescription={changeServiceDescription}
            onChangeServicePrice={changeServicePrice}
            onRemoveService={removeService}
            onToggleServiceTaxRate={toggleServiceTaxRate}
          />
        </div>
      </div>

      {totalLineCount > 0 && (
        <button
          onClick={scrollToCart}
          className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-black text-white px-4 py-3 flex items-center justify-between shadow-[0_-2px_10px_rgba(0,0,0,0.15)]"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart size={16} strokeWidth={2} />
            {totalLineCount} item{totalLineCount === 1 ? '' : 's'}
          </span>
          <span className="text-sm font-bold">{formatIDR(total)} · Review</span>
        </button>
      )}
    </main>
  );
}