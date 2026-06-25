import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReceiveService {
  constructor(private prisma: PrismaService) {}

  async receive(
    orgId: string,
    productId: string,
    qty: number,
    locationId?: string,
  ) {
    // -----------------------------
    // 1. VALIDATE
    // -----------------------------
    if (!qty || qty <= 0) {
      throw new BadRequestException('Invalid quantity');
    }

    // org-scoped product check
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },  // 🔒
    });

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    // -----------------------------
    // 2. RESOLVE TARGET LOCATION
    // Caller can pass a locationId; if omitted, fall back to the
    // org's "RECEIVED" location. Both must belong to this org.
    // -----------------------------
    let targetLocationId: string;

    if (locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: locationId, organizationId: orgId },  // 🔒
      });

      if (!location) {
        throw new BadRequestException('Location not found');
      }

      targetLocationId = location.id;
    } else {
      const receivedLocation = await this.prisma.location.findFirst({
        where: { name: 'RECEIVED', organizationId: orgId },  // 🔒
      });

      if (!receivedLocation) {
        throw new BadRequestException(
          'No location provided and no RECEIVED location configured for this organization',
        );
      }

      targetLocationId = receivedLocation.id;
    }

    // -----------------------------
    // 3. UPSERT STOCK + LOG EVENT (atomic)
    // -----------------------------
    return this.prisma.$transaction(async (tx) => {
      await tx.stock.upsert({
        where: {
          productId_locationId: {
            productId,
            locationId: targetLocationId,
          },
        },
        update: {
          quantity: { increment: qty },
        },
        create: {
          productId,
          locationId: targetLocationId,
          quantity: qty,
          organizationId: orgId,                            // 🔒
        },
      });

      await tx.event.create({
        data: {
          productId,
          type: 'RECEIVE',
          quantity: qty,
          toLocationId: targetLocationId,
          organizationId: orgId,                            // 🔒
        },
      });

      return {
        success: true,
        productId,
        qty,
        locationId: targetLocationId,
      };
    });
  }
}