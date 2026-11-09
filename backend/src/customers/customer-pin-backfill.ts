// src/customers/customer-pin-backfill.ts
import { BadRequestException } from '@nestjs/common';
import { DeliveryOrderStatus, PinSource, Prisma, RouteStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// A GPS pin vaguer than this still gets saved, but the office sees it
// flagged as weak — a 50m+ circle in a dense kampung could be the wrong
// street. Matches WEAK_PIN_ACCURACY_M on the frontend.
export const WEAK_PIN_ACCURACY_METERS = 50;

// A delivery order still to be delivered, so still free to follow the customer.
export const openDeliveryOrderWhere = {
  signedAt: null,
  status: { in: [DeliveryOrderStatus.PACKED, DeliveryOrderStatus.SHIPPED] },
} satisfies Prisma.DeliveryOrderWhereInput;

export function normalizeAddress(address: string | null | undefined): string | null {
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
    select: { address: true, latitude: true, longitude: true },
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
    const previous = await prisma.customerAddress.findFirst({
      where: { id: params.customerAddressId, organizationId, customerId },
      select: { address: true, latitude: true, longitude: true },
    });
    const { count } = await prisma.customerAddress.updateMany({
      where: { id: params.customerAddressId, organizationId, customerId, ...replaceable },
      data: pin,
    });
    if (count) {
      await fillOpenStopPins(prisma, {
        ...fill,
        customerAddressId: params.customerAddressId,
        address: previous?.address,
        previous: previous ?? undefined,
      });
    }
    return;
  }

  const target = normalizeAddress(params.deliveryAddress);

  if (!target || target === normalizeAddress(customer.address)) {
    const { count } = await prisma.customer.updateMany({
      where: { id: customerId, organizationId, ...replaceable },
      data: pin,
    });
    if (count) {
      await fillOpenStopPins(prisma, {
        ...fill,
        customerAddressId: null,
        address: customer.address,
        previous: customer,
      });
    }
    return;
  }

  const saved = await prisma.customerAddress.findMany({
    where: { organizationId, customerId },
    select: { id: true, address: true, latitude: true, longitude: true },
  });
  const match = saved.find((a) => normalizeAddress(a.address) === target);
  if (!match) return;
  const { count } = await prisma.customerAddress.updateMany({
    where: { id: match.id, ...replaceable },
    data: pin,
  });
  if (count) {
    await fillOpenStopPins(prisma, {
      ...fill,
      customerAddressId: match.id,
      address: match.address,
      previous: match,
    });
  }
}

// The undo of backfillCustomerPin, for a delivery whose result was reset or
// moved to another stop (the driver had marked the wrong one). Only a GPS pin
// still holding exactly that delivery's fix is cleared — one the office set,
// or a later driver fix, has nothing to do with this delivery and stays.
// What the cleared pin replaced isn't known, so the address goes back to
// unpinned, and the next delivery there fills it in. Open stops and delivery
// orders that copied the pin lose it with the customer.
// Same choice of address as backfillCustomerPin.
export async function releaseCustomerPin(
  prisma: PrismaService,
  params: {
    organizationId: string;
    customerId: string | null;
    customerAddressId?: string | null;
    deliveryAddress: string | null;
    latitude: Prisma.Decimal | number | null;
    longitude: Prisma.Decimal | number | null;
  },
): Promise<void> {
  const { organizationId, customerId, latitude, longitude } = params;
  if (!customerId || latitude == null || longitude == null) return;
  const held = { pinSource: PinSource.GPS, latitude, longitude };
  const cleared = { latitude: null, longitude: null, pinSource: null, pinAccuracy: null, pinSetAt: null };

  let addressId: string | null = null;
  let address: string | null | undefined;
  if (params.customerAddressId) {
    const { count } = await prisma.customerAddress.updateMany({
      where: { id: params.customerAddressId, organizationId, customerId, ...held },
      data: cleared,
    });
    if (!count) return;
    addressId = params.customerAddressId;
    address = (
      await prisma.customerAddress.findFirst({ where: { id: addressId }, select: { address: true } })
    )?.address;
  } else {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { address: true },
    });
    if (!customer) return;
    const target = normalizeAddress(params.deliveryAddress);
    if (!target || target === normalizeAddress(customer.address)) {
      const { count } = await prisma.customer.updateMany({
        where: { id: customerId, organizationId, ...held },
        data: cleared,
      });
      if (!count) return;
      address = customer.address;
    } else {
      const saved = await prisma.customerAddress.findMany({
        where: { organizationId, customerId },
        select: { id: true, address: true },
      });
      const match = saved.find((a) => normalizeAddress(a.address) === target);
      if (!match) return;
      const { count } = await prisma.customerAddress.updateMany({
        where: { id: match.id, ...held },
        data: cleared,
      });
      if (!count) return;
      addressId = match.id;
      address = match.address;
    }
  }

  const main = normalizeAddress(address);
  const stops = await prisma.routeStop.findMany({
    where: {
      customerId,
      customerAddressId: addressId,
      destinationLatitude: latitude,
      destinationLongitude: longitude,
      signedAt: null,
      failedAt: null,
      supersededAt: null,
      route: { organizationId, status: { in: [RouteStatus.PLANNED, RouteStatus.ACTIVE] } },
    },
    select: { id: true, address: true },
  });
  const stopIds = stops
    .filter((s) => {
      if (addressId) return true;
      const a = normalizeAddress(s.address);
      return !a || a === main;
    })
    .map((s) => s.id);
  if (stopIds.length) {
    await prisma.routeStop.updateMany({
      where: { id: { in: stopIds }, destinationLatitude: latitude, destinationLongitude: longitude },
      data: { destinationLatitude: null, destinationLongitude: null },
    });
  }
  const orders = await prisma.deliveryOrder.findMany({
    where: {
      organizationId,
      customerId,
      ...openDeliveryOrderWhere,
      destinationLatitude: latitude,
      destinationLongitude: longitude,
    },
    select: { id: true, deliveryAddress: true },
  });
  const orderIds = orders
    .filter((o) => {
      const a = normalizeAddress(o.deliveryAddress);
      return addressId ? a != null && a === main : !a || a === main;
    })
    .map((o) => o.id);
  if (orderIds.length) {
    await prisma.deliveryOrder.updateMany({
      where: { id: { in: orderIds }, destinationLatitude: latitude, destinationLongitude: longitude },
      data: { destinationLatitude: null, destinationLongitude: null },
    });
  }
}

// For a pin that changed on its own (a driver's fix, a photo's location), as
// opposed to an office edit (customer-stop-sync.ts). Stops and delivery orders
// still to be delivered copied the customer's pin when they were made, so they
// take the new one if they have none or still hold the one it replaced
// (previous). One with a different pin, set by hand, keeps it: nobody chose to
// override that.
// For the main address (customerAddressId null), only stops going to that
// address text — not one-off sites for the same customer. Stops copied the
// text too, so when the office changes it in the same save, the old text
// (previous.address) still counts as the main address.
export async function fillOpenStopPins(
  prisma: PrismaService,
  params: {
    organizationId: string;
    customerId: string;
    customerAddressId: string | null;
    address?: string | null;
    latitude: number;
    longitude: number;
    previous?: {
      latitude: Prisma.Decimal | null;
      longitude: Prisma.Decimal | null;
      address?: string | null;
    };
  },
): Promise<void> {
  const { previous } = params;
  const replaceable: Prisma.RouteStopWhereInput =
    previous?.latitude != null && previous.longitude != null
      ? {
          OR: [
            { destinationLatitude: null },
            { destinationLatitude: previous.latitude, destinationLongitude: previous.longitude },
          ],
        }
      : { destinationLatitude: null };
  const stops = await prisma.routeStop.findMany({
    where: {
      customerId: params.customerId,
      customerAddressId: params.customerAddressId,
      ...replaceable,
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
  const main = [params.address, previous?.address].map(normalizeAddress).filter(Boolean);
  const ids = stops
    .filter((s) => {
      if (params.customerAddressId) return true;
      const a = normalizeAddress(s.address);
      return !a || main.includes(a);
    })
    .map((s) => s.id);
  const pin = { destinationLatitude: params.latitude, destinationLongitude: params.longitude };
  if (ids.length) {
    await prisma.routeStop.updateMany({ where: { id: { in: ids }, ...replaceable }, data: pin });
  }

  // Delivery orders don't record which address they chose, only its text.
  const replaceableOrder: Prisma.DeliveryOrderWhereInput =
    previous?.latitude != null && previous.longitude != null
      ? {
          OR: [
            { destinationLatitude: null },
            { destinationLatitude: previous.latitude, destinationLongitude: previous.longitude },
          ],
        }
      : { destinationLatitude: null };
  const orders = await prisma.deliveryOrder.findMany({
    where: {
      organizationId: params.organizationId,
      customerId: params.customerId,
      ...openDeliveryOrderWhere,
      ...replaceableOrder,
    },
    select: { id: true, deliveryAddress: true },
  });
  const orderIds = orders
    .filter((o) => {
      const a = normalizeAddress(o.deliveryAddress);
      return params.customerAddressId ? a != null && main.includes(a) : !a || main.includes(a);
    })
    .map((o) => o.id);
  if (orderIds.length) {
    await prisma.deliveryOrder.updateMany({ where: { id: { in: orderIds }, ...replaceableOrder }, data: pin });
  }
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
