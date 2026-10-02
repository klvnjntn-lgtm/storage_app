// src/customers/customer-pin-backfill.ts
import { PrismaService } from '../prisma/prisma.service';

// A fix vaguer than this is kept on the delivery but never becomes an
// address pin — a 300m circle in a dense kampung could be the wrong street.
export const MAX_BACKFILL_ACCURACY_METERS = 100;

function normalizeAddress(address: string | null | undefined): string | null {
  const s = address?.trim().replace(/\s+/g, ' ').toLowerCase();
  return s || null;
}

// Gives a still-unpinned customer address its first pin from the driver's
// GPS at a completed delivery, so addresses get mapped through normal
// deliveries. Never overwrites: the `latitude: null` filter is part of
// the UPDATE, so an existing (or concurrently set) pin always wins.
//
// The delivered-to address text picks which pin to fill: the customer's
// default address, or a matching saved CustomerAddress. Anything else is
// a one-off site (job site, third party) and leaves the customer alone.
// Requires a reported accuracy — no accuracy, no backfill.
export async function backfillCustomerPin(
  prisma: PrismaService,
  params: {
    organizationId: string;
    customerId: string | null;
    deliveryAddress: string | null;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
  },
): Promise<void> {
  const { organizationId, customerId, latitude, longitude, accuracy } = params;
  if (!customerId || latitude == null || longitude == null) return;
  if (accuracy == null || accuracy > MAX_BACKFILL_ACCURACY_METERS) return;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { address: true },
  });
  if (!customer) return;

  const pin = { latitude, longitude };
  const target = normalizeAddress(params.deliveryAddress);

  if (!target || target === normalizeAddress(customer.address)) {
    await prisma.customer.updateMany({
      where: { id: customerId, organizationId, latitude: null },
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
    where: { id: match.id, latitude: null },
    data: pin,
  });
}
