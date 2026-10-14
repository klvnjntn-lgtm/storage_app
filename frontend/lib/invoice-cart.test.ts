import { describe, expect, it } from 'vitest';
import type { CartLine, ServiceLine } from '@/app/components/invoices/types';
import {
  applyDiscountToAllLines,
  applyTaxToAllLines,
  buildInvoiceHeader,
  NO_BANK_ACCOUNT,
  cartKey,
  changeQty,
  clampDiscount,
  computeTotals,
  hasSaveableContent,
  lineDiscountAmount,
  newServiceLine,
  removeLine,
  resolveCartTarget,
  setLineDiscount,
  setLineSerials,
  setServicePrice,
  setUnitPrice,
  toggleLineTax,
  type Cart,
} from './invoice-cart';

function line(stock: number, quantity = 1): CartLine {
  return {
    product: { id: 'p1', name: 'Oil', stockByLocation: [{ locationId: 'loc', locationName: 'Main', quantity: stock }] },
    quantity,
    unitPrice: 10_000,
    unit: null,
    locationId: 'loc',
    locationName: 'Main',
    taxRateIds: [],
    discountType: null,
    discountValue: null,
  } as unknown as CartLine;
}

const key = cartKey('p1', 'loc');
const cartOf = (l: CartLine): Cart => ({ [key]: l });

describe('line discounts', () => {
  it('computes percentage and fixed discounts, fixed never above the line', () => {
    expect(lineDiscountAmount(10_000, 'PERCENTAGE', 15)).toBe(1_500);
    expect(lineDiscountAmount(10_000, 'FIXED', 25_000)).toBe(10_000);
    expect(lineDiscountAmount(10_000, null, 50)).toBe(0);
  });

  it('caps a typed percentage at 100 and keeps the old value on garbage', () => {
    expect(clampDiscount('PERCENTAGE', '500', 0)).toBe(100);
    expect(clampDiscount('FIXED', '500', 0)).toBe(500);
    expect(clampDiscount('FIXED', 'abc', 7)).toBe(7);
    expect(clampDiscount('FIXED', '-3', 7)).toBe(7);
  });
});

describe('quantity steps', () => {
  it('stops at stock unless overselling is allowed, and removes at zero', () => {
    expect(changeQty(cartOf(line(2, 2)), key, 1, false)[key].quantity).toBe(2);
    expect(changeQty(cartOf(line(2, 2)), key, 1, true)[key].quantity).toBe(3);
    expect(changeQty(cartOf(line(5, 1)), key, -1, false)).toEqual({});
    expect(changeQty(cartOf(line(5, 1)), key, 0.25, false)[key].quantity).toBe(1.25);
  });

  it('leaves an unknown line alone', () => {
    const cart = cartOf(line(5));
    expect(changeQty(cart, 'nope', 1, false)).toBe(cart);
  });
});

describe('line edits', () => {
  it('marks a typed price as custom and never goes negative', () => {
    const c = setUnitPrice(cartOf(line(5)), key, '-5');
    expect(c[key].unitPrice).toBe(0);
    expect(c[key].priceCustom).toBe(true);
  });

  it('toggles a tax rate on and off, and applies one to every line', () => {
    let c = toggleLineTax(cartOf(line(5)), key, 'ppn');
    expect(c[key].taxRateIds).toEqual(['ppn']);
    c = toggleLineTax(c, key, 'ppn');
    expect(c[key].taxRateIds).toEqual([]);
    c = applyTaxToAllLines(c, 'ppn', true);
    expect(applyTaxToAllLines(c, 'ppn', true)[key].taxRateIds).toEqual(['ppn']);
  });

  it('sets, clears and bulk-applies discounts', () => {
    let c = setLineDiscount(cartOf(line(5)), key, 'PERCENTAGE', '250');
    expect(c[key].discountValue).toBe(100);
    c = setLineDiscount(c, key, null);
    expect(c[key]).toMatchObject({ discountType: null, discountValue: null });
    expect(applyDiscountToAllLines(c, 'FIXED', 500)[key]).toMatchObject({ discountType: 'FIXED', discountValue: 500 });
  });

  it('removes without mutating the old cart', () => {
    const c = cartOf(line(5));
    expect(removeLine(c, key)).toEqual({});
    expect(c[key]).toBeDefined();
  });
});

describe('serial numbers', () => {
  it('keeps no more serials than units when the quantity drops', () => {
    let c = setLineSerials(cartOf(line(5, 3)), key, ['A', 'B', 'C']);
    c = changeQty(c, key, -1, false);
    expect(c[key].serialNumbers).toEqual(['A', 'B']);
    expect(changeQty(c, key, 1, false)[key].serialNumbers).toEqual(['A', 'B']);
  });
});

describe('service lines', () => {
  it('starts with the default tax and parses prices leniently', () => {
    const s: ServiceLine[] = [newServiceLine('s1', 'ppn')];
    expect(s[0].taxRateIds).toEqual(['ppn']);
    expect(setServicePrice(s, 's1', '25000')[0].unitPrice).toBe(25_000);
    expect(setServicePrice(setServicePrice(s, 's1', '25000'), 's1', 'x')[0].unitPrice).toBe(25_000);
    expect(setServicePrice(s, 's1', '  ')[0].unitPrice).toBeNull();
  });
});

describe('adding to the cart', () => {
  const product = {
    id: 'p1',
    name: 'Oil',
    stockByLocation: [
      { locationId: 'a', locationName: 'A', quantity: 2 },
      { locationId: 'b', locationName: 'B', quantity: 5 },
    ],
  } as never;

  it('takes from the fullest location, or the filtered one', () => {
    expect(resolveCartTarget({}, product, 1, null, false)).toMatchObject({ ok: true, target: { locationId: 'b' } });
    expect(resolveCartTarget({}, product, 1, { id: 'a', name: 'A' } as never, false)).toMatchObject({ ok: true, target: { locationId: 'a' } });
  });

  it('refuses past stock unless overselling is allowed', () => {
    expect(resolveCartTarget({}, product, 3, { id: 'a', name: 'A' } as never, false)).toMatchObject({
      ok: false,
      error: 'sales.invoicesNew.onlyAvailable',
    });
    expect(resolveCartTarget({}, product, 3, { id: 'a', name: 'A' } as never, true)).toMatchObject({ ok: true, nextQty: 3 });
    expect(resolveCartTarget({}, product, 1, { id: 'c', name: 'C' } as never, true)).toMatchObject({ ok: true, target: { quantity: 0 } });
    expect(resolveCartTarget({}, { ...(product as object), stockByLocation: [] } as never, 1, null, true)).toMatchObject({
      ok: false,
      error: 'sales.invoicesNew.pickLocationToOversell',
    });
  });
});

describe('totals', () => {
  it('taxes the net after discount and adds service lines', () => {
    const ppn = { id: 'ppn', name: 'PPN', percentage: 11 } as never;
    const l = { ...line(5, 2), key, discountType: 'PERCENTAGE' as const, discountValue: 10, taxRateIds: ['ppn'] };
    const svc = { ...newServiceLine('s', 'ppn'), unitPrice: 50_000 };
    const r = computeTotals([l], [svc], [ppn]);
    expect(r.cartLines[0]).toMatchObject({ lineSubtotal: 20_000, lineDiscountAmount: 2_000, netAmount: 18_000, lineTaxAmount: 1_980 });
    expect(r.subtotal).toBe(70_000);
    expect(r.discount).toBe(2_000);
    expect(r.taxAmount).toBe(7_480);
    expect(r.total).toBe(75_480);
  });
});

describe('draft autosave', () => {
  it('saves a bare customer pick, but not an empty service row', () => {
    expect(hasSaveableContent({}, [], true, null, '')).toBe(false);
    expect(hasSaveableContent({}, [], false, null, 'Budi')).toBe(true);
    expect(hasSaveableContent({}, [newServiceLine('s', undefined)], true, null, '')).toBe(false);
  });
});

describe('draft request body', () => {
  const base = {
    format: 'RECEIPT',
    customer: null,
    customerName: ' Walk-in ',
    vehicleId: 'v1',
    customerPoNumber: 'PO-9',
    paymentTerms: '',
    notes: '',
    odometer: '12000',
    hasWorkshopRms: true,
    bankAccountId: '',
    employeeId: '',
  };

  it('clears customer/vehicle fields explicitly on a receipt', () => {
    expect(buildInvoiceHeader(base)).toEqual({ customerId: null, customerName: 'Walk-in', vehicleId: null, employeeId: null });
  });

  it('sends the full set on an A4 invoice, and an explicit "no bank account"', () => {
    const h = buildInvoiceHeader({ ...base, format: 'A4', customer: { id: 'c1' } as never, bankAccountId: NO_BANK_ACCOUNT });
    expect(h).toMatchObject({ customerId: 'c1', customerName: null, vehicleId: 'v1', odometer: 12000, customerPoNumber: 'PO-9', bankAccountId: null });
    expect(h).not.toHaveProperty('notes', '');
  });
});
