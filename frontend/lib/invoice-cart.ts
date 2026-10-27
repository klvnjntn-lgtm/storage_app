// The invoice cart's pure logic — line arithmetic and the state
// transforms behind every cart edit on sales/invoices/new. Kept free of
// React so it can be unit-tested (lib/invoice-cart.test.ts) and so the
// page component is about wiring, not arithmetic.

import type { CartLine, Customer, DiscountType, LocationOption, ProductSearchResult, ServiceLine, TaxRate } from '@/app/components/invoices/types';

export type Cart = Record<string, CartLine>;

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function cartKey(productId: string, locationId: string) {
  return `${productId}__${locationId}`;
}

export function lineDiscountAmount(lineSubtotal: number, discountType: DiscountType | null, discountValue: number | null): number {
  if (discountType === 'PERCENTAGE') return round2(lineSubtotal * ((discountValue ?? 0) / 100));
  if (discountType === 'FIXED') return round2(Math.min(discountValue ?? 0, lineSubtotal));
  return 0;
}

// Also true for a bare customer selection with an empty cart — exiting
// the page (tab close, refresh, navigating away) should still leave a
// draft behind so that pick isn't lost, not just once there's a line item.
export function hasSaveableContent(
  cart: Cart,
  services: ServiceLine[],
  hasWorkshopRms: boolean,
  customer: Customer | null,
  customerName: string,
): boolean {
  return (
    Object.keys(cart).length > 0 ||
    (hasWorkshopRms && services.some((s) => s.description.trim() && s.unitPrice !== null)) ||
    !!customer ||
    !!customerName.trim()
  );
}

export function stockAtLineLocation(line: CartLine): number {
  return line.product.stockByLocation.find((s) => s.locationId === line.locationId)?.quantity ?? 0;
}

// A typed discount: PERCENTAGE is capped at 100 so a mistyped 500 can't
// drive the line (and the document) negative; anything unparseable keeps
// the current value.
export function clampDiscount(discountType: DiscountType, rawValue: string | undefined, current: number | null): number {
  const parsed = Number(rawValue);
  const clamped = discountType === 'PERCENTAGE' ? Math.min(parsed, 100) : parsed;
  return Number.isFinite(clamped) && clamped >= 0 ? clamped : (current ?? 0);
}

function toggled(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

function withTax(ids: string[], id: string, checked: boolean) {
  const has = ids.includes(id);
  if (checked && !has) return [...ids, id];
  if (!checked && has) return ids.filter((x) => x !== id);
  return ids;
}

// ---- product lines -------------------------------------------------------

export type CartTarget = { locationId: string; locationName: string; quantity: number };

// Where a product added to the cart is taken from, or why it can't be
// added — as a translation key plus its variables, for the page to show.
// With a location filter: that location (or, overselling, even with none
// recorded there). Without: whichever location holds the most. Never past
// the stock there unless the org's stock policy allows overselling.
export function resolveCartTarget(
  // Any cart keyed by cartKey() — invoices, quotations and orders alike.
  cart: Record<string, { quantity: number }>,
  product: ProductSearchResult,
  quantity: number,
  locationFilter: LocationOption | null,
  allowOversell: boolean,
  // Org without warehouse ops: locationFilter is its CENTRE, which the user
  // never sees — so messages mustn't name it.
  opts: { locationHidden?: boolean } = {},
): { ok: true; target: CartTarget; key: string; nextQty: number } | { ok: false; error: string; vars: Record<string, string | number> } {
  const result = resolveTarget(cart, product, quantity, locationFilter, allowOversell);
  if (result.ok || !opts.locationHidden) return result;
  if (result.error === 'sales.invoicesNew.onlyAvailable') {
    return { ok: false, error: 'sales.invoicesNew.onlyAvailableHere', vars: result.vars };
  }
  return { ok: false, error: 'sales.invoicesNew.outOfStock', vars: { name: product.name } };
}

function resolveTarget(
  cart: Record<string, { quantity: number }>,
  product: ProductSearchResult,
  quantity: number,
  locationFilter: LocationOption | null,
  allowOversell: boolean,
): { ok: true; target: CartTarget; key: string; nextQty: number } | { ok: false; error: string; vars: Record<string, string | number> } {
  let target: CartTarget | undefined;
  if (locationFilter) {
    target = product.stockByLocation.find((s) => s.locationId === locationFilter.id);
    if (!target && allowOversell) target = { locationId: locationFilter.id, locationName: locationFilter.name, quantity: 0 };
    if (!target || (!allowOversell && target.quantity <= 0)) {
      return { ok: false, error: 'sales.invoicesNew.stockNotAtLocation', vars: { name: product.name, location: locationFilter.name } };
    }
  } else {
    target = [...product.stockByLocation].sort((a, b) => b.quantity - a.quantity)[0];
    // Nothing recorded anywhere: overselling still needs a location to take
    // it from, and guessing one would be wrong.
    if (!target) {
      return {
        ok: false,
        error: allowOversell ? 'sales.invoicesNew.pickLocationToOversell' : 'sales.invoicesNew.noStockAnywhere',
        vars: { name: product.name },
      };
    }
    if (!allowOversell && target.quantity <= 0) {
      return { ok: false, error: 'sales.invoicesNew.noStockAnywhere', vars: { name: product.name } };
    }
  }
  const key = cartKey(product.id, target.locationId);
  const nextQty = (cart[key]?.quantity ?? 0) + quantity;
  if (!allowOversell && nextQty > target.quantity) {
    return {
      ok: false,
      error: 'sales.invoicesNew.onlyAvailable',
      vars: { qty: target.quantity, name: product.name, location: target.locationName },
    };
  }
  return { ok: true, target, key, nextQty };
}

// Steps a line's quantity; at zero the line goes. Past stock only when the
// org's stock policy allows overselling (same rule as adding to the cart).
export function changeQty(cart: Cart, key: string, delta: number, allowOversell: boolean): Cart {
  const line = cart[key];
  if (!line) return cart;
  const nextQty = round2(line.quantity + delta);
  if (nextQty <= 0) return removeLine(cart, key);
  if (!allowOversell && nextQty > stockAtLineLocation(line)) return cart;
  // Fewer units can't keep more serial numbers than they have.
  const serialNumbers = line.serialNumbers && line.serialNumbers.slice(0, Math.floor(nextQty));
  return { ...cart, [key]: { ...line, quantity: nextQty, ...(serialNumbers && { serialNumbers }) } };
}

export function setUnitPrice(cart: Cart, key: string, rawValue: string): Cart {
  const line = cart[key];
  if (!line) return cart;
  const parsed = Number(rawValue);
  return { ...cart, [key]: { ...line, unitPrice: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0, priceCustom: true } };
}

// Picking a level by hand pins the line to it and drops any typed price.
export function setPriceLevel(cart: Cart, key: string, levelId: string): Cart {
  const line = cart[key];
  if (!line) return cart;
  return { ...cart, [key]: { ...line, priceLevelId: levelId, priceLevelOverridden: true, priceCustom: false } };
}

export function setLineSerials(cart: Cart, key: string, serialNumbers: string[]): Cart {
  const line = cart[key];
  if (!line) return cart;
  return { ...cart, [key]: { ...line, serialNumbers } };
}

export function removeLine(cart: Cart, key: string): Cart {
  const next = { ...cart };
  delete next[key];
  return next;
}

export function toggleLineTax(cart: Cart, key: string, taxRateId: string): Cart {
  const line = cart[key];
  if (!line) return cart;
  return { ...cart, [key]: { ...line, taxRateIds: toggled(line.taxRateIds, taxRateId) } };
}

export function setLineDiscount(cart: Cart, key: string, discountType: DiscountType | null, rawValue?: string): Cart {
  const line = cart[key];
  if (!line) return cart;
  if (discountType === null) return { ...cart, [key]: { ...line, discountType: null, discountValue: null } };
  return { ...cart, [key]: { ...line, discountType, discountValue: clampDiscount(discountType, rawValue, line.discountValue) } };
}

export function applyTaxToAllLines(cart: Cart, taxRateId: string, checked: boolean): Cart {
  return Object.fromEntries(
    Object.entries(cart).map(([k, line]) => [k, { ...line, taxRateIds: withTax(line.taxRateIds, taxRateId, checked) }]),
  );
}

export function applyDiscountToAllLines(cart: Cart, discountType: DiscountType | null, value: number): Cart {
  return Object.fromEntries(
    Object.entries(cart).map(([k, line]) => [k, { ...line, discountType, discountValue: discountType ? value : null }]),
  );
}

// ---- totals -------------------------------------------------------------

type LineMoney = { lineSubtotal: number; lineDiscountAmount: number; netAmount: number; lineTaxAmount: number; lineTotal: number };

// One line's money: gross, its discount, net, the tax of every rate on it
// (taxed on the net), and the total.
function lineMoney(
  lineSubtotal: number,
  discountType: DiscountType | null,
  discountValue: number | null,
  taxRateIds: string[],
  taxRates: TaxRate[],
): LineMoney {
  const discAmt = lineDiscountAmount(lineSubtotal, discountType, discountValue);
  const netAmount = round2(lineSubtotal - discAmt);
  const lineTaxAmount = round2(
    taxRates.filter((r) => taxRateIds.includes(r.id)).reduce((sum, rate) => sum + netAmount * (rate.percentage / 100), 0),
  );
  return { lineSubtotal, lineDiscountAmount: discAmt, netAmount, lineTaxAmount, lineTotal: round2(netAmount + lineTaxAmount) };
}

// The cart's lines with their money, and the document totals. Product
// lines are passed already price-levelled (the page applies the customer's
// level first); a service line is one unit at its price.
export function computeTotals(productLines: (CartLine & { key: string })[], services: ServiceLine[], taxRates: TaxRate[]) {
  const cartLines = productLines.map((line) => ({
    ...line,
    ...lineMoney(line.unitPrice * line.quantity, line.discountType, line.discountValue, line.taxRateIds, taxRates),
  }));
  const serviceLines = services.map((s) => ({
    ...s,
    ...lineMoney(s.unitPrice ?? 0, s.discountType, s.discountValue, s.taxRateIds, taxRates),
  }));
  const all: LineMoney[] = [...cartLines, ...serviceLines];
  const subtotal = all.reduce((sum, l) => sum + l.lineSubtotal, 0);
  const discount = round2(all.reduce((sum, l) => sum + l.lineDiscountAmount, 0));
  const taxAmount = round2(all.reduce((sum, l) => sum + l.lineTaxAmount, 0));
  return { cartLines, serviceLines, subtotal, discount, taxAmount, total: round2(subtotal - discount + taxAmount) };
}

// ---- service lines (workshop labour etc.) --------------------------------

export function newServiceLine(key: string, defaultTaxRateId: string | undefined): ServiceLine {
  return {
    key,
    description: '',
    unitPrice: null,
    unit: null,
    taxRateIds: defaultTaxRateId ? [defaultTaxRateId] : [],
    discountType: null,
    discountValue: null,
  };
}

function updateService(services: ServiceLine[], key: string, fn: (s: ServiceLine) => ServiceLine) {
  return services.map((s) => (s.key === key ? fn(s) : s));
}

export function setServiceUnit(services: ServiceLine[], key: string, value: string) {
  return updateService(services, key, (s) => ({ ...s, unit: value.trim() || null }));
}

export function setServiceDescription(services: ServiceLine[], key: string, value: string) {
  return updateService(services, key, (s) => ({ ...s, description: value }));
}

// Empty clears the price; anything unparseable keeps the current one.
export function setServicePrice(services: ServiceLine[], key: string, raw: string) {
  return updateService(services, key, (s) => {
    if (raw.trim() === '') return { ...s, unitPrice: null };
    const parsed = Number(raw);
    return { ...s, unitPrice: Number.isFinite(parsed) && parsed >= 0 ? parsed : s.unitPrice };
  });
}

export function toggleServiceTax(services: ServiceLine[], key: string, taxRateId: string) {
  return updateService(services, key, (s) => ({ ...s, taxRateIds: toggled(s.taxRateIds, taxRateId) }));
}

export function setServiceDiscount(services: ServiceLine[], key: string, discountType: DiscountType | null, rawValue?: string) {
  return updateService(services, key, (s) =>
    discountType === null
      ? { ...s, discountType: null, discountValue: null }
      : { ...s, discountType, discountValue: clampDiscount(discountType, rawValue, s.discountValue) },
  );
}

export function applyTaxToAllServices(services: ServiceLine[], taxRateId: string, checked: boolean) {
  return services.map((s) => ({ ...s, taxRateIds: withTax(s.taxRateIds, taxRateId, checked) }));
}

export function applyDiscountToAllServices(services: ServiceLine[], discountType: DiscountType | null, value: number) {
  return services.map((s) => ({ ...s, discountType, discountValue: discountType ? value : null }));
}

// ---- request bodies ------------------------------------------------------

export const NO_BANK_ACCOUNT = '__none__';

// The items of a draft save: product lines as priced in the cart, plus the
// workshop's service lines that have both a description and a price.
export function buildInvoiceItems(cartLines: CartLine[], services: ServiceLine[], hasWorkshopRms: boolean) {
  const productItems = cartLines.map((line) => ({
    productId: line.product.id,
    quantity: line.quantity,
    unit: line.unit ?? undefined,
    locationId: line.locationId,
    unitPrice: line.unitPrice,
    // A typed (custom) price comes from no level.
    priceLevelId: line.priceCustom ? undefined : (line.priceLevelId ?? undefined),
    taxRateIds: line.taxRateIds,
    discountType: line.discountType ?? undefined,
    discountValue: line.discountValue ?? undefined,
    ...(line.serialNumbers?.length && { serialNumbers: line.serialNumbers }),
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

export type InvoiceHeaderForm = {
  format: string;
  customer: Customer | null;
  customerName: string;
  vehicleId: string | null;
  customerPoNumber: string;
  paymentTerms: string;
  notes: string;
  odometer: string;
  hasWorkshopRms: boolean;
  // '' = untouched, NO_BANK_ACCOUNT = none, otherwise an account id.
  bankAccountId: string;
  employeeId: string;
  // Multi-branch businesses: the branch making the sale ('' = default).
  branchId?: string;
};

// Everything but the items, for both creating and updating a draft.
export function buildInvoiceHeader(f: InvoiceHeaderForm) {
  const full = f.format === 'A5' || f.format === 'A4';
  const odometer = Number(f.odometer);
  return {
    // Explicit nulls, not undefined: undefined is dropped from the JSON and
    // the backend keeps the draft's old value, so switching to receipt
    // format (or removing the customer/vehicle) never actually cleared them.
    ...(full
      ? { customerId: f.customer?.id ?? null, customerName: null, vehicleId: f.vehicleId ?? null }
      : { customerId: null, customerName: f.customerName.trim() || null, vehicleId: null }),
    ...(f.hasWorkshopRms && full && f.vehicleId && f.odometer.trim() && Number.isFinite(odometer) && { odometer }),
    ...(full && {
      customerPoNumber: f.customerPoNumber.trim() || undefined,
      paymentTerms: f.paymentTerms.trim() || undefined,
      notes: f.notes.trim() || undefined,
    }),
    // Untouched leaves the backend to pick the org's default account.
    ...(f.bankAccountId !== '' && { bankAccountId: f.bankAccountId === NO_BANK_ACCOUNT ? null : f.bankAccountId }),
    employeeId: f.employeeId || null,
    ...(f.branchId && { branchId: f.branchId }),
  };
}

// ---- responses -----------------------------------------------------------

export async function extractErrorMessage(
  res: Response,
  t: (key: string, vars?: Record<string, string | number>) => string,
): Promise<string> {
  try {
    const data = await res.json();
    return data?.message || JSON.stringify(data);
  } catch {
    return res.statusText || t('sales.invoicesNew.requestFailed', { status: res.status });
  }
}

// A 409 from POST /invoices/:id/print under StockPolicy.WARN — the backend
// refused to oversell without confirmation. Ask, then the caller resubmits
// with confirmOversell: true. Not a generic error: this is the one 409 the
// print endpoint uses for this specific reason (see
// StockConfirmationRequiredException on the backend).
export async function confirmStockOversell(res: Response): Promise<boolean> {
  try {
    const data = await res.json();
    if (data?.error !== 'STOCK_CONFIRMATION_REQUIRED') return false;
    return window.confirm(data.message as string);
  } catch {
    return false;
  }
}
