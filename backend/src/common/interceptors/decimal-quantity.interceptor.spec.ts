import { Prisma } from '@prisma/client';
import { quantitiesToNumbers } from './decimal-quantity.interceptor';

describe('quantitiesToNumbers', () => {
  it('turns Decimal quantities into numbers at any depth and leaves money as Decimal', () => {
    const body = {
      items: [
        {
          quantity: new Prisma.Decimal('2.50'),
          fulfilledQuantity: new Prisma.Decimal('1'),
          reservedQuantity: new Prisma.Decimal('0'),
          unitPrice: new Prisma.Decimal('10000.00'),
        },
      ],
      _sum: { quantity: new Prisma.Decimal('3.25') },
      session: { items: [{ qty: new Prisma.Decimal('0.5') }] },
    };

    const out = quantitiesToNumbers(body) as any;

    expect(out.items[0].quantity).toBe(2.5);
    expect(out.items[0].fulfilledQuantity).toBe(1);
    expect(out.items[0].reservedQuantity).toBe(0);
    expect(Prisma.Decimal.isDecimal(out.items[0].unitPrice)).toBe(true);
    expect(out._sum.quantity).toBe(3.25);
    expect(out.session.items[0].qty).toBe(0.5);
  });

  it('passes through non-plain objects, plain numbers and nulls', () => {
    const date = new Date();
    const buf = Buffer.from('x');
    const out = quantitiesToNumbers({ createdAt: date, file: buf, quantity: 3, fulfilledQuantity: null }) as any;
    expect(out.createdAt).toBe(date);
    expect(out.file).toBe(buf);
    expect(out.quantity).toBe(3);
    expect(out.fulfilledQuantity).toBeNull();
  });
});
