import { PinSource } from '@prisma/client';
import { backfillCustomerPin, manualPinData } from './customer-pin-backfill';

function makePrisma(
  customer: { address: string | null } | null,
  saved: { id: string; address: string | null }[] = [],
) {
  return {
    customer: {
      findFirst: jest.fn().mockResolvedValue(customer),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    customerAddress: {
      findMany: jest.fn().mockResolvedValue(saved),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
}

const base = {
  organizationId: 'org1',
  customerId: 'c1',
  deliveryAddress: 'Komplek XYZ Blok B No. 6',
  latitude: -6.2,
  longitude: 106.8,
  accuracy: 15,
};

// No pin yet, or a GPS pin less accurate than this fix — never MANUAL.
const replaceable = (accuracy: number) => ({
  OR: [{ latitude: null }, { pinSource: PinSource.GPS, pinAccuracy: { gt: accuracy } }],
});
const gpsPin = (accuracy: number) => ({
  latitude: -6.2,
  longitude: 106.8,
  pinSource: PinSource.GPS,
  pinAccuracy: accuracy,
  pinSetAt: expect.any(Date),
});

describe('backfillCustomerPin', () => {
  it('pins the customer default address unless a better or manual pin is there', async () => {
    const prisma = makePrisma({ address: '  komplek xyz  blok B No. 6 ' });
    await backfillCustomerPin(prisma, base);
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org1', ...replaceable(15) },
      data: gpsPin(15),
    });
    expect(prisma.customerAddress.updateMany).not.toHaveBeenCalled();
  });

  it('pins a matching saved address instead of the default', async () => {
    const prisma = makePrisma({ address: 'Jl. Lain 1' }, [
      { id: 'a1', address: 'Gudang Timur' },
      { id: 'a2', address: 'Komplek XYZ Blok B No. 6' },
    ]);
    await backfillCustomerPin(prisma, base);
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
    expect(prisma.customerAddress.updateMany).toHaveBeenCalledWith({
      where: { id: 'a2', ...replaceable(15) },
      data: gpsPin(15),
    });
  });

  it('leaves the customer alone for a one-off delivery address', async () => {
    const prisma = makePrisma({ address: 'Jl. Lain 1' }, [
      { id: 'a1', address: 'Gudang Timur' },
    ]);
    await backfillCustomerPin(prisma, base);
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
    expect(prisma.customerAddress.updateMany).not.toHaveBeenCalled();
  });

  it('still saves a weak fix (flagged by its accuracy)', async () => {
    const prisma = makePrisma({ address: base.deliveryAddress });
    await backfillCustomerPin(prisma, { ...base, accuracy: 250 });
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org1', ...replaceable(250) },
      data: gpsPin(250),
    });
  });

  it.each([
    ['no GPS', { latitude: undefined, longitude: undefined }],
    ['no accuracy', { accuracy: undefined }],
    ['no customer', { customerId: null }],
  ])('does nothing with %s', async (_label, override) => {
    const prisma = makePrisma({ address: base.deliveryAddress });
    await backfillCustomerPin(prisma, { ...base, ...override });
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });
});

describe('manualPinData', () => {
  it('leaves the pin alone when no location is given', () => {
    expect(manualPinData(undefined, undefined)).toEqual({});
  });

  it('marks an office-set location as MANUAL', () => {
    expect(manualPinData(-6.2, 106.8)).toEqual({
      latitude: -6.2,
      longitude: 106.8,
      pinSource: PinSource.MANUAL,
      pinAccuracy: null,
      pinSetAt: expect.any(Date),
    });
  });

  it('clears the pin and its source together', () => {
    expect(manualPinData(null, null)).toEqual({
      latitude: null,
      longitude: null,
      pinSource: null,
      pinAccuracy: null,
      pinSetAt: null,
    });
  });

  it('rejects half a location', () => {
    expect(() => manualPinData(-6.2, undefined)).toThrow(/both latitude and longitude/);
  });
});
