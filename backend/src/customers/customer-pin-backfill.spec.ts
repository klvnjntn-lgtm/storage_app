import { PinSource } from '@prisma/client';
import {
  PIN_FIX_WINDOW_MS,
  PIN_OUTVOTE_COUNT,
  PIN_VISIT_GAP_MS,
  PIN_SETTLED_COUNT,
  backfillCustomerPin,
  fixIsTimely,
  manualPinData,
  nextPin,
  type PinState,
} from './customer-pin-backfill';

function makePrisma(
  customer: { address: string | null } | null,
  saved: { id: string; address: string | null }[] = [],
  openStops: { id: string; address: string | null }[] = [],
  openOrders: { id: string; deliveryAddress: string | null }[] = [],
) {
  return {
    routeStop: {
      findMany: jest.fn().mockResolvedValue(openStops),
      updateMany: jest.fn().mockResolvedValue({ count: openStops.length }),
    },
    deliveryOrder: {
      findMany: jest.fn().mockResolvedValue(openOrders),
      updateMany: jest.fn().mockResolvedValue({ count: openOrders.length }),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue(customer),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    customerAddress: {
      findFirst: jest.fn().mockResolvedValue(saved[0] ?? null),
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
  timely: true,
};

// The UPDATE only applies to the pin as it was read: here, no pin.
const unpinned = { latitude: null, longitude: null, pinSource: null, pinConfirmations: 0, pinChallengerCount: 0, pinVotedAt: null };
const noChallenger = { pinChallengerLatitude: null, pinChallengerLongitude: null, pinChallengerCount: 0 };
const gpsPin = (accuracy: number, confirmations = 1) => ({
  latitude: -6.2,
  longitude: 106.8,
  pinSource: PinSource.GPS,
  pinAccuracy: accuracy,
  pinSetAt: expect.any(Date),
  pinRecheck: false,
  pinConfirmations: confirmations,
  // A counted delivery records when; a weak or late one counts for nothing.
  pinVotedAt: confirmations > 0 ? expect.any(Date) : null,
  ...noChallenger,
});

describe('backfillCustomerPin', () => {
  it('pins the customer default address', async () => {
    const prisma = makePrisma({ address: '  komplek xyz  blok B No. 6 ' });
    await backfillCustomerPin(prisma, base);
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org1', ...unpinned },
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
      where: { id: 'a2', ...unpinned },
      data: gpsPin(15),
    });
  });

  it('pins the saved address a route stop names, whatever its text', async () => {
    const prisma = makePrisma({ address: base.deliveryAddress }, [{ id: 'a9', address: null }]);
    await backfillCustomerPin(prisma, { ...base, customerAddressId: 'a9', deliveryAddress: 'anything' });
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
    expect(prisma.customerAddress.updateMany).toHaveBeenCalledWith({
      where: { id: 'a9', organizationId: 'org1', customerId: 'c1', ...unpinned },
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

  it('still saves a weak fix (flagged by its accuracy), without counting it', async () => {
    const prisma = makePrisma({ address: base.deliveryAddress });
    await backfillCustomerPin(prisma, { ...base, accuracy: 250 });
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org1', ...unpinned },
      data: gpsPin(250, 0),
    });
  });

  it('gives the new pin to open stops at that address still without one', async () => {
    const prisma = makePrisma({ address: base.deliveryAddress }, [], [
      { id: 's1', address: 'komplek xyz blok b no. 6' },
      { id: 's2', address: 'Proyek Lain' },
      { id: 's3', address: null },
    ]);
    await backfillCustomerPin(prisma, base);
    expect(prisma.routeStop.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: 'c1', customerAddressId: null, destinationLatitude: null }),
      }),
    );
    expect(prisma.routeStop.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1', 's3'] }, destinationLatitude: null },
      data: { destinationLatitude: -6.2, destinationLongitude: 106.8 },
    });
  });

  it('gives the new pin to delivery orders still to go to that address, not one-off ones', async () => {
    const prisma = makePrisma({ address: base.deliveryAddress }, [], [], [
      { id: 'd1', deliveryAddress: 'komplek xyz blok b no. 6' },
      { id: 'd2', deliveryAddress: 'Proyek Lain' },
    ]);
    await backfillCustomerPin(prisma, base);
    expect(prisma.deliveryOrder.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['d1'] }, destinationLatitude: null },
      data: { destinationLatitude: -6.2, destinationLongitude: 106.8 },
    });
  });

  it('moves stops that still hold the pin a better fix replaced', async () => {
    const prisma = makePrisma(
      {
        address: base.deliveryAddress,
        latitude: -6.1,
        longitude: 106.7,
        pinSource: PinSource.GPS,
        pinAccuracy: 30,
        pinConfirmations: 1,
      } as never,
      [],
      [{ id: 's1', address: base.deliveryAddress }],
    );
    await backfillCustomerPin(prisma, base);
    expect(prisma.routeStop.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['s1'] },
        OR: [{ destinationLatitude: null }, { destinationLatitude: -6.1, destinationLongitude: 106.7 }],
      },
      data: { destinationLatitude: -6.2, destinationLongitude: 106.8 },
    });
  });

  it('only counts a confirming fix that is not more accurate, leaving stops alone', async () => {
    const prisma = makePrisma(
      {
        address: base.deliveryAddress,
        latitude: -6.2,
        longitude: 106.8,
        pinSource: PinSource.GPS,
        pinAccuracy: 8,
        pinRecheck: false,
        pinConfirmations: 1,
      } as never,
      [],
      [{ id: 's1', address: null }],
    );
    await backfillCustomerPin(prisma, base);
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'c1',
        organizationId: 'org1',
        latitude: -6.2,
        longitude: 106.8,
        pinSource: PinSource.GPS,
        pinConfirmations: 1,
        pinChallengerCount: 0,
        pinVotedAt: null,
      },
      data: { pinConfirmations: 2, ...noChallenger, pinVotedAt: expect.any(Date) },
    });
    expect(prisma.routeStop.findMany).not.toHaveBeenCalled();
  });

  it('lets a late reading fill an empty pin only, marked for recheck', async () => {
    const prisma = makePrisma({ address: base.deliveryAddress });
    await backfillCustomerPin(prisma, { ...base, timely: false });
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org1', ...unpinned },
      data: { ...gpsPin(15, 0), pinRecheck: true },
    });
  });

  it('leaves open stops alone when the pin was not replaced', async () => {
    const prisma = makePrisma({ address: base.deliveryAddress }, [], [{ id: 's1', address: null }]);
    prisma.customer.updateMany.mockResolvedValue({ count: 0 });
    await backfillCustomerPin(prisma, base);
    expect(prisma.routeStop.findMany).not.toHaveBeenCalled();
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

// 0.0001° of latitude ≈ 11 m.
const pinAt = (over: Partial<PinState> = {}): PinState => ({
  latitude: -6.2,
  longitude: 106.8,
  pinSource: PinSource.GPS,
  pinAccuracy: 10,
  pinRecheck: false,
  pinConfirmations: 1,
  pinChallengerLatitude: null,
  pinChallengerLongitude: null,
  pinChallengerCount: 0,
  ...over,
});
const fixAt = (northMeters: number, accuracy: number) => ({
  latitude: -6.2 + northMeters / 111_195,
  longitude: 106.8,
  accuracy,
});

describe('fixIsTimely', () => {
  const photo = new Date('2026-11-14T03:00:00Z');
  const off = (ms: number) => new Date(photo.getTime() + ms);
  it('accepts a reading within the window either side of the photo', () => {
    expect(fixIsTimely(off(-PIN_FIX_WINDOW_MS), photo)).toBe(true);
    expect(fixIsTimely(off(PIN_FIX_WINDOW_MS).toISOString(), photo)).toBe(true);
  });
  it('rejects one further off, or with a time unknown', () => {
    expect(fixIsTimely(off(PIN_FIX_WINDOW_MS + 1), photo)).toBe(false);
    expect(fixIsTimely(off(-20_000), photo)).toBe(false);
    expect(fixIsTimely(undefined, photo)).toBe(false);
    expect(fixIsTimely(photo, null)).toBe(false);
  });
});

// Deliveries on separate days: separate visits, each counted.
const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 3));

describe('nextPin', () => {
  const empty = pinAt({ latitude: null, longitude: null, pinSource: null, pinAccuracy: null, pinConfirmations: 0 });

  it('pins an address with no pin, counting only a fix that is not weak', () => {
    expect(nextPin(empty, fixAt(0, 20), true)).toMatchObject({ pinSource: PinSource.GPS, pinConfirmations: 1 });
    expect(nextPin(empty, fixAt(0, 80), true)).toMatchObject({ pinSource: PinSource.GPS, pinConfirmations: 0 });
  });

  it('lets a late reading fill an empty pin, marked for recheck, and nothing else', () => {
    expect(nextPin(empty, fixAt(0, 5), false)).toMatchObject({ pinRecheck: true, pinConfirmations: 0 });
    expect(nextPin(pinAt(), fixAt(5, 5), false)).toBeNull();
    expect(nextPin(pinAt({ pinRecheck: true, pinConfirmations: 0 }), fixAt(100, 5), false)).toBeNull();
  });

  it('never touches a MANUAL pin', () => {
    expect(nextPin(pinAt({ pinSource: PinSource.MANUAL, pinAccuracy: null }), fixAt(200, 3), true)).toBeNull();
  });

  it('replaces a pin marked for recheck with any fix that is not weak', () => {
    const recheck = pinAt({ pinAccuracy: 4, pinRecheck: true, pinConfirmations: 0 });
    expect(nextPin(recheck, fixAt(120, 30), true)).toMatchObject({ pinAccuracy: 30, pinRecheck: false, pinConfirmations: 1 });
    expect(nextPin(recheck, fixAt(120, 60), true)).toBeNull();
  });

  it('counts a nearby fix, moving onto it only if it is more accurate, and drops any challenger', () => {
    const challenged = pinAt({ pinChallengerLatitude: -6.199, pinChallengerLongitude: 106.8, pinChallengerCount: 2 });
    expect(nextPin(challenged, fixAt(15, 20), true)).toEqual({ pinConfirmations: 2, ...noChallenger, pinVotedAt: expect.any(Date) });
    expect(nextPin(pinAt(), fixAt(15, 5), true)).toMatchObject({
      latitude: fixAt(15, 5).latitude,
      pinAccuracy: 5,
      pinConfirmations: 2,
    });
  });

  it('does not count a weak fix nearby', () => {
    expect(nextPin(pinAt({ pinAccuracy: 30 }), fixAt(5, 60), true)).toBeNull();
  });

  it('starts a challenger from a fix elsewhere that is less accurate than the pin', () => {
    expect(nextPin(pinAt(), fixAt(100, 15), true)).toEqual({
      pinChallengerLatitude: fixAt(100, 15).latitude,
      pinChallengerLongitude: 106.8,
      pinChallengerCount: 1,
      pinVotedAt: expect.any(Date),
    });
  });

  it('moves the pin once enough deliveries agree on another spot, however accurate the pin claims to be', () => {
    let pin = pinAt({ pinAccuracy: 3 });
    for (let i = 1; i < PIN_OUTVOTE_COUNT; i++) {
      const vote = nextPin(pin, fixAt(100 + i, 15), true, day(i));
      expect(vote).toMatchObject({ pinChallengerCount: i });
      pin = { ...pin, ...vote } as PinState;
    }
    expect(nextPin(pin, fixAt(103, 15), true, day(PIN_OUTVOTE_COUNT))).toMatchObject({
      latitude: fixAt(103, 15).latitude,
      pinAccuracy: 15,
      pinConfirmations: PIN_OUTVOTE_COUNT,
      ...noChallenger,
    });
  });

  it('starts the vote again for a fix away from the challenger', () => {
    const challenged = pinAt({ pinChallengerLatitude: -6.2 + 100 / 111_195, pinChallengerLongitude: 106.8, pinChallengerCount: 2 });
    expect(nextPin(challenged, fixAt(-100, 15), true)).toMatchObject({ pinChallengerCount: 1 });
  });

  it('lets a more accurate fix elsewhere replace an unsettled pin, keeping its votes', () => {
    const challenged = pinAt({ pinChallengerLatitude: -6.2 + 100 / 111_195, pinChallengerLongitude: 106.8, pinChallengerCount: 1 });
    expect(nextPin(challenged, fixAt(105, 5), true)).toMatchObject({ pinAccuracy: 5, pinConfirmations: 2, ...noChallenger });
    expect(nextPin(pinAt(), fixAt(-100, 5), true)).toMatchObject({ pinAccuracy: 5, pinConfirmations: 1 });
  });

  it('keeps a settled pin in place for a fix elsewhere, however accurate', () => {
    const settled = pinAt({ pinConfirmations: PIN_SETTLED_COUNT });
    expect(nextPin(settled, fixAt(100, 3), true)).toBeNull();
    expect(nextPin(settled, fixAt(10, 15), true)).toEqual({ pinConfirmations: PIN_SETTLED_COUNT + 1, ...noChallenger, pinVotedAt: expect.any(Date) });
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
      pinRecheck: false,
      pinConfirmations: 0,
      pinVotedAt: null,
      ...noChallenger,
    });
  });

  it('clears the pin and its source together', () => {
    expect(manualPinData(null, null)).toEqual({
      latitude: null,
      longitude: null,
      pinSource: null,
      pinAccuracy: null,
      pinSetAt: null,
      pinRecheck: false,
      pinConfirmations: 0,
      ...noChallenger,
    });
  });

  it('rejects half a location', () => {
    expect(() => manualPinData(-6.2, undefined)).toThrow(/both latitude and longitude/);
  });
});

describe('nextPin — one visit, one vote', () => {
  const empty = pinAt({ latitude: null, longitude: null, pinSource: null, pinAccuracy: null, pinConfirmations: 0 });
  const t0 = new Date('2026-11-14T03:00:00Z');
  const later = (ms: number) => new Date(t0.getTime() + ms);
  const apply = (s: PinState, d: object | null) => (d ? ({ ...s, ...d } as PinState) : s);

  it('counts several delivery orders dropped in one visit once', () => {
    let s = apply(empty, nextPin(empty, fixAt(0, 10), true, t0));
    s = apply(s, nextPin(s, fixAt(3, 12), true, later(60_000)));
    s = apply(s, nextPin(s, fixAt(-3, 11), true, later(120_000)));
    expect(s.pinConfirmations).toBe(1);
  });

  it('still moves onto a tighter reading of the same spot in that visit', () => {
    const s = apply(empty, nextPin(empty, fixAt(0, 10), true, t0));
    expect(nextPin(s, fixAt(3, 4), true, later(60_000))).toMatchObject({ pinAccuracy: 4 });
    expect(nextPin(s, fixAt(3, 4), true, later(60_000))).not.toHaveProperty('pinConfirmations');
  });

  it('counts the next visit', () => {
    const s = apply(empty, nextPin(empty, fixAt(0, 10), true, t0));
    expect(nextPin(s, fixAt(3, 12), true, later(PIN_VISIT_GAP_MS))).toMatchObject({ pinConfirmations: 2 });
  });

  it('lets one visit vote for a challenger only once', () => {
    const pin = pinAt({ pinAccuracy: 3, pinVotedAt: later(-PIN_VISIT_GAP_MS) });
    let s = apply(pin, nextPin(pin, fixAt(100, 15), true, t0));
    s = apply(s, nextPin(s, fixAt(101, 15), true, later(60_000)));
    s = apply(s, nextPin(s, fixAt(102, 15), true, later(120_000)));
    expect(s.pinChallengerCount).toBe(1);
    expect(Number(s.latitude)).toBe(-6.2);
  });

  it('does not let the visit that confirmed the pin also vote against it', () => {
    const pin = pinAt({ pinVotedAt: t0 });
    expect(nextPin(pin, fixAt(100, 15), true, later(60_000))).toBeNull();
  });
});

describe('nextPin — a confirmed pin', () => {
  it('is not replaced by one tighter reading elsewhere once two visits agree', () => {
    const pin = pinAt({ pinAccuracy: 12, pinConfirmations: 2 });
    expect(nextPin(pin, fixAt(80, 8), true)).toEqual({
      pinChallengerLatitude: fixAt(80, 8).latitude,
      pinChallengerLongitude: 106.8,
      pinChallengerCount: 1,
      pinVotedAt: expect.any(Date),
    });
  });
});
