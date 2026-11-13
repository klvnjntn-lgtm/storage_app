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

// A fix within this distance of a GPS pin is the same spot measured again.
export const PIN_AGREE_METERS = 25;
// Deliveries that must agree (the one that set the pin included) before the
// pin is settled. A settled pin ignores a fix far from it, however accurate:
// several deliveries already put the customer there, so the driver was
// somewhere else (the back gate, down the road), not the pin wrong.
export const PIN_SETTLED_COUNT = 3;
// Deliveries that must agree on a spot other than an unsettled pin before
// that spot replaces it, whatever accuracy the pin claims: a reading can be
// wrong while reporting itself tight (signal bouncing off a building), and
// then nothing more accurate ever comes along to replace it.
export const PIN_OUTVOTE_COUNT = 3;
// How far apart the GPS reading and the proof photo may be taken for the
// reading to move or confirm a pin. The phone may wait up to 30s for a
// reading (GPS_WAIT_MS on the frontend), or hold one from before the photo;
// by then the driver may be walking off or still pulling in. Such a reading
// still records where the delivery happened, but only fills an empty pin.
export const PIN_FIX_WINDOW_MS = 6_000;
// Deliveries this close together in time are one visit — several delivery
// orders dropped at one stop, minutes apart — and count as one confirmation
// or vote. Else one visit with three orders would settle a brand-new pin, or
// outvote one, on its own. Four hours: a morning and an afternoon visit to
// the same shop still count separately.
export const PIN_VISIT_GAP_MS = 4 * 60 * 60 * 1000;

// Whether a delivery's GPS reading was taken close enough to its proof
// photo to place the customer. Unknown times (no photo, a phone too old to
// say when its reading was taken) count as not.
export function fixIsTimely(
  locationAt: Date | string | null | undefined,
  photoAt: Date | string | null | undefined,
): boolean {
  if (!locationAt || !photoAt) return false;
  const gap = Math.abs(new Date(locationAt).getTime() - new Date(photoAt).getTime());
  return Number.isFinite(gap) && gap <= PIN_FIX_WINDOW_MS;
}

// Metres between two points (haversine).
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

type Coord = Prisma.Decimal | number | null;
export type PinState = {
  latitude: Coord;
  longitude: Coord;
  pinSource: PinSource | null;
  pinAccuracy: number | null;
  pinRecheck: boolean;
  pinConfirmations: number;
  pinChallengerLatitude: Coord;
  pinChallengerLongitude: Coord;
  pinChallengerCount: number;
  // When a delivery last counted toward this pin (a confirmation or a vote).
  pinVotedAt?: Date | null;
};
type Fix = { latitude: number; longitude: number; accuracy: number };

const noChallenger = {
  pinChallengerLatitude: null,
  pinChallengerLongitude: null,
  pinChallengerCount: 0,
};

// What a delivery's GPS fix does to an address's pin, or null to leave it.
// `timely`: the reading was taken within PIN_FIX_WINDOW_MS of the photo.
// - a reading that isn't timely only fills an empty pin, marked for recheck
//   so the next timely reading replaces it; it never touches a pin;
// - no pin: the fix becomes it, however weak (a weak one is flagged to the
//   office via pinAccuracy and doesn't count as a confirmation);
// - a MANUAL pin (set in the office) is never touched;
// - a GPS pin marked for recheck (pinRecheck) is replaced by any fix that
//   isn't weak;
// - a fix that isn't weak and lands within PIN_AGREE_METERS confirms the
//   pin, and moves it onto the fix if the fix is more accurate;
// - a settled pin (PIN_SETTLED_COUNT) ignores a fix elsewhere;
// - elsewhere, a fix that isn't weak votes for its spot (the challenger);
//   at PIN_OUTVOTE_COUNT agreeing votes that spot becomes the pin, settled.
//   Short of that, a fix strictly more accurate than the pin replaces it,
//   keeping the votes its spot already had — but only while the pin has at
//   most one confirmation: once two visits agree on it, one tight reading
//   elsewhere is more likely the back gate than a better pin.
// `deliveredAt`: when the delivery happened. Only the first delivery of a
// visit (PIN_VISIT_GAP_MS) counts as a confirmation or a vote; the rest of
// that visit can still move the pin onto a tighter reading of the same spot.
export function nextPin(current: PinState, fix: Fix, timely: boolean, deliveredAt: Date = new Date()) {
  const weak = fix.accuracy > WEAK_PIN_ACCURACY_METERS;
  const place = {
    latitude: fix.latitude,
    longitude: fix.longitude,
    pinSource: PinSource.GPS,
    pinAccuracy: fix.accuracy,
    pinSetAt: new Date(),
    pinRecheck: false,
  };
  const at = { ...place, ...noChallenger };
  const voted = { pinVotedAt: deliveredAt };
  const empty = current.latitude == null || current.longitude == null;
  if (!timely) return empty ? { ...at, pinRecheck: true, pinConfirmations: 0, pinVotedAt: null } : null;
  if (empty) return weak ? { ...at, pinConfirmations: 0, pinVotedAt: null } : { ...at, pinConfirmations: 1, ...voted };
  if (current.pinSource !== PinSource.GPS) return null;
  if (current.pinRecheck && !weak) return { ...at, pinConfirmations: 1, ...voted };

  const sameVisit =
    current.pinVotedAt != null &&
    Math.abs(deliveredAt.getTime() - new Date(current.pinVotedAt).getTime()) < PIN_VISIT_GAP_MS;
  const apart = distanceMeters(
    { latitude: Number(current.latitude), longitude: Number(current.longitude) },
    fix,
  );
  const tighter = current.pinAccuracy == null || fix.accuracy < current.pinAccuracy;
  if (!weak && apart <= PIN_AGREE_METERS) {
    if (sameVisit) {
      // Already counted this visit: only a tighter reading of the spot matters.
      return tighter ? place : null;
    }
    const confirmations = current.pinConfirmations + 1;
    return tighter
      ? { ...at, pinConfirmations: confirmations, ...voted }
      : { pinConfirmations: confirmations, ...noChallenger, ...voted };
  }
  if (current.pinConfirmations >= PIN_SETTLED_COUNT) return null;
  // The visit that already counted for the pin doesn't also vote against it.
  if (sameVisit) return null;
  const mayReplace = tighter && current.pinConfirmations <= 1;
  if (weak) return mayReplace ? { ...at, pinConfirmations: 0, pinVotedAt: null } : null;

  const challenger =
    current.pinChallengerLatitude != null && current.pinChallengerLongitude != null
      ? { latitude: Number(current.pinChallengerLatitude), longitude: Number(current.pinChallengerLongitude) }
      : null;
  const votes =
    challenger && distanceMeters(challenger, fix) <= PIN_AGREE_METERS ? current.pinChallengerCount + 1 : 1;
  if (votes >= PIN_OUTVOTE_COUNT || mayReplace) return { ...at, pinConfirmations: votes, ...voted };
  return {
    pinChallengerLatitude: fix.latitude,
    pinChallengerLongitude: fix.longitude,
    pinChallengerCount: votes,
    ...voted,
  };
}

const pinSelect = {
  address: true,
  latitude: true,
  longitude: true,
  pinSource: true,
  pinAccuracy: true,
  pinRecheck: true,
  pinConfirmations: true,
  pinChallengerLatitude: true,
  pinChallengerLongitude: true,
  pinChallengerCount: true,
  pinVotedAt: true,
} as const;

// Sets a customer address's pin from the driver's GPS at a completed
// delivery, so addresses get mapped through normal deliveries (nextPin has
// the rules). The UPDATE only applies if the pin is still what was read, so a
// pin set concurrently by the office or another delivery wins and this fix is
// simply dropped.
//
// A customer route stop for a saved address says which one directly
// (customerAddressId). Otherwise the delivered-to address text picks which
// pin to fill: the customer's default address, or a matching saved
// CustomerAddress. Anything else is a one-off site (job site, third party)
// and leaves the customer alone.
// Requires a reported accuracy — without one there's no telling whether
// the fix is any better than what's there. `timely`: see fixIsTimely.
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
    timely: boolean;
    // When the delivery happened (see nextPin); now if not given.
    deliveredAt?: Date;
  },
): Promise<void> {
  const { organizationId, customerId, latitude, longitude, accuracy } = params;
  if (!customerId || latitude == null || longitude == null) return;
  if (accuracy == null) return;
  const fix = { latitude, longitude, accuracy };

  type Current = PinState & {
    address: string | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    pinChallengerLatitude: Prisma.Decimal | null;
    pinChallengerLongitude: Prisma.Decimal | null;
  };
  const apply = async (
    current: Current,
    customerAddressId: string | null,
    update: (where: Prisma.CustomerWhereInput & Prisma.CustomerAddressWhereInput, data: object) => Promise<{ count: number }>,
  ) => {
    const data = nextPin(current, fix, params.timely, params.deliveredAt);
    if (!data) return;
    const { count } = await update(
      {
        latitude: current.latitude ?? null,
        longitude: current.longitude ?? null,
        pinSource: current.pinSource ?? null,
        pinConfirmations: current.pinConfirmations ?? 0,
        pinChallengerCount: current.pinChallengerCount ?? 0,
        pinVotedAt: current.pinVotedAt ?? null,
      },
      data,
    );
    if (count && 'latitude' in data) {
      await fillOpenStopPins(prisma, {
        organizationId,
        customerId,
        customerAddressId,
        latitude,
        longitude,
        address: current.address,
        previous: current,
      });
    }
  };

  if (params.customerAddressId) {
    const id = params.customerAddressId;
    const current = await prisma.customerAddress.findFirst({
      where: { id, organizationId, customerId },
      select: pinSelect,
    });
    if (!current) return;
    await apply(current, id, (where, data) =>
      prisma.customerAddress.updateMany({ where: { id, organizationId, customerId, ...where }, data }),
    );
    return;
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: pinSelect,
  });
  if (!customer) return;

  const target = normalizeAddress(params.deliveryAddress);
  if (!target || target === normalizeAddress(customer.address)) {
    await apply(customer, null, (where, data) =>
      prisma.customer.updateMany({ where: { id: customerId, organizationId, ...where }, data }),
    );
    return;
  }

  const saved = await prisma.customerAddress.findMany({
    where: { organizationId, customerId },
    select: { id: true, ...pinSelect },
  });
  const match = saved.find((a) => normalizeAddress(a.address) === target);
  if (!match) return;
  await apply(match, match.id, (where, data) =>
    prisma.customerAddress.updateMany({ where: { id: match.id, ...where }, data }),
  );
}

// The undo of backfillCustomerPin, for a delivery whose result was reset or
// moved to another stop (the driver had marked the wrong one). Only a GPS pin
// still holding exactly that delivery's fix is cleared — one the office set,
// or a later driver fix, has nothing to do with this delivery and stays.
// What the cleared pin replaced isn't known, so the address goes back to
// unpinned, and the next delivery there fills it in. Open stops and delivery
// orders that copied the pin lose it with the customer.
// Same choice of address as backfillCustomerPin.
// A delivery that only confirmed the pin (pinConfirmations) left no trace of
// its own on it, so that count isn't taken back: at worst a pin settles one
// delivery early, on a spot another delivery also put it.
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
  const cleared = {
    latitude: null,
    longitude: null,
    pinSource: null,
    pinAccuracy: null,
    pinSetAt: null,
    pinRecheck: false,
    pinConfirmations: 0,
    pinVotedAt: null,
    ...noChallenger,
  };

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
      pinRecheck: false,
      pinConfirmations: 0,
      ...noChallenger,
    };
  }
  return {
    latitude,
    longitude,
    pinSource: PinSource.MANUAL,
    pinAccuracy: null,
    pinSetAt: new Date(),
    pinRecheck: false,
    pinConfirmations: 0,
    pinVotedAt: null,
    ...noChallenger,
  };
}
