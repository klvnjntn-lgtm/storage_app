import { backfillCustomerPin } from './customer-pin-backfill';

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

describe('backfillCustomerPin', () => {
  it('pins the customer default address, only where it has no pin yet', async () => {
    const prisma = makePrisma({ address: '  komplek xyz  blok B No. 6 ' });
    await backfillCustomerPin(prisma, base);
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org1', latitude: null },
      data: { latitude: -6.2, longitude: 106.8 },
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
      where: { id: 'a2', latitude: null },
      data: { latitude: -6.2, longitude: 106.8 },
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

  it.each([
    ['no GPS', { latitude: undefined, longitude: undefined }],
    ['no accuracy', { accuracy: undefined }],
    ['poor accuracy', { accuracy: 250 }],
    ['no customer', { customerId: null }],
  ])('does nothing with %s', async (_label, override) => {
    const prisma = makePrisma({ address: base.deliveryAddress });
    await backfillCustomerPin(prisma, { ...base, ...override });
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });
});
