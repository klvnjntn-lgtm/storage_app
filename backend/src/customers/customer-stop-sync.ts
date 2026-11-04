// src/customers/customer-stop-sync.ts
import { Prisma, RouteStatus } from '@prisma/client';
import { normalizeAddress, openDeliveryOrderWhere } from './customer-pin-backfill';

type Coord = Prisma.Decimal | number | null;

export type CustomerSite = {
  // Saved address's name; unused for the main address.
  label?: string | null;
  address: string | null;
  latitude: Coord;
  longitude: Coord;
};

const coord = (v: Coord) => (v == null ? null : Number(v));

// Carries an office edit of a customer (or one of their saved addresses) onto
// everything still to be delivered: stops are snapshots taken when they were
// added, and a delivery order is one taken when it was created. Only fields
// this save changed are written, since the customer form resends everything,
// so a pin corrected on a route survives until the customer's own location
// next actually changes. Then the customer's newer location wins.
//
// Finished stops and signed delivery orders are records of what happened and
// stay as they were. A delivery order sent somewhere other than this address
// (job site, third party) keeps its address and pin, but not the old name. A
// stop whose saved address was deleted keeps its label, and with it its place.
//
// Returns the routes whose destinations moved. Call inside the transaction that
// saves the customer, so the two can't disagree.
export async function syncCustomerToOpenStops(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    customerId: string;
    // null = the customer's main address.
    customerAddressId: string | null;
    before: CustomerSite;
    after: CustomerSite;
    // Main address only: details of the customer rather than of a site.
    identity?: {
      before: { name: string; phone: string | null; address: string | null };
      after: { name: string; phone: string | null; address: string | null };
    };
  },
): Promise<string[]> {
  const { organizationId, customerId, customerAddressId, before, after, identity } = params;

  const openStops = {
    customerId,
    signedAt: null,
    failedAt: null,
    supersededAt: null,
    route: {
      organizationId,
      status: { in: [RouteStatus.PLANNED, RouteStatus.ACTIVE] },
    },
  } satisfies Prisma.RouteStopWhereInput;
  const openOrders = { organizationId, customerId, ...openDeliveryOrderWhere };

  if (identity) {
    const changed = {
      name: identity.before.name !== identity.after.name,
      phone: identity.before.phone !== identity.after.phone,
      address: identity.before.address !== identity.after.address,
    };
    if (changed.name) {
      await tx.routeStop.updateMany({ where: openStops, data: { customerName: identity.after.name } });
    }
    if (changed.name || changed.phone || changed.address) {
      await tx.deliveryOrder.updateMany({
        where: openOrders,
        data: {
          ...(changed.name ? { customerName: identity.after.name } : {}),
          ...(changed.phone ? { customerPhone: identity.after.phone } : {}),
          ...(changed.address ? { customerAddress: identity.after.address } : {}),
        },
      });
    }
  }

  const addressChanged = before.address !== after.address;
  const pinChanged =
    coord(before.latitude) !== coord(after.latitude) || coord(before.longitude) !== coord(after.longitude);
  const labelChanged = customerAddressId != null && before.label !== after.label;
  const moved = addressChanged || pinChanged;
  if (!moved && !labelChanged) return [];

  const pin = pinChanged ? { destinationLatitude: after.latitude, destinationLongitude: after.longitude } : {};
  const address = addressChanged ? after.address : undefined;

  // A main-address stop never carries a label: one that does had a saved
  // address, now deleted.
  const siteStops = {
    ...openStops,
    ...(customerAddressId ? { customerAddressId } : { customerAddressId: null, addressLabel: null }),
  };
  const stops = await tx.routeStop.findMany({ where: siteStops, select: { routeId: true } });
  await tx.routeStop.updateMany({
    where: siteStops,
    data: {
      ...pin,
      ...(addressChanged ? { address } : {}),
      ...(labelChanged ? { addressLabel: after.label } : {}),
    },
  });

  if (!moved) return [];

  // Delivery orders don't record which address they chose, only its text.
  const was = normalizeAddress(before.address);
  const orders = await tx.deliveryOrder.findMany({
    where: openOrders,
    select: { id: true, deliveryAddress: true },
  });
  const orderIds = orders
    .filter((o) => {
      const a = normalizeAddress(o.deliveryAddress);
      return customerAddressId ? a != null && a === was : !a || a === was;
    })
    .map((o) => o.id);
  if (orderIds.length === 0) return [...new Set(stops.map((s) => s.routeId))];

  await tx.deliveryOrder.updateMany({
    where: { id: { in: orderIds } },
    data: { ...pin, ...(addressChanged ? { deliveryAddress: address } : {}) },
  });
  const orderStops = await tx.routeStop.findMany({
    where: {
      activeDeliveryOrderId: { in: orderIds },
      route: { status: { in: [RouteStatus.PLANNED, RouteStatus.ACTIVE] } },
    },
    select: { routeId: true },
  });
  return [...new Set([...stops, ...orderStops].map((s) => s.routeId))];
}
