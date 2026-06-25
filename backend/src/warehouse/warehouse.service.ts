import { Injectable, BadRequestException } from '@nestjs/common';
import { ReceiveService } from '../receive/receive.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly receiveService: ReceiveService,
    private readonly prisma: PrismaService,
  ) {}

  // -----------------------------
  // RECEIVE
  // -----------------------------
  async receive(
    orgId: string,
    productId: string,
    qty: number,
    locationId?: string,
  ) {
    // Verify product belongs to this org before delegating
    await this.assertProductOwnership(orgId, productId);
    return this.receiveService.receive(
  orgId,
  productId,
  qty,
  locationId,
);
  }

  // -----------------------------
  // SUMMARY
  // -----------------------------
  async summary(orgId: string) {
    const products = await this.prisma.product.findMany({
      where: { organizationId: orgId },           // 🔒 org-scoped
      include: {
        category: true,
        brand: true,
        stocks: {
          include: { location: true },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return products.map((product) => ({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category?.name ?? null,
      brand: product.brand?.name ?? null,
      totalStock: product.stocks.reduce((sum, s) => sum + s.quantity, 0),
      locations: product.stocks.map((s) => ({
        location: s.location.name,
        qty: s.quantity,
      })),
      lastAction: product.events[0]?.type ?? '-',
    }));
  }

  // -----------------------------
  // MOVE
  // -----------------------------
  async move(
    orgId: string,
    productId: string,
    qty: number,
    fromLocationId: string,
    toLocationId: string,
  ) {
    if (fromLocationId === toLocationId) {
      throw new BadRequestException(
        'Source and destination cannot be the same',
      );
    }

    if (qty <= 0) {
      throw new BadRequestException('Invalid quantity');
    }

    // All existence checks are org-scoped — a product/location from another
    // org will appear as "not found" rather than "forbidden", which avoids
    // leaking that the resource exists at all.
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },   // 🔒
    });
    if (!product) throw new BadRequestException('Product not found');

    const fromLocation = await this.prisma.location.findFirst({
      where: { id: fromLocationId, organizationId: orgId }, // 🔒
    });
    if (!fromLocation) throw new BadRequestException('Source location not found');

    const toLocation = await this.prisma.location.findFirst({
      where: { id: toLocationId, organizationId: orgId },   // 🔒
    });
    if (!toLocation) throw new BadRequestException('Destination location not found');

    return this.prisma.$transaction(async (tx) => {
      const stock = await tx.stock.findUnique({
        where: {
          productId_locationId: { productId, locationId: fromLocationId },
        },
      });

      if (!stock || stock.quantity < qty) {
        throw new BadRequestException('Insufficient stock');
      }

      // Decrease source
      await tx.stock.update({
        where: { id: stock.id },
        data: { quantity: { decrement: qty } },
      });

      // Increase destination (atomic upsert — no create race)
      await tx.stock.upsert({
        where: {
          productId_locationId: { productId, locationId: toLocationId },
        },
        update: {
          quantity: { increment: qty },
        },
        create: {
          productId,
          locationId: toLocationId,
          quantity: qty,
          organizationId: orgId,                           // 🔒
        },
      });

      await tx.event.create({
        data: {
          productId,
          type: 'MOVE',
          quantity: qty,
          fromLocationId,
          toLocationId,
          organizationId: orgId,                           // 🔒
        },
      });

      return { success: true, productId, qty, fromLocationId, toLocationId };
    });
  }

  // -----------------------------
  // EVENTS
  // -----------------------------
  async events(orgId: string) {
    return this.prisma.event.findMany({
      where: { organizationId: orgId },                    // 🔒 org-scoped
      orderBy: { createdAt: 'desc' },
      take: 100,                                           // basic pagination guard
      include: {
        product: { select: { sku: true, name: true } },
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
      },
    });
  }

  // -----------------------------
  // STOCK CHECK (utility)
  // -----------------------------
  async getStock(orgId: string, productId: string) {
    await this.assertProductOwnership(orgId, productId);
    return this.prisma.stock.findMany({
  where: {
    productId,
    organizationId: orgId,
  },
  include: {
    location: true,
  },
});
  }

  // -----------------------------
  // PRIVATE HELPERS
  // -----------------------------

  /**
   * Throws if productId doesn't belong to orgId.
   * Returns "not found" instead of "forbidden" to avoid resource enumeration.
   */
  private async assertProductOwnership(orgId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Product not found');
  }
}