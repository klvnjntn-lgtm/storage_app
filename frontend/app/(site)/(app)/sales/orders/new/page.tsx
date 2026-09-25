'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { FileText, ShoppingCart } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { ProductSearch } from '@/app/components/invoices/ProductSearch';
import { SalesOrderCartPanel } from '@/app/components/sales-orders/SalesOrderCartPanel';
import { useLanguage } from '@/app/context/LanguageContext';
import {
  CartLine,
  Customer,
  DiscountType,
  LocationOption,
  ProductSearchResult,
  ServiceLine,
  TaxRate,
} from '@/app/components/sales-orders/types';


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

// Also true for a bare customer selection with an empty cart — exiting
// the page (tab close, refresh, navigating away) should still leave a
// draft behind so that pick isn't lost, not just once there's a line item.
function hasSaveableContent(
  cart: Record<string, CartLine>,
  services: ServiceLine[],
  customer: Customer | null,
): boolean {
  return Object.keys(cart).length > 0 || services.some((s) => s.description.trim()) || !!customer;
}

// FIX — useSearchParams() requires a Suspense boundary for static
// prerendering, or `next build` fails outright. See login/page.tsx.
export default function SalesOrderFormPage() {
  return (
    <Suspense fallback={null}>
      <SalesOrderFormPageInner />
    </Suspense>
  );
}

function SalesOrderFormPageInner() {
  const router = useRouter();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const urlDraftId = searchParams.get('draftId');

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);

  // Format is A4-only, same as quotations — no toggle, just a constant
  // baked into buildPayload().
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerPoNumber, setCustomerPoNumber] = useState('');
  const [orderDate, setOrderDate] = useState('');

  // --- product search (mirrors invoices/new & quotations/new) ---
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

  const [saving, setSaving] = useState(false);
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
  const customerPoNumberRef = useRef(customerPoNumber);
  const orderDateRef = useRef(orderDate);
  useEffect(() => {
    cartRef.current = cart;
    servicesRef.current = services;
    customerRef.current = customer;
    customerPoNumberRef.current = customerPoNumber;
    orderDateRef.current = orderDate;
  }, [cart, services, customer, customerPoNumber, orderDate]);

  useEffect(() => {
    (async () => {
      const [locRes, taxRes] = await Promise.all([
        apiFetch('/locations'),
        apiFetch('/tax-rates'),
      ]);
      if (locRes.ok) {
        const data: LocationOption[] = await locRes.json();
        setLocations(data);
      }
      if (taxRes.ok) {
        const rates = await taxRes.json();
        setTaxRates(
          rates.map((r: any) => ({
            id: r.id,
            name: r.name,
            percentage: r.percentage,
            isDefault: !!r.isDefault,
          })),
        );
      }
    })();
  }, [urlDraftId]);

  function resetFormState() {
    setCustomer(null);
    setCustomerPoNumber('');
    setOrderDate('');
    setServices([]);
    setCart({});
    setQuery('');
    setResults([]);
    setCurrentDraftId(null);
  }

  async function loadDraftById(id: string) {
    setLoading(true);
    const res = await apiFetch(`/sales-orders/${id}`);
    if (res.ok) {
      const o = await res.json();

      // getDraftOrThrow on the backend refuses to update anything that's
      // left DRAFT — bounce to the read-only detail view instead of
      // letting someone edit a confirmed/cancelled order here.
      if (o.status !== 'DRAFT') {
        router.replace(`/sales/orders/${id}`);
        return;
      }

      setCustomer(o.customer ? { id: o.customerId, ...o.customer } : null);
      setCustomerPoNumber(o.customerPoNumber ?? '');
      setOrderDate(o.orderDate ? String(o.orderDate).slice(0, 10) : '');

      const restoredCart: Record<string, CartLine> = {};
      const restoredServices: ServiceLine[] = [];

      for (const item of o.items ?? []) {
        if (item.productId) {
          const itemLocationId = item.locationId ?? o.locationId ?? '';
          const key = `${item.productId}__${itemLocationId}`;
          restoredCart[key] = {
            product: {
              id: item.productId,
              name: item.product?.name ?? '',
              sku: item.product?.sku ?? null,
              unit: item.product?.unit ?? item.unit ?? null,
              barcode: item.product?.barcode ?? null,
              image: null,
              sellingPrice: Number(item.unitPrice),
              stockByLocation: [],
            },
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            unit: item.unit ?? null,
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
      setError(t('sales.ordersNew.couldNotLoadDraft'));
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

  // Product search — unchanged from invoices/quotations.
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
        setError(t('sales.ordersNew.notStockedAt', { product: product.name, location: locationFilter.name }));
        return false;
      }
    } else {
      target = [...product.stockByLocation].sort((a, b) => b.quantity - a.quantity)[0];
      if (!target || target.quantity <= 0) {
        setError(t('sales.ordersNew.noStockAnywhere', { product: product.name }));
        return false;
      }
    }

    const resolvedTarget = target;
    const key = cartKey(product.id, resolvedTarget.locationId);
    const existing = cart[key];
    const nextQty = (existing?.quantity ?? 0) + details.quantity;
    if (nextQty > resolvedTarget.quantity) {
      setError(
        t('sales.ordersNew.onlyAvailable', {
          qty: resolvedTarget.quantity,
          product: product.name,
          location: resolvedTarget.locationName,
        }),
      );
      return false;
    }

    setCart((prev) => ({
      ...prev,
      [key]: {
        product,
        quantity: nextQty,
        unitPrice: details.unitPrice,
        unit: details.unit,
        locationId: resolvedTarget.locationId,
        locationName: resolvedTarget.locationName,
        taxRateIds: details.taxRateIds,
        discountType: details.discountType,
        discountValue: details.discountValue,
      },
    }));
    return true;
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
  // FIX — PERCENTAGE was unclamped above 100, letting a mistyped
  // discount (e.g. 500) drive netAmount negative and submit a negative
  // line/document total with no client-side rejection.
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

  // "Apply to all" shortcuts. Tax stays modeled per-line internally —
  // this just fans one toggle out to every existing line instead of
  // making the user click each checkbox individually.
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

  function changeServiceUnit(key: string, value: string) {
    setServices((prev) =>
      prev.map((s) => (s.key === key ? { ...s, unit: value.trim() || null } : s)),
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
      quantity: line.quantity,
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
        unitPrice: s.unitPrice as number,
        unit: s.unit ?? undefined,
        taxRateIds: s.taxRateIds,
        discountType: s.discountType ?? undefined,
        discountValue: s.discountValue ?? undefined,
      }));
    return {
      locationId: cartLines[0]?.locationId,
      format: 'A4' as const,
      customerId: customer?.id,
      customerName: customer?.name,
      customerPoNumber: customerPoNumber.trim() || undefined,
      orderDate: orderDate || undefined,
      items: [...productItems, ...serviceItems],
    };
  }

  function adoptDraftId(id: string) {
    loadedDraftIdRef.current = id;
    setCurrentDraftId(id);
    window.history.replaceState(null, '', `/sales/orders/new?draftId=${id}`);
  }

  // useKeepalive is set from the pagehide handler below, so the request
  // can outlive the page (tab close/refresh/navigating away) instead of
  // being cancelled mid-flight like a normal fetch would be.
  async function autosaveDraft(useKeepalive = false) {
    if (savedRef.current) return;
    if (!hasSaveableContent(cartRef.current, servicesRef.current, customerRef.current)) return;

    const payload = buildPayload();
    try {
      if (currentDraftId) {
        await apiFetch(`/sales-orders/${currentDraftId}`, {
          method: 'PATCH',
          keepalive: useKeepalive,
          body: JSON.stringify(payload),
        });
      } else {
        const res = await apiFetch('/sales-orders', {
          method: 'POST',
          keepalive: useKeepalive,
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
    if (!hasSaveableContent(cart, services, customer)) return;

    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = setTimeout(() => {
      autosaveDraft();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, services, customer, customerPoNumber, orderDate]);

  useEffect(() => {
    return () => {
      if (savedRef.current) return;
      if (hasSaveableContent(cartRef.current, servicesRef.current, customerRef.current)) {
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
      if (hasSaveableContent(cartRef.current, servicesRef.current, customerRef.current)) {
        autosaveDraftRef.current(true);
      }
    }
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No separate "send" step to route around here — saving just persists
  // the DRAFT. Confirming (which assigns the order number and, unless
  // WAREHOUSE_OPS is on, decreases stock) happens from the detail page.
  async function handleSubmit() {
    setError('');
    if (totalLineCount === 0) return;
    if (!customer) {
      setError(t('sales.ordersNew.selectCustomer'));
      return;
    }
    const hasEmptyService = services.some((s) => !s.description.trim() || s.unitPrice === null);
    if (hasEmptyService) {
      setError(t('sales.ordersNew.serviceDescriptionPriceRequired'));
      return;
    }

    setSaving(true);
    savedRef.current = true;
    try {
      const payload = buildPayload();
      const res = currentDraftId
        ? await apiFetch(`/sales-orders/${currentDraftId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await apiFetch('/sales-orders', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        savedRef.current = false;
        setError(body?.message ?? t('sales.ordersNew.requestFailed', { status: res.status }));
        return;
      }
      router.push(`/sales/orders/${body.id}`);
    } catch {
      savedRef.current = false;
      setError(t('sales.ordersNew.couldNotReachServer'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main
        className="min-h-screen text-black p-6"
        style={{
          backgroundColor: '#f8fafc',
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      >
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <FileText size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  {currentDraftId ? t('sales.ordersNew.editTitle') : t('sales.ordersNew.newTitle')}
                </h1>
                <p className="text-xs text-gray-500 truncate">{t('sales.ordersNew.subtitle')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-between sm:justify-end">
              <button
                onClick={() => router.push('/sales/orders')}
                className="text-sm px-2 sm:px-3 py-2 rounded-lg text-gray-500 hover:text-blue-700 hover:bg-blue-50/60 shrink-0 transition-colors"
              >
                {t('sales.ordersNew.history')}
              </button>

              <span className="text-sm px-3 py-1.5 rounded-lg bg-blue-600/10 border border-blue-600/20 text-blue-700 font-medium">
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
          taxRates={taxRates}
        />

        <div ref={cartPanelRef} className="scroll-mt-24">
          <SalesOrderCartPanel
            cartLines={cartLines}
            customer={customer}
            setCustomer={setCustomer}
            customerPoNumber={customerPoNumber}
            setCustomerPoNumber={setCustomerPoNumber}
            orderDate={orderDate}
            setOrderDate={setOrderDate}
            editingPriceKey={editingPriceKey}
            setEditingPriceKey={setEditingPriceKey}
            changeQty={changeQty}
            changeUnitPrice={changeUnitPrice}
            removeFromCart={removeFromCart}
            stockAtLineLocation={stockAtLineLocation}
            subtotal={subtotal}
            discount={discount}
            distinctLocationNames={distinctLocationNames}
            onSubmit={handleSubmit}
            saving={saving}
            error={error}
            taxRates={taxRates}
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
            onChangeServiceUnit={changeServiceUnit}
            onRemoveService={removeService}
            onToggleServiceTaxRate={toggleServiceTaxRate}
          />
        </div>
      </div>

      {totalLineCount > 0 && (
        <button
          onClick={scrollToCart}
          className="md:hidden fixed bottom-[var(--app-bottom-nav-h,0px)] inset-x-0 z-20 bg-blue-700 text-white px-4 py-3 flex items-center justify-between shadow-[0_-2px_10px_rgba(37,99,235,0.25)]"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart size={16} strokeWidth={2} />
            {totalLineCount} {t(totalLineCount === 1 ? 'sales.ordersNew.itemSingular' : 'sales.ordersNew.itemPlural')}
          </span>
          <span className="text-sm font-bold">{formatIDR(total)} · {t('sales.ordersNew.review')}</span>
        </button>
      )}
    </main>
  );
}