// src/customers/customer-pin-backfill.ts
import { BadRequestException } from '@nestjs/common';
import { PinSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// A GPS pin vaguer than this still gets saved, but the office sees it
// flagged as weak — a 50m+ circle in a dense kampung could be the wrong
// street. Matches WEAK_PIN_ACCURACY_M on the frontend.
export const WEAK_PIN_ACCURACY_METERS = 50;

function normalizeAddress(address: string | null | undefined): string | null {
  const s = address?.trim().replace(/\s+/g, ' ').toLowerCase();
  return s || null;
}

// Sets a customer address's pin from the driver's GPS at a completed
// delivery, so addresses get mapped through normal deliveries:
// - an address with no pin gets this fix, however weak (a weak one is
//   flagged to the office via pinAccuracy);
// - a GPS pin is replaced only by a strictly more accurate fix;
// - a MANUAL pin (set in the office) is never touched.
// Those rules live in the UPDATE's WHERE, so a pin set concurrently by the
// office or a better fix always wins.
//
// A customer route stop for a saved address says which one directly
// (customerAddressId). Otherwise the delivered-to address text picks which
// pin to fill: the customer's default address, or a matching saved
// CustomerAddress. Anything else is a one-off site (job site, third party)
// and leaves the customer alone.
// Requires a reported accuracy — without one there's no telling whether
// the fix is any better than what's there.
export async function backfillCustomerPin(
  prisma: PrismaService,
  params: {
    organizationId: string;
    customerId: string | null;
    customerAddressId?: string | null;
    deliveryAddress: string | null;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
  },
): Promise<void> {
  const { organizationId, customerId, latitude, longitude, accuracy } = params;
  if (!customerId || latitude == null || longitude == null) return;
  if (accuracy == null) return;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { address: true },
  });
  if (!customer) return;

  const pin = {
    latitude,
    longitude,
    pinSource: PinSource.GPS,
    pinAccuracy: accuracy,
    pinSetAt: new Date(),
  };
  const replaceable = {
    OR: [
      { latitude: null },
      { pinSource: PinSource.GPS, pinAccuracy: { gt: accuracy } },
    ],
  } satisfies Prisma.CustomerWhereInput & Prisma.CustomerAddressWhereInput;
  if (params.customerAddressId) {
    await prisma.customerAddress.updateMany({
      where: { id: params.customerAddressId, organizationId, customerId, ...replaceable },
      data: pin,
    });
    return;
  }

  const target = normalizeAddress(params.deliveryAddress);

  if (!target || target === normalizeAddress(customer.address)) {
    await prisma.customer.updateMany({
      where: { id: customerId, organizationId, ...replaceable },
      data: pin,
    });
    return;
  }

  const saved = await prisma.customerAddress.findMany({
    where: { organizationId, customerId },
    select: { id: true, address: true },
  });
  const match = saved.find((a) => normalizeAddress(a.address) === target);
  if (!match) return;
  await prisma.customerAddress.updateMany({
    where: { id: match.id, ...replaceable },
    data: pin,
  });
}

// Pin fields for a location the office sets by hand (customer form, map
// picker, import, saved address). undefined = location not being changed;
// null = pin cleared, which also unlocks it for the next driver fix.
export function manualPinData(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
) {
  if (latitude === undefined && longitude === undefined) return {};
  if ((latitude == null) !== (longitude == null)) {
    throw new BadRequestException('Give both latitude and longitude, or neither');
  }
  if (latitude == null || longitude == null) {
    return {
      latitude: null,
      longitude: null,
      pinSource: null,
      pinAccuracy: null,
      pinSetAt: null,
    };
  }
  return {
    latitude,
    longitude,
    pinSource: PinSource.MANUAL,
    pinAccuracy: null,
    pinSetAt: new Date(),
  };
}
