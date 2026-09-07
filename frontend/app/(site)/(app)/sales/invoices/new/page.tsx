'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ArrowLeft, Receipt, PackageCheck, ShoppingCart } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useHasModule } from '@/lib/useHasModule';
import { ProductSearch } from '@/app/components/invoices/ProductSearch';
import { CartPanel } from '@/app/components/invoices/CartPanel';
import { InvoicePrintArea } from '@/app/components/invoices/templates/InvoicePrintArea';
import {
  BankAccount,
  CartLine,
  Customer,
  DiscountType,
  InvoiceFormat,
  InvoiceView,
  LocationOption,
  ProductSearchResult,
  ServiceLine,
  TaxRate,
} from '@/app/components/invoices/types';
import { PAGE_CSS } from '@/lib/invoice-format';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

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
const NO_BANK_ACCOUNT = '__none__';

type RawTaxRate = TaxRate & { archivedAt: string | null };
type RawBankAccount = BankAccount & { archivedAt: string | null };

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function lineDiscountAmount(
  lineSubtotal: number,
  discountType: DiscountType | null,
  discountValue: number | null,
): number {
  if (discountType === 'PERCENTAGE') return round2(lineSubtotal * ((discountValue ?? 0) / 100));
  if (discountType === 'FIXED') return round2(Math.min(discountValue ?? 0, lineSubtotal));
  return 0;
}

function hasSaveableContent(
  cart: Record<string, CartLine>,
  services: ServiceLine[],
  hasWorkshopRms: boolean,
): boolean {
  return (
    Object.keys(cart).length > 0 ||
    (hasWorkshopRms && services.some((s) => s.description.trim() && s.unitPrice !== null))
  );
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.message || JSON.stringify(data);
  } catch {
    return res.statusText || `Request failed (${res.status})`;
  }
}

export default function NewInvoicePageWrapper() {
  return <NewInvoicePage />;
}

function NewInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDraftId = searchParams.get('draftId');
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');

  const initialCustomerId = searchParams.get('customerId');
  const initialVehicleId = searchParams.get('vehicleId');

  const [format, setFormat] = useState<InvoiceFormat>('RECEIPT');
  const [customerName, setCustomerName] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const customerNameRequired = format === 'A5' || format === 'A4';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);

  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [printData, setPrintData] = useState<InvoiceView | null>(null);

  const [posPricingEnabled, setPosPricingEnabled] = useState(false);
  const posModeEnabled = posPricingEnabled;

  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);

  // Bank account picker. '' = untouched (backend uses org default),
  // NO_BANK_ACCOUNT = explicit "no bank details", otherwise a real
  // OrganizationBankAccount id.
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState<string>('');

  const [currentDraftId, setCurrentDraftId] = useState<string | null>(urlDraftId);
  const skipAutosaveRef = useRef(false);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadedDraftIdRef = useRef<string | null | undefined>(undefined);

  const [locations, setLocations] = useState<LocationOption[]>([]);
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

  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderNote, setReminderNote] = useState('');
  const [reminderDueDate, setReminderDueDate] = useState('');
  const [reminderStaged, setReminderStaged] = useState(false);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderSaved, setReminderSaved] = useState(false);
  const [reminderError, setReminderError] = useState('');

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
  }, [cart, customerName, customer, format, services, dueDate, invoiceDate, odometer, customerPoNumber, paymentTerms, notes, bankAccountId]);

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
      const data: LocationOption[] = await res.json();
      setLocations(data);
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
    async function loadBankAccounts() {
      const res = await apiFetch('/organization/bank-accounts');
      if (!res.ok) return;
      const accounts: RawBankAccount[] = await res.json();
      setBankAccounts(
        accounts
          .filter((a) => !a.archivedAt)
          .map((a) => ({
            id: a.id,
            bankName: a.bankName,
            accountNumber: a.accountNumber,
            accountName: a.accountName,
            isDefault: a.isDefault,
          })),
      );
    }
    loadBankAccounts();
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
    setReminderOpen(false);
    setReminderNote('');
    setReminderDueDate('');
    setReminderStaged(false);
    setReminderSaved(false);
    setReminderError('');
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
    setCurrentDraftId(null);
    setBankAccountId('');
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
          sellingPrice: Number(item.unitPrice),
          unit: item.product?.unit ?? null,
          stockByLocation: [],
        },
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
      };
    }
    skipAutosaveRef.current = true;
    setCart(restoredCart);
    setCurrentDraftId(id);
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

  function cartKey(productId: string, locationId: string) {
    return `${productId}__${locationId}`;
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

  function pickReminderPreset(months: number) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    setReminderDueDate(d.toISOString().slice(0, 10));
    setReminderSaved(false);
  }

  function stageReminder() {
    if (!vehicleId || !reminderNote.trim() || !reminderDueDate) return;
    setReminderStaged(true);
    setReminderError('');
  }

  async function submitStagedReminder() {
    if (!vehicleId || !reminderStaged || !reminderNote.trim() || !reminderDueDate) return;
    setReminderSaving(true);
    setReminderError('');
    try {
      const res = await apiFetch(`/vehicles/${vehicleId}/reminders`, {
        method: 'POST',
        body: JSON.stringify({
          note: reminderNote.trim(),
          dueDate: new Date(reminderDueDate).toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || `Failed to save reminder (${res.status})`);
      }
      setReminderSaved(true);
    } catch (e: any) {
      console.error('Reminder submit failed', e);
    } finally {
      setReminderSaving(false);
    }
  }

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
  const distinctLocationNames = Array.from(new Set(cartLines.map((l) => l.locationName)));

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

  const subtotal =
    cartLines.reduce((sum, line) => sum + line.lineSubtotal, 0) +
    serviceLinesWithTotals.reduce((sum, s) => sum + s.lineSubtotal, 0);
  const discount = round2(
    cartLines.reduce((sum, line) => sum + line.lineDiscountAmount, 0) +
      serviceLinesWithTotals.reduce((sum, s) => sum + s.lineDiscountAmount, 0),
  );
  const taxAmount = round2(
    cartLines.reduce((sum, line) => sum + line.lineTaxAmount, 0) +
      serviceLinesWithTotals.reduce((sum, s) => sum + s.lineTaxAmount, 0),
  );
  const total = round2(subtotal - discount + taxAmount);
  const totalLineCount = cartLines.length + serviceLinesWithTotals.length;

  function buildItemsPayload() {
    const productItems = cartLines.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
      unit: line.unit ?? undefined,
      locationId: line.locationId,
      unitPrice: line.unitPrice,
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
            unitPrice: s.unitPrice as number,
            unit: s.unit ?? undefined,
            taxRateIds: s.taxRateIds,
            discountType: s.discountType ?? undefined,
            discountValue: s.discountValue ?? undefined,
          }))
      : [];
    return [...productItems, ...serviceItems];
  }

  function buildCustomerFields() {
    return format === 'A5' || format === 'A4'
      ? { customerId: customer?.id, customerName: undefined, vehicleId: vehicleId ?? undefined }
      : { customerId: undefined, customerName: customerName.trim() || undefined, vehicleId: undefined };
  }

  function buildInvoiceInfoFields() {
    if (!customerNameRequired) return {};
    return {
      customerPoNumber: customerPoNumber.trim() || undefined,
      paymentTerms: paymentTerms.trim() || undefined,
      notes: notes.trim() || undefined,
    };
  }

  function buildOdometerField() {
    if (!hasWorkshopRms || (format !== 'A5' && format !== 'A4') || !vehicleId || !odometer.trim()) return {};
    const parsed = Number(odometer);
    return Number.isFinite(parsed) ? { odometer: parsed } : {};
  }

  // '' (untouched) omits the field entirely, letting the backend resolve
  // to the org's current default. NO_BANK_ACCOUNT sends an explicit null
  // (no bank details on this document). Anything else is a chosen
  // account id.
  function buildBankAccountField() {
    if (bankAccountId === '') return {};
    return { bankAccountId: bankAccountId === NO_BANK_ACCOUNT ? null : bankAccountId };
  }

  function adoptDraftId(id: string) {
    loadedDraftIdRef.current = id;
    setCurrentDraftId(id);
    window.history.replaceState(null, '', `/sales/invoices/new?draftId=${id}`);
  }

  async function autosaveDraft() {
    if (printData || !hasSaveableContent(cartRef.current, servicesRef.current, hasWorkshopRms)) return;

    const itemsPayload = buildItemsPayload();

    try {
      if (currentDraftId) {
        await apiFetch(`/invoices/${currentDraftId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            format,
            ...buildCustomerFields(),
            ...buildOdometerField(),
            ...buildInvoiceInfoFields(),
            ...buildBankAccountField(),
            items: itemsPayload,
            dueDate: dueDate || undefined,
            invoiceDate: invoiceDate || undefined,
          }),
        });
      } else {
        const res = await apiFetch('/invoices', {
          method: 'POST',
          body: JSON.stringify({
            locationId: cartLines[0]?.locationId,
            format,
            ...buildCustomerFields(),
            ...buildOdometerField(),
            ...buildInvoiceInfoFields(),
            ...buildBankAccountField(),
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
    if (printData || !hasSaveableContent(cart, services, hasWorkshopRms)) return;

    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = setTimeout(() => {
      autosaveDraft();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, customerName, customer, format, services, dueDate, invoiceDate, odometer, customerPoNumber, paymentTerms, notes, hasWorkshopRms, bankAccountId]);

  useEffect(() => {
    return () => {
      if (
        !printDataRef.current &&
        hasSaveableContent(cartRef.current, servicesRef.current, hasWorkshopRms)
      ) {
        autosaveDraftRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateAndPrint() {
    if (cartLines.length === 0 && services.length === 0) return;
    if (customerNameRequired && !customer) {
      setError('A customer is required for an A5 invoice.');
      return;
    }
    const hasEmptyService =
      hasWorkshopRms && services.some((s) => !s.description.trim() || s.unitPrice === null);
    if (hasEmptyService) {
      setError('Enter a description and price for every service (use 0 if free).');
      return;
    }

    setPrinting(true);
    setError('');

    try {
      let invoiceId = currentDraftId;
      const itemsPayload = buildItemsPayload();

      if (invoiceId) {
        const updateRes = await apiFetch(`/invoices/${invoiceId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...buildCustomerFields(),
            ...buildOdometerField(),
            ...buildInvoiceInfoFields(),
            ...buildBankAccountField(),
            items: itemsPayload,
            dueDate: dueDate || undefined,
            invoiceDate: invoiceDate || undefined,
          }),
        });
        if (!updateRes.ok) {
          throw new Error(await extractErrorMessage(updateRes));
        }
      } else {
        const draftRes = await apiFetch('/invoices', {
          method: 'POST',
          body: JSON.stringify({
            locationId: cartLines[0]?.locationId,
            format,
            ...buildCustomerFields(),
            ...buildOdometerField(),
            ...buildInvoiceInfoFields(),
            ...buildBankAccountField(),
            items: itemsPayload,
            dueDate: dueDate || undefined,
            invoiceDate: invoiceDate || undefined,
          }),
        });

        if (!draftRes.ok) {
          throw new Error(await extractErrorMessage(draftRes));
        }
        const draft = await draftRes.json();
        invoiceId = draft.id;
        adoptDraftId(draft.id);
      }

      const printRes = await apiFetch(`/invoices/${invoiceId}/print`, { method: 'POST' });
      if (!printRes.ok) {
        throw new Error(await extractErrorMessage(printRes));
      }
      const issued = await printRes.json();

      await submitStagedReminder();

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

        items: issued.items.map((item: any) => ({
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
        taxes: (issued.taxes ?? []).map((t: any) => ({
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
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Could not create invoice');
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
      setReminderOpen(false);
      setReminderNote('');
      setReminderDueDate('');
      setReminderStaged(false);
      setReminderSaved(false);
      setReminderError('');
      setCurrentDraftId(null);
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
        backgroundColor: '#f8fafc',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
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
          <button
            onClick={() => router.push('/sales/invoices')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Receipt size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  New Invoice
                </h1>
                <p className="text-xs text-gray-500 truncate">Search items, create and print an invoice</p>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-between sm:justify-end">
              <button
                onClick={() => router.push('/sales/invoices')}
                className="text-sm px-2 sm:px-3 py-2 rounded-lg text-gray-500 hover:text-blue-700 hover:bg-blue-50/60 shrink-0 transition-colors"
              >
                History
              </button>

              <div className="flex items-center bg-blue-600/5 border border-blue-500/15 rounded-lg p-1 text-sm font-medium overflow-x-auto">
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
              <p className="font-semibold">Invoice {printData.invoiceNumber} printed</p>
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
                Go to Fulfillment
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
            removeFromCart={removeFromCart}
            stockAtLineLocation={stockAtLineLocation}
            posModeEnabled={posModeEnabled}
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
            reminderOpen={reminderOpen}
            onToggleReminderOpen={() => setReminderOpen((v) => !v)}
            reminderNote={reminderNote}
            onChangeReminderNote={setReminderNote}
            reminderDueDate={reminderDueDate}
            onChangeReminderDueDate={setReminderDueDate}
            onPickReminderPreset={pickReminderPreset}
            onSaveReminder={stageReminder}
            reminderStaged={reminderStaged}
            reminderSaving={reminderSaving}
            reminderSaved={reminderSaved}
            reminderError={reminderError}
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
          />
        </div>
      </div>

      {!printData && totalLineCount > 0 && (
        <button
          onClick={scrollToCart}
          className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-blue-700 text-white px-4 py-3 flex items-center justify-between shadow-[0_-2px_10px_rgba(37,99,235,0.25)]"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart size={16} strokeWidth={2} />
            {totalLineCount} item{totalLineCount === 1 ? '' : 's'}
          </span>
          <span className="text-sm font-bold">{formatIDR(total)} · Review</span>
        </button>
      )}

      {printData && <InvoicePrintArea format={format} invoice={printData} />}
    </main>
  );
}