'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Receipt, PackageCheck, ShoppingCart } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { ProductSearch } from '@/app/components/invoices/ProductSearch';
import { applyPriceLevel, resolveLinePrice, restoredLevelFields, toLevelPrices, usePriceLevels } from '@/lib/price-levels';
import { CartPanel } from '@/app/components/invoices/CartPanel';
import { InvoicePrintArea } from '@/app/components/invoices/templates/InvoicePrintArea';
import {
  CartLine,
  Customer,
  DiscountType,
  InvoiceFormat,
  InvoiceView,
  LocationOption,
  ProductSearchResult,
  ServiceLine,
} from '@/app/components/invoices/types';
import { PAGE_CSS } from '@/lib/mappers/invoice-format';
import * as cartOps from '@/lib/invoice-cart';
import { SerialPicker } from '@/app/components/shared/SerialPicker';
import { useStagedReminder } from '@/app/components/invoices/hooks/useStagedReminder';
import { useInvoiceReferenceData } from '@/app/components/invoices/hooks/useInvoiceReferenceData';
import {
  confirmStockOversell,
  extractErrorMessage,
  hasSaveableContent,
  NO_BANK_ACCOUNT,
  stockAtLineLocation,
} from '@/lib/invoice-cart';
import { useLanguage } from '@/app/context/LanguageContext';
import { useAuth } from '@/app/context/AuthContext';
import {
  ApprovalRequiredNotice,
  isApprovalRequired,
  type ApprovalRequiredError,
} from '@/app/components/approvals/ApprovalRequiredNotice';
import { errorMessage } from '@/lib/api-error';


const SEARCH_DEBOUNCE_MS = 300;
const AUTOSAVE_DEBOUNCE_MS = 1000;

// Sentinel used in the bank-account <select>: distinct from a real
// account id, means "explicitly no bank details on this document" (sent
// to the backend as bankAccountId: null). The empty string '' is the
// other sentinel — "untouched", meaning don't send the field at all and
// let the backend fall back to the org's current default account. Once a
// draft has been loaded from the server, its bankAccountId is already a
// resolved value (a real id or null), so '' never reappears for a loaded
// draft — see loadDraftById below.


// FIX — NewInvoicePage uses useSearchParams(), which requires a Suspense
// boundary for static prerendering, or `next build` fails outright. See
// login/page.tsx's identical fix.
// An issued invoice's line as the API returns it (Decimals as strings).
type IssuedItemRow = {
  id: string;
  productName?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number | string;
  itemDiscount?: number | string | null;
  itemTaxAmount?: number | string | null;
  itemTotal?: number | string | null;
  lineTotal: number | string;
  locationName?: string | null;
};

export default function NewInvoicePageWrapper() {
  return (
    <Suspense fallback={null}>
      <NewInvoicePage />
    </Suspense>
  );
}

function NewInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDraftId = searchParams.get('draftId');
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');
  const { t } = useLanguage();

  const initialCustomerId = searchParams.get('customerId');
  const initialVehicleId = searchParams.get('vehicleId');

  const [format, setFormat] = useState<InvoiceFormat>('RECEIPT');
  const [customerName, setCustomerName] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const { defaultLevelId, activeLevelIds } = usePriceLevels();
  // The document's price level: the customer's, else the org default.
  const basePriceLevelId = ((format === 'A5' || format === 'A4') ? customer?.priceLevelId : null) ?? defaultLevelId;
  const customerNameRequired = format === 'A5' || format === 'A4';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);

  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  // Issue refused for an over-limit discount: the draft is saved, and the
  // notice lets the cashier ask an admin to approve it.
  const [approvalError, setApprovalError] = useState<ApprovalRequiredError | null>(null);
  const [printData, setPrintData] = useState<InvoiceView | null>(null);

  const [posPricingEnabled, setPosPricingEnabled] = useState(false);
  const posModeEnabled = posPricingEnabled;
  const { profile } = useAuth();
  // Whether the cart may go past stock — the org's stock policy (WARN/ALLOW),
  // not the POS pricing toggle it used to be tied to. The backend still
  // enforces it at issue; under WARN with admin-only overrides, a non-admin
  // can't confirm the oversell, so the cart doesn't offer it either.
  const [stockPolicy, setStockPolicy] = useState<{
    requiresConfirmation: boolean;
    allowNegative: boolean;
    overrideRequiresAdmin: boolean;
  } | null>(null);
  const allowOversell =
    !!stockPolicy?.allowNegative &&
    !(stockPolicy.requiresConfirmation && stockPolicy.overrideRequiresAdmin && profile?.role !== 'ADMIN');


  // Bank account picker. '' = untouched (backend uses org default),
  // NO_BANK_ACCOUNT = explicit "no bank details", otherwise a real
  // OrganizationBankAccount id.
  const [bankAccountId, setBankAccountId] = useState<string>('');

  // Employee (sales/cashier) picker. '' means unset — omitted from the
  // payload, so the invoice carries no employee.
  const [employeeId, setEmployeeId] = useState<string>('');

  // The current draft's id — a ref, not state, because it's read after
  // awaits where a state value would be stale — and the autosave request
  // currently in flight, so printing can wait for it instead of creating a
  // second draft.
  const draftIdRef = useRef<string | null>(urlDraftId);
  const autosaveInFlightRef = useRef<Promise<void> | null>(null);
  const skipAutosaveRef = useRef(false);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadedDraftIdRef = useRef<string | null | undefined>(undefined);

  const { locations, taxRates, bankAccounts, employees } = useInvoiceReferenceData();
  const [locationFilter, setLocationFilter] = useState<LocationOption | null>(null);

  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [customerPoNumber, setCustomerPoNumber] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [vehicleId, setVehicleId] = useState<string | null>(initialVehicleId);
  const [customerVehicles, setCustomerVehicles] = useState <
    { id: string; plateNumber: string; vehicleModel: string; odometer?: number | null }[]
  >([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const vehiclesFetchedForRef = useRef<string | null>(null);

  const [odometer, setOdometer] = useState('');

  const [services, setServices] = useState<ServiceLine[]>([]);
  const serviceCounterRef = useRef(0);

  const reminder = useStagedReminder(vehicleId);

  const cartPanelRef = useRef<HTMLDivElement>(null);
  function scrollToCart() {
    cartPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const cartRef = useRef(cart);
  const customerNameRef = useRef(customerName);
  const customerRef = useRef(customer);
  const formatRef = useRef(format);
  const printDataRef = useRef(printData);
  const servicesRef = useRef(services);
  useEffect(() => {
    cartRef.current = cart;
    customerNameRef.current = customerName;
    customerRef.current = customer;
    formatRef.current = format;
    printDataRef.current = printData;
    servicesRef.current = services;
  }, [cart, customerName, customer, format, services, dueDate, invoiceDate, odometer, customerPoNumber, paymentTerms, notes, bankAccountId, employeeId]);

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
    (async () => {
      const res = await apiFetch('/invoices/stock-policy');
      if (res.ok) setStockPolicy(await res.json());
    })();
  }, []);

  useEffect(() => {
    if (!initialCustomerId) return;
    (async () => {
      const res = await apiFetch(`/customers/${initialCustomerId}`);
      if (res.ok) {
        const data = await res.json();
        setCustomer({
          id: data.id,
          name: data.name,
          companyName: data.companyName ?? null,
          phone: data.phone,
          address: data.address,
          priceLevelId: data.priceLevelId ?? null,
        });
        setFormat('A5');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasWorkshopRms || (format !== 'A5' && format !== 'A4') || !customer) {
      setCustomerVehicles([]);
      vehiclesFetchedForRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      setVehiclesLoading(true);
      try {
        const res = await apiFetch(`/customers/${customer.id}/vehicles`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setCustomerVehicles(data);
          vehiclesFetchedForRef.current = customer.id;
        }
      } finally {
        if (!cancelled) setVehiclesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasWorkshopRms, format, customer?.id]);

  useEffect(() => {
    if (!vehicleId) return;
    if (vehiclesLoading) return;
    if (!customer || vehiclesFetchedForRef.current !== customer.id) return;
    const stillValid = customerVehicles.some((v) => v.id === vehicleId);
    if (!stillValid) setVehicleId(null);
  }, [customerVehicles, vehiclesLoading, customer?.id]);

  useEffect(() => {
    if (!vehicleId) setOdometer('');
  }, [vehicleId]);

  function handleSelectVehicle(id: string | null) {
    setVehicleId(id);
    if (id) {
      const v = customerVehicles.find((cv) => cv.id === id);
      setOdometer(v?.odometer != null ? String(v.odometer) : '');
    } else {
      setOdometer('');
    }
  }

  function resetFormState() {
    setFormat('RECEIPT');
    setCustomerName('');
    setCustomer(null);
    setDueDate('');
    setInvoiceDate('');
    setCustomerPoNumber('');
    setPaymentTerms('');
    setNotes('');
    setVehicleId(null);
    setOdometer('');
    setServices([]);
    setCart({});
    setQuery('');
    setResults([]);
    draftIdRef.current = null;
    setBankAccountId('');
    setEmployeeId('');
  }

  async function loadDraftById(id: string) {
    const res = await apiFetch(`/invoices/${id}/draft`);
    if (!res.ok) return;
    const draft = await res.json();
    setDueDate(draft.dueDate ? String(draft.dueDate).slice(0, 10) : '');
    setInvoiceDate(draft.invoiceDate ? String(draft.invoiceDate).slice(0, 10) : '');
    setCustomerPoNumber(draft.customerPoNumber ?? '');
    setPaymentTerms(draft.paymentTerms ?? '');
    setNotes(draft.notes ?? '');
    setFormat(draft.format);
    setCustomerName(draft.customerName ?? '');
    setCustomer(draft.customer ?? null);
    setVehicleId(draft.vehicleId ?? null);
    setOdometer(draft.odometer != null ? String(draft.odometer) : '');
    // A loaded draft's bank selection is already resolved server-side
    // (createDraft always resolves at create time) — so this is either a
    // real account id or NO_BANK_ACCOUNT, never the '' "untouched" state.
    setBankAccountId(draft.bankAccountId ?? NO_BANK_ACCOUNT);
    setEmployeeId(draft.employeeId ?? '');

    const restoredCart: Record<string, CartLine> = {};
    for (const item of draft.items) {
      if (!item.productId) continue;
      const locationId = item.locationId ?? draft.locationId;
      const locationName = item.location?.name ?? draft.location?.name ?? '';
      const key = `${item.productId}__${locationId}`;
      restoredCart[key] = {
        product: {
          id: item.productId,
          name: item.product?.name ?? '',
          sku: item.product?.sku ?? null,
          barcode: item.product?.barcode ?? null,
          image: null,
          sellingPrice: item.product?.sellingPrice != null ? Number(item.product.sellingPrice) : null,
          prices: toLevelPrices(item.product?.prices),
          unit: item.product?.unit ?? null,
          stockByLocation: [],
          trackSerials: !!item.product?.trackSerials,
        },
        serialNumbers: item.serialNumbers ?? [],
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        unit: item.unit ?? item.product?.unit ?? null,
        locationId,
        locationName,
        taxRateIds: (item.taxes ?? [])
          .map((t: { taxRateId: string | null }) => t.taxRateId)
          .filter((id: string | null): id is string => !!id),
        discountType: item.discountType ?? null,
        discountValue: item.discountValue != null ? Number(item.discountValue) : null,
        ...restoredLevelFields(item.priceLevelId),
      };
    }
    skipAutosaveRef.current = true;
    setCart(restoredCart);
    draftIdRef.current = id;
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
    const placed = cartOps.resolveCartTarget(cart, product, details.quantity, locationFilter, allowOversell);
    if (!placed.ok) {
      setError(t(placed.error, placed.vars));
      return false;
    }
    const { target: resolvedTarget, key, nextQty } = placed;
    const existing = cart[key];

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
        // A re-add keeps the line's level; a new line starts at the
        // document's level, unless its price was typed (POS pricing).
        priceLevelId: existing?.priceLevelId ?? null,
        priceLevelOverridden: existing?.priceLevelOverridden ?? false,
        priceCustom:
          existing?.priceCustom ??
          (posModeEnabled && details.unitPrice !== resolveLinePrice(product, basePriceLevelId, defaultLevelId).unitPrice),
      },
    }));
    return true;
  }

  // Line edits — the transforms themselves live in lib/invoice-cart.ts.
  const changeQty = (key: string, delta: number) => setCart((prev) => cartOps.changeQty(prev, key, delta, allowOversell));
  const changeUnitPrice = (key: string, raw: string) => setCart((prev) => cartOps.setUnitPrice(prev, key, raw));
  const changePriceLevel = (key: string, levelId: string) => setCart((prev) => cartOps.setPriceLevel(prev, key, levelId));
  const removeFromCart = (key: string) => setCart((prev) => cartOps.removeLine(prev, key));
  // The line whose serial numbers are being picked (SerialPicker).
  const [serialKey, setSerialKey] = useState<string | null>(null);
  const toggleLineTaxRate = (key: string, taxRateId: string) => setCart((prev) => cartOps.toggleLineTax(prev, key, taxRateId));
  const changeLineDiscount = (key: string, type: DiscountType | null, raw?: string) =>
    setCart((prev) => cartOps.setLineDiscount(prev, key, type, raw));
  const changeServiceDiscount = (key: string, type: DiscountType | null, raw?: string) =>
    setServices((prev) => cartOps.setServiceDiscount(prev, key, type, raw));

  function applyTaxToAllLines(taxRateId: string, checked: boolean) {
    setCart((prev) => cartOps.applyTaxToAllLines(prev, taxRateId, checked));
    setServices((prev) => cartOps.applyTaxToAllServices(prev, taxRateId, checked));
  }

  function applyDiscountToAllLines(discountType: DiscountType | null, value: number) {
    setCart((prev) => cartOps.applyDiscountToAllLines(prev, discountType, value));
    setServices((prev) => cartOps.applyDiscountToAllServices(prev, discountType, value));
  }

  function addService() {
    serviceCounterRef.current += 1;
    const key = `svc_${serviceCounterRef.current}_${Date.now()}`;
    setServices((prev) => [...prev, cartOps.newServiceLine(key, taxRates.find((r) => r.isDefault)?.id)]);
  }

  const changeServiceUnit = (key: string, value: string) => setServices((prev) => cartOps.setServiceUnit(prev, key, value));
  const changeServiceDescription = (key: string, value: string) =>
    setServices((prev) => cartOps.setServiceDescription(prev, key, value));
  const changeServicePrice = (key: string, raw: string) => setServices((prev) => cartOps.setServicePrice(prev, key, raw));
  const removeService = (key: string) => setServices((prev) => prev.filter((s) => s.key !== key));
  const toggleServiceTaxRate = (key: string, taxRateId: string) =>
    setServices((prev) => cartOps.toggleServiceTax(prev, key, taxRateId));

  // FIX — was d.toISOString().slice(0, 10), which converts to UTC first
  // and rolls the date back one day in a timezone ahead of UTC.
  const {
    cartLines,
    serviceLines: serviceLinesWithTotals,
    subtotal,
    discount,
    taxAmount,
    total,
  } = cartOps.computeTotals(
    Object.entries(cart).map(([key, line]) => ({ key, ...applyPriceLevel(line, basePriceLevelId, defaultLevelId, activeLevelIds) })),
    services,
    taxRates,
  );
  const distinctLocationNames = Array.from(new Set(cartLines.map((l) => l.locationName)));
  const totalLineCount = cartLines.length + serviceLinesWithTotals.length;

  const buildItemsPayload = () => cartOps.buildInvoiceItems(cartLines, services, hasWorkshopRms);
  const buildHeader = () =>
    cartOps.buildInvoiceHeader({
      format,
      customer,
      customerName,
      vehicleId,
      customerPoNumber,
      paymentTerms,
      notes,
      odometer,
      hasWorkshopRms,
      bankAccountId,
      employeeId,
    });

  function adoptDraftId(id: string) {
    loadedDraftIdRef.current = id;
    draftIdRef.current = id;
    window.history.replaceState(null, '', `/sales/invoices/new?draftId=${id}`);
  }

  // useKeepalive is set from the pagehide handler below, so the request
  // can outlive the page (tab close/refresh/navigating away) instead of
  // being cancelled mid-flight like a normal fetch would be.
  async function autosaveDraft(useKeepalive = false) {
    if (
      printData ||
      !hasSaveableContent(cartRef.current, servicesRef.current, hasWorkshopRms, customerRef.current, customerNameRef.current)
    ) return;
    const run = saveDraftNow(useKeepalive);
    autosaveInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (autosaveInFlightRef.current === run) autosaveInFlightRef.current = null;
    }
  }

  async function saveDraftNow(useKeepalive: boolean) {
    const itemsPayload = buildItemsPayload();
    const draftId = draftIdRef.current;

    try {
      if (draftId) {
        await apiFetch(`/invoices/${draftId}`, {
          method: 'PATCH',
          keepalive: useKeepalive,
          body: JSON.stringify({
            format,
            ...buildHeader(),
            items: itemsPayload,
            dueDate: dueDate || undefined,
            invoiceDate: invoiceDate || undefined,
          }),
        });
      } else {
        const res = await apiFetch('/invoices', {
          method: 'POST',
          keepalive: useKeepalive,
          body: JSON.stringify({
            locationId: cartLines[0]?.locationId,
            format,
            ...buildHeader(),
            items: itemsPayload,
            dueDate: dueDate || undefined,
            invoiceDate: invoiceDate || undefined,
          }),
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
    if (printData || !hasSaveableContent(cart, services, hasWorkshopRms, customer, customerName)) return;

    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = setTimeout(() => {
      autosaveDraft();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, customerName, customer, format, services, dueDate, invoiceDate, odometer, customerPoNumber, paymentTerms, notes, hasWorkshopRms, bankAccountId, employeeId]);

  useEffect(() => {
    return () => {
      if (
        !printDataRef.current &&
        hasSaveableContent(cartRef.current, servicesRef.current, hasWorkshopRms, customerRef.current, customerNameRef.current)
      ) {
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
      if (
        !printDataRef.current &&
        hasSaveableContent(cartRef.current, servicesRef.current, hasWorkshopRms, customerRef.current, customerNameRef.current)
      ) {
        autosaveDraftRef.current(true);
      }
    }
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateAndPrint() {
    if (cartLines.length === 0 && services.length === 0) return;
    if (customerNameRequired && !customer) {
      setError(t('sales.invoicesNew.customerRequiredError'));
      return;
    }
    const hasEmptyService =
      hasWorkshopRms && services.some((s) => !s.description.trim() || s.unitPrice === null);
    if (hasEmptyService) {
      setError(t('sales.invoicesNew.emptyServiceError'));
      return;
    }

    setPrinting(true);
    setError('');

    try {
      // A pending or in-flight autosave would otherwise race this request:
      // with no draft yet, both POSTed and left an orphan draft behind.
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
      if (autosaveInFlightRef.current) await autosaveInFlightRef.current;

      let invoiceId = draftIdRef.current;
      const itemsPayload = buildItemsPayload();

      if (invoiceId) {
        const updateRes = await apiFetch(`/invoices/${invoiceId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            format,
            ...buildHeader(),
            items: itemsPayload,
            dueDate: dueDate || undefined,
            invoiceDate: invoiceDate || undefined,
          }),
        });
        if (!updateRes.ok) {
          throw new Error(await extractErrorMessage(updateRes, t));
        }
      } else {
        const draftRes = await apiFetch('/invoices', {
          method: 'POST',
          body: JSON.stringify({
            locationId: cartLines[0]?.locationId,
            format,
            ...buildHeader(),
            items: itemsPayload,
            dueDate: dueDate || undefined,
            invoiceDate: invoiceDate || undefined,
          }),
        });

        if (!draftRes.ok) {
          throw new Error(await extractErrorMessage(draftRes, t));
        }
        const draft = await draftRes.json();
        invoiceId = draft.id;
        adoptDraftId(draft.id);
      }

      let printRes = await apiFetch(`/invoices/${invoiceId}/print`, { method: 'POST' });
      if (printRes.status === 409) {
        const confirmed = await confirmStockOversell(printRes);
        if (!confirmed) {
          setPrinting(false);
          return;
        }
        printRes = await apiFetch(`/invoices/${invoiceId}/print`, {
          method: 'POST',
          body: JSON.stringify({ confirmOversell: true }),
        });
      }
      if (printRes.status === 403) {
        const body = await printRes.clone().json().catch(() => null);
        if (isApprovalRequired(body)) {
          setApprovalError(body);
          setPrinting(false);
          return;
        }
      }
      if (!printRes.ok) {
        throw new Error(await extractErrorMessage(printRes, t));
      }
      setApprovalError(null);
      const issued = await printRes.json();

      await reminder.submit();

      if (format !== 'RECEIPT' && format !== 'THERMAL_58') {
        router.push(`/sales/invoices/${invoiceId}`);
        return;
      }

      setPrintData({
        invoiceNumber: issued.invoiceNumber,
        issuedAt: issued.issuedAt,
        invoiceDate: issued.invoiceDate ?? null,
        customerName: issued.customerName,
        billingAddress: issued.billingAddress ?? issued.customerAddress ?? null,

        customerPhone: issued.customerPhone,
        customerAddress: issued.customerAddress,
        customerNpwp: issued.customerNpwp,
        customerPoNumber: issued.customerPoNumber ?? null,
        locationName: issued.locationName,
        sessionId: issued.sessionId ?? null,
        vehicleId: issued.vehicleId ?? null,
        vehiclePlateNumber: issued.vehiclePlateNumber ?? null,
        vehicleModel: issued.vehicleModel ?? null,
        vehicleVin: issued.vehicleVin ?? null,
        vehicleOdometer: issued.vehicleOdometer ?? null,

        employeeId: issued.employeeId ?? null,
        employeeName: issued.employeeName ?? null,

        items: issued.items.map((item: IssuedItemRow) => ({
          id: item.id,
          productName: item.productName ?? '',
          quantity: item.quantity,
          unit: item.unit ?? null,
          unitPrice: Number(item.unitPrice),
          itemDiscount: Number(item.itemDiscount ?? 0),
          itemTaxAmount: Number(item.itemTaxAmount ?? 0),
          itemTotal: Number(item.itemTotal ?? item.lineTotal),
          lineTotal: Number(item.lineTotal),
          locationName: item.locationName ?? '',
        })),
        subtotal: Number(issued.subtotal),
        discount: Number(issued.discount),
        taxAmount: Number(issued.taxAmount ?? 0),
        taxes: (issued.taxes ?? []).map((t: { name: string; percentage: number | string; amount: number | string }) => ({
          name: t.name,
          percentage: Number(t.percentage),
          amount: Number(t.amount),
        })),
        total: Number(issued.total),

        businessName: issued.businessLegalName ?? issued.businessName,
        businessLegalName: issued.businessLegalName,
        businessNpwp: issued.businessNpwp,
        businessLogoUrl: issued.businessLogoUrl,
        businessAddress: issued.locationAddress ?? null,
        businessPhone: issued.locationPhone ?? null,
        bankName: issued.bankName,
        bankAccountNumber: issued.bankAccountNumber,
        bankAccountName: issued.bankAccountName,

        paymentStatus: issued.paymentStatus ?? null,
        amountPaid: issued.amountPaid != null ? Number(issued.amountPaid) : null,
        dueDate: issued.dueDate ?? null,
        paymentTerms: issued.paymentTerms ?? null,
        notes: issued.notes ?? null,
      } as InvoiceView);
    } catch (e) {
      console.error(e);
      setError(errorMessage(e) || t('sales.invoicesNew.couldNotCreateInvoice'));
    } finally {
      setPrinting(false);
    }
  }

  useEffect(() => {
    if (!printData) return;
    const timer = setTimeout(() => {
      window.print();
      setCart({});
      setQuery('');
      setResults([]);
      setCustomerName('');
      setCustomer(null);
      setDueDate('');
      setInvoiceDate('');
      setCustomerPoNumber('');
      setPaymentTerms('');
      setNotes('');
      setVehicleId(null);
      setOdometer('');
      setServices([]);
      setBankAccountId('');
      setEmployeeId('');
      reminder.reset();
      draftIdRef.current = null;
      loadedDraftIdRef.current = null;
      router.replace('/sales/invoices/new', { scroll: false });
    }, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printData]);

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
<style>{`
  ${PAGE_CSS[format] ?? PAGE_CSS.A4}
  @media print {
    body * { visibility: hidden; }
    #print-area, #print-area * { visibility: visible; }
    #print-area { position: absolute; top: 0; left: 0; }
  }
`}</style>

      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Receipt size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  {t('sales.invoicesNew.title')}
                </h1>
                <p className="text-xs text-gray-500 truncate">{t('sales.invoicesNew.subtitle')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-between sm:justify-end">
              <button data-tour="sales-history"
                onClick={() => router.push('/sales/invoices')}
                className="text-sm px-2 sm:px-3 py-2 rounded-lg text-gray-500 hover:text-blue-700 hover:bg-blue-50/60 shrink-0 transition-colors"
              >
                {t('sales.invoicesNew.history')}
              </button>

              <div data-tour="inv-format" className="flex items-center bg-blue-600/5 border border-blue-500/15 rounded-lg p-1 text-sm font-medium overflow-x-auto">
                {(
                  [
                    { value: 'THERMAL_58', label: '58mm' },
                    { value: 'RECEIPT', label: '80mm' },
                    { value: 'A5', label: 'A5' },
                    { value: 'A4', label: 'A4' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFormat(opt.value)}
                    className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      format === opt.value ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-blue-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {printData && (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-4">
            <div>
              <p className="font-semibold">{t('sales.invoicesNew.invoicePrintedTitle', { number: printData.invoiceNumber ?? '' })}</p>
              <p className="text-sm">
                {formatIDR(printData.total)} · {printData.locationName}
              </p>
            </div>

            {printData.sessionId && (
              <button
                onClick={() => router.push(`/inventory/sessions/${printData.sessionId}`)}
                className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white px-4 py-2 rounded-md font-semibold text-sm w-full sm:w-auto"
              >
                <PackageCheck size={16} strokeWidth={2} />
                {t('sales.invoicesNew.goToFulfillment')}
              </button>
            )}
          </div>
        </div>
      )}

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
          posModeEnabled={posModeEnabled}
          allowOversell={allowOversell}
          taxRates={taxRates}
          basePriceLevelId={basePriceLevelId}
        />

        <div ref={cartPanelRef} className="scroll-mt-24">
          <CartPanel
            format={format}
            cartLines={cartLines}
            dueDate={dueDate}
            onRemoveService={removeService}

            onChangeDueDate={setDueDate}
            customerPoNumber={customerPoNumber}
            onChangeCustomerPoNumber={setCustomerPoNumber}
            paymentTerms={paymentTerms}
            onChangePaymentTerms={setPaymentTerms}
            notes={notes}
            onChangeNotes={setNotes}
            customerName={customerName}
            setCustomerName={setCustomerName}
            customer={customer}
            setCustomer={setCustomer}
            customerNameRequired={customerNameRequired}
            editingPriceKey={editingPriceKey}
            setEditingPriceKey={setEditingPriceKey}
            changeQty={changeQty}
            changeUnitPrice={changeUnitPrice}
            onChangePriceLevel={changePriceLevel}
            removeFromCart={removeFromCart}
            onPickSerials={setSerialKey}
            stockAtLineLocation={stockAtLineLocation}
            posModeEnabled={posModeEnabled}
            allowOversell={allowOversell}
            subtotal={subtotal}
            discount={discount}
            distinctLocationNames={distinctLocationNames}
            onSubmit={handleCreateAndPrint}
            printing={printing}
            error={error}
            taxRates={taxRates}
            onToggleLineTaxRate={toggleLineTaxRate}
            onApplyTaxToAll={applyTaxToAllLines}
            onChangeLineDiscount={changeLineDiscount}
            onChangeServiceDiscount={changeServiceDiscount}
            onApplyDiscountToAll={applyDiscountToAllLines}
            taxAmount={taxAmount}
            total={total}
            hasWorkshopRms={hasWorkshopRms}
            vehicleId={vehicleId}
            customerVehicles={customerVehicles}
            vehiclesLoading={vehiclesLoading}
            onSelectVehicle={handleSelectVehicle}
            odometer={odometer}
            onChangeOdometer={setOdometer}
            invoiceDate={invoiceDate}
            onChangeInvoiceDate={setInvoiceDate}
            reminderOpen={reminder.open}
            onToggleReminderOpen={reminder.toggleOpen}
            reminderNote={reminder.note}
            onChangeReminderNote={reminder.setNote}
            reminderDueDate={reminder.dueDate}
            onChangeReminderDueDate={reminder.setDueDate}
            onPickReminderPreset={reminder.pickPreset}
            onSaveReminder={reminder.stage}
            reminderStaged={reminder.staged}
            reminderSaving={reminder.saving}
            reminderSaved={reminder.saved}
            reminderError={reminder.error}
            services={serviceLinesWithTotals}
            onChangeServiceUnit={changeServiceUnit}
            onAddService={addService}
            onChangeServiceDescription={changeServiceDescription}
            onChangeServicePrice={changeServicePrice}
            onToggleServiceTaxRate={toggleServiceTaxRate}
            // Bank-account picker. CartPanel needs to render a <select>
            // using these and call onChangeBankAccountId with '',
            // NO_BANK_ACCOUNT-equivalent, or a chosen id.
            bankAccounts={bankAccounts}
            bankAccountId={bankAccountId}
            onChangeBankAccountId={setBankAccountId}
            noBankAccountValue={NO_BANK_ACCOUNT}
            employees={employees}
            employeeId={employeeId}
            onChangeEmployeeId={setEmployeeId}
          />
        </div>
      </div>

      {!printData && totalLineCount > 0 && (
        <button
          onClick={scrollToCart}
          className="md:hidden fixed bottom-[var(--app-bottom-nav-h,0px)] inset-x-0 z-20 bg-blue-700 text-white px-4 py-3 flex items-center justify-between shadow-[0_-2px_10px_rgba(37,99,235,0.25)]"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart size={16} strokeWidth={2} />
            {totalLineCount} {t(totalLineCount === 1 ? 'sales.invoicesNew.itemCountOne' : 'sales.invoicesNew.itemCountOther')}
          </span>
          <span className="text-sm font-bold">{formatIDR(total)} · {t('sales.invoicesNew.reviewCta')}</span>
        </button>
      )}

      {printData && <InvoicePrintArea format={format} invoice={printData} />}
      {serialKey && cart[serialKey] && (
        <SerialPicker
          productId={cart[serialKey].product.id}
          productName={cart[serialKey].product.name}
          locationId={cart[serialKey].locationId}
          quantity={Math.floor(cart[serialKey].quantity)}
          value={cart[serialKey].serialNumbers ?? []}
          onChange={(serials) => setCart((prev) => cartOps.setLineSerials(prev, serialKey, serials))}
          onClose={() => setSerialKey(null)}
        />
      )}
      {approvalError && (
        <div className="fixed bottom-24 md:bottom-6 left-4 right-4 md:left-auto md:w-[28rem] z-50 shadow-lg">
          <ApprovalRequiredNotice error={approvalError} />
        </div>
      )}
    </main>
  );
}