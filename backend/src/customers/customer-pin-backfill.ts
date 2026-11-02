// src/customers/customer-pin-backfill.ts
import { BadRequestException } from '@nestjs/common';
import { PinSource, Prisma, RouteStatus } from '@prisma/client';
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
  const fill = { organizationId, customerId, latitude, longitude };
  if (params.customerAddressId) {
    const { count } = await prisma.customerAddress.updateMany({
      where: { id: params.customerAddressId, organizationId, customerId, ...replaceable },
      data: pin,
    });
    if (count) await fillOpenStopPins(prisma, { ...fill, customerAddressId: params.customerAddressId });
    return;
  }

  const target = normalizeAddress(params.deliveryAddress);

  if (!target || target === normalizeAddress(customer.address)) {
    const { count } = await prisma.customer.updateMany({
      where: { id: customerId, organizationId, ...replaceable },
      data: pin,
    });
    if (count) await fillOpenStopPins(prisma, { ...fill, customerAddressId: null, address: customer.address });
    return;
  }

  const saved = await prisma.customerAddress.findMany({
    where: { organizationId, customerId },
    select: { id: true, address: true },
  });
  const match = saved.find((a) => normalizeAddress(a.address) === target);
  if (!match) return;
  const { count } = await prisma.customerAddress.updateMany({
    where: { id: match.id, ...replaceable },
    data: pin,
  });
  if (count) await fillOpenStopPins(prisma, { ...fill, customerAddressId: match.id });
}

// Stops copy the customer's pin when they're added, so stops already
// planned on routes still to be driven (the rest of the week's schedule)
// were added with no pin. Give the ones still without one the new pin,
// so the next driver there can navigate. A stop with a pin of its own
// (set on the route) keeps it.
// For the main address (customerAddressId null), only stops going to that
// address text — not one-off sites for the same customer.
async function fillOpenStopPins(
  prisma: PrismaService,
  params: {
    organizationId: string;
    customerId: string;
    customerAddressId: string | null;
    address?: string | null;
    latitude: number;
    longitude: number;
  },
): Promise<void> {
  const stops = await prisma.routeStop.findMany({
    where: {
      customerId: params.customerId,
      customerAddressId: params.customerAddressId,
      destinationLatitude: null,
      signedAt: null,
      failedAt: null,
      supersededAt: null,
      route: {
        organizationId: params.organizationId,
        status: { in: [RouteStatus.PLANNED, RouteStatus.ACTIVE] },
      },
    },
    select: { id: true, address: true },
  });
  const main = normalizeAddress(params.address);
  const ids = stops
    .filter((s) => {
      if (params.customerAddressId) return true;
      const a = normalizeAddress(s.address);
      return !a || a === main;
    })
    .map((s) => s.id);
  if (!ids.length) return;
  await prisma.routeStop.updateMany({
    where: { id: { in: ids }, destinationLatitude: null },
    data: { destinationLatitude: params.latitude, destinationLongitude: params.longitude },
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
