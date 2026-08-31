import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma as PrismaNS } from '@prisma/client';

// Confirms every foreign id on a draft/create DTO (customer, vehicle,
// location) actually belongs to this org before it's ever written to a
// row. Without this, a client could pass another org's customerId and
// the FK would happily attach, leaking that org's data into this
// document's print view.
//
// The composite FKs on the target models (customerId+organizationId etc.)
// are a DB-level backstop for this same thing — this check exists so a
// mismatch surfaces as a clean 404 here instead of a raw Postgres
// FK-violation error at write time. See handleFkViolation for the
// backstop side of that.
//
// Used by InvoiceService, and now SalesQuotationService/SalesOrderService
// — any document that references customer/vehicle/location by id.
@Injectable()
export class TenantOwnershipService {
  constructor(private prisma: PrismaService) {}

  async validate(
    organizationId: string,
    refs: {
      customerId?: string | null;
      vehicleId?: string | null;
      locationId?: string | null;
    },
    client: Pick<PrismaService, 'customer' | 'vehicle' | 'location'> = this.prisma,
  ) {
    if (refs.customerId) {
      const customer = await client.customer.findFirst({
        where: { id: refs.customerId, organizationId },
        select: { id: true },
      });
      if (!customer) throw new NotFoundException('Customer not found');
    }
    if (refs.vehicleId) {
      const vehicle = await client.vehicle.findFirst({
        where: { id: refs.vehicleId, organizationId },
        select: { id: true },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
    }
    if (refs.locationId) {
      const location = await client.location.findFirst({
        where: { id: refs.locationId, organizationId },
        select: { id: true },
      });
      if (!location) throw new NotFoundException('Location not found');
    }
  }

  // Turns a Postgres composite-FK violation (P2003) into a clean 400
  // instead of letting a raw Prisma error bubble up. Call this from a
  // catch block wrapping any $transaction that writes one of these FKs.
  handleFkViolation(err: unknown): never {
    if (
      err instanceof PrismaNS.PrismaClientKnownRequestError &&
      err.code === 'P2003'
    ) {
      throw new BadRequestException(
        'One or more referenced records do not belong to this organization',
      );
    }
    throw err;
  }
}