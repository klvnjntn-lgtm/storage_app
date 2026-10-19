import { PaymentStatus } from '@prisma/client';
import { accuratePayment } from './gdb-import.service';

describe('accuratePayment', () => {
  const inv = (amount: number, cols: Partial<Record<'PAIDAMOUNT' | 'PAYMENT' | 'RETURNAMOUNT' | 'TERMDISCOUNT', number>> = {}) =>
    accuratePayment({
      INVOICEAMOUNT: amount,
      PAIDAMOUNT: cols.PAIDAMOUNT ?? 0,
      PAYMENT: cols.PAYMENT ?? null,
      RETURNAMOUNT: cols.RETURNAMOUNT ?? null,
      TERMDISCOUNT: cols.TERMDISCOUNT ?? null,
    });

  it('counts money paid at the time of sale (PAYMENT) when PAIDAMOUNT is 0', () => {
    expect(inv(65000, { PAYMENT: 65000 })).toEqual({ paidAmount: 65000, paymentStatus: PaymentStatus.PAID });
  });

  it('adds later receipts, returns and receipt discounts', () => {
    expect(inv(100000, { PAYMENT: 50000, PAIDAMOUNT: 30000, RETURNAMOUNT: 15000, TERMDISCOUNT: 5000 }).paymentStatus).toBe(
      PaymentStatus.PAID,
    );
    expect(inv(100000, { PAIDAMOUNT: 40000 })).toEqual({ paidAmount: 40000, paymentStatus: PaymentStatus.PARTIAL });
  });

  it('leaves invoices with nothing recorded unpaid', () => {
    expect(inv(1000000)).toEqual({ paidAmount: 0, paymentStatus: PaymentStatus.UNPAID });
  });

  it('caps an overpaid invoice at its total', () => {
    expect(inv(180000, { PAIDAMOUNT: 560000 })).toEqual({ paidAmount: 180000, paymentStatus: PaymentStatus.PAID });
  });

  it('treats a zero-total invoice as paid', () => {
    expect(inv(0).paymentStatus).toBe(PaymentStatus.PAID);
  });

  it('tolerates Rp1 rounding', () => {
    expect(inv(100001, { PAYMENT: 100000 }).paymentStatus).toBe(PaymentStatus.PAID);
  });
});
