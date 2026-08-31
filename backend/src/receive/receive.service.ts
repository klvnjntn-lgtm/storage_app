// src/receive/receive.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReceiveService {
  constructor(private prisma: PrismaService) {}

  // -----------------------------
  // RECEIVE (count-only)
  // Stock is set by Import — this only logs what was physically
  // counted. A mismatch against the imported quantity is a
  // discrepancy for a human to resolve (e.g. via StockService.adjust),
  // not something this endpoint corrects automatically.
  // -----------------------------
  async receive(
    organizationId: string,
    productId: string,
    qty: number,
    locationId?: string,
    sessionId?: string,
    userId?: string,
  ) {
    if (!qty || qty <= 0) {
      throw new BadRequestException('Invalid quantity');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
    });

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    let session: { id: string; status: string } | null = null;

    if (sessionId) {
      session = await this.prisma.session.findFirst({
        where: { id: sessionId, organizationId },
        select: { id: true, status: true },
      });

      if (!session) {
        throw new BadRequestException('Session not found');
      }

      if (session.status === 'COMPLETED') {
        throw new BadRequestException(
          'Session is completed — reopen it before adding items',
        );
      }
    }

    if (!locationId) {
      throw new BadRequestException('Location is required');
    }

    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        organizationId,
      },
    });

    if (!location) {
      throw new BadRequestException('Location not found');
    }

    const targetLocationId = location.id;

    return this.prisma.$transaction(async (tx) => {
      let sessionItemId: number | undefined;

      if (session) {
        const item = await tx.sessionItem.create({
          data: {
            sessionId: session.id,
            productId,
            quantity: qty,
          },
        });
        sessionItemId = item.id;
      }

      await tx.event.create({
        data: {
          productId,
          type: 'RECEIVE',
          quantity: qty,
          toLocationId: targetLocationId,
          sessionId: session?.id,
          sessionItemId,
          userId,
          organizationId,
          metadata: {
            note: 'receiving count — stock set by import, not this scan',
          },
        },
      });

      return {
        success: true,
        productId,
        qty,
        locationId: targetLocationId,
        sessionId: session?.id,
      };
    });
  }
}