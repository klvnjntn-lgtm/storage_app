// src/warehouse/warehouse.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { ReceiveService } from '../receive/receive.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly receiveService: ReceiveService,
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
  ) {}

  async receive(
    organizationId: string,
    productId: string,
    qty: number,
    locationId?: string,
  ) {
    await this.assertProductActive(organizationId, productId);
    return this.receiveService.receive(
      organizationId,
      productId,
      qty,
      locationId,
    );
  }

  // -----------------------------
  // MOVE
  // -----------------------------
  async move(
    organizationId: string,
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

    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true, active: true },
    });
    if (!product) throw new BadRequestException('Product not found');
    if (!product.active) {
      throw new BadRequestException(
        'Product is archived — restore it before recording stock movements',
      );
    }

    const fromLocation = await this.prisma.location.findFirst({
      where: { id: fromLocationId, organizationId },
    });
    if (!fromLocation) throw new BadRequestException('Source location not found');

    const toLocation = await this.prisma.location.findFirst({
      where: { id: toLocationId, organizationId },
    });
    if (!toLocation) throw new BadRequestException('Destination location not found');

    return this.prisma.$transaction(async (tx) => {
      // Row-locked read (SELECT ... FOR UPDATE) so a concurrent move()/
      // decrease()/fulfill()/adjust() against the same product+location
      // can't both pass this check against a stale quantity.
      const available = await this.stockService.lockStockRow(
        tx,
        organizationId,
        productId,
        fromLocationId,
      );

      if (available < qty) {
        throw new BadRequestException('Insufficient stock');
      }

      // Decrease source
      await tx.stock.update({
        where: {
          productId_locationId: { productId, locationId: fromLocationId },
        },
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
          organizationId,
        },
      });

      await tx.event.create({
        data: {
          productId,
          type: 'MOVE',
          quantity: qty,
          fromLocationId,
          toLocationId,
          organizationId,
        },
      });

      return { success: true, productId, qty, fromLocationId, toLocationId };
    });
  }

  async events(organizationId: string) {
    const rows = await this.prisma.event.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100, // basic pagination guard
      include: {
        product: { select: { sku: true, name: true } },
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
      },
    });
    // quantity is Decimal, which serializes to a JSON string otherwise.
    return rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
  }

  async getStock(organizationId: string, productId: string) {
    await this.assertProductOwnership(organizationId, productId);
    return this.prisma.stock.findMany({
      where: {
        productId,
        organizationId,
      },
      include: {
        location: true,
      },
    });
  }

  private async assertProductOwnership(organizationId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Product not found');
  }

  private async assertProductActive(organizationId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true, active: true },
    });
    if (!product) throw new BadRequestException('Product not found');
    if (!product.active) {
      throw new BadRequestException(
        'Product is archived — restore it before recording stock movements',
      );
    }
  }
}