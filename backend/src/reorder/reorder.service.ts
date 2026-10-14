import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PurchaseOrderService } from '../purchase-order/purchase-order.service';
import { CreateReorderPosDto, ReorderSettingsDto } from './dto/reorder.dto';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export type LowStockLine = {
  productId: string;
  name: string;
  sku: string | null;
  unit: string | null;
  onHand: number;
  onOrder: number;
  reorderPoint: number;
  reorderQuantity: number | null;
  suggestedQuantity: number;
  unitCost: number | null;
  preferredSupplier: { id: string; name: string } | null;
};

// Reorder points. A product is low when what's on hand plus what's already
// on order (sent POs not yet received) is at or below its reorder point —
// counting open POs stops the same shortage being ordered twice.
@Injectable()
export class ReorderService {
  private readonly logger = new Logger(ReorderService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private purchaseOrders: PurchaseOrderService,
  ) {}

  async updateSettings(
    organizationId: string,
    productId: string,
    dto: ReorderSettingsDto,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (dto.preferredSupplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.preferredSupplierId, organizationId },
      });
      if (!supplier) throw new NotFoundException('Supplier not found');
    }
    return this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(dto.reorderPoint !== undefined && {
          reorderPoint: dto.reorderPoint,
        }),
        ...(dto.reorderQuantity !== undefined && {
          reorderQuantity: dto.reorderQuantity,
        }),
        ...(dto.preferredSupplierId !== undefined && {
          preferredSupplierId: dto.preferredSupplierId,
        }),
      },
      select: {
        id: true,
        reorderPoint: true,
        reorderQuantity: true,
        preferredSupplierId: true,
      },
    });
  }

  // Every watched product with its position; `onlyLow` keeps just the ones
  // at or below their reorder point.
  async report(
    organizationId: string,
    onlyLow = true,
  ): Promise<LowStockLine[]> {
    const products = await this.prisma.product.findMany({
      where: { organizationId, active: true, reorderPoint: { not: null } },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        costPrice: true,
        reorderPoint: true,
        reorderQuantity: true,
        preferredSupplier: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    if (products.length === 0) return [];
    const ids = products.map((p) => p.id);

    const [stock, ordered, received] = await Promise.all([
      this.prisma.stock.groupBy({
        by: ['productId'],
        where: { organizationId, productId: { in: ids } },
        _sum: { quantity: true },
      }),
      this.prisma.purchaseOrderItem.findMany({
        where: {
          productId: { in: ids },
          purchaseOrder: {
            organizationId,
            status: {
              in: [
                PurchaseOrderStatus.SENT,
                PurchaseOrderStatus.PARTIALLY_RECEIVED,
              ],
            },
          },
        },
        select: {
          id: true,
          productId: true,
          quantity: true,
          importedReceivedQuantity: true,
        },
      }),
      this.prisma.goodsReceiptItem.groupBy({
        by: ['purchaseOrderItemId'],
        where: {
          productId: { in: ids },
          goodsReceipt: {
            organizationId,
            purchaseOrder: {
              status: {
                in: [
                  PurchaseOrderStatus.SENT,
                  PurchaseOrderStatus.PARTIALLY_RECEIVED,
                ],
              },
            },
          },
        },
        _sum: { quantity: true },
      }),
    ]);
    const onHandBy = new Map(
      stock.map((s) => [s.productId, Number(s._sum.quantity ?? 0)]),
    );
    const receivedBy = new Map(
      received.map((r) => [
        r.purchaseOrderItemId,
        Number(r._sum.quantity ?? 0),
      ]),
    );
    const onOrderBy = new Map<string, number>();
    for (const item of ordered) {
      const open =
        Number(item.quantity) -
        Number(item.importedReceivedQuantity) -
        (receivedBy.get(item.id) ?? 0);
      if (open > 0 && item.productId)
        onOrderBy.set(
          item.productId,
          (onOrderBy.get(item.productId) ?? 0) + open,
        );
    }

    const lines = products.map((p) => {
      const onHand = round2(onHandBy.get(p.id) ?? 0);
      const onOrder = round2(onOrderBy.get(p.id) ?? 0);
      const reorderPoint = Number(p.reorderPoint);
      const reorderQuantity =
        p.reorderQuantity != null ? Number(p.reorderQuantity) : null;
      const position = onHand + onOrder;
      // The set reorder quantity, or else enough to get back to twice the
      // reorder point.
      const suggestedQuantity =
        reorderQuantity ?? Math.max(1, Math.ceil(reorderPoint * 2 - position));
      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        onHand,
        onOrder,
        reorderPoint,
        reorderQuantity,
        suggestedQuantity,
        unitCost: p.costPrice != null ? Number(p.costPrice) : null,
        preferredSupplier: p.preferredSupplier,
        low: position <= reorderPoint,
      };
    });
    return (onlyLow ? lines.filter((l) => l.low) : lines).map(
      ({ low: _low, ...rest }) => rest,
    );
  }

  // One draft PO per supplier, priced at each product's current cost.
  // They're drafts on purpose: someone checks quantities and prices and
  // sends them (where approvals apply as usual).
  async createDraftPurchaseOrders(
    organizationId: string,
    userId: string,
    dto: CreateReorderPosDto,
  ) {
    const bySupplier = new Map<
      string,
      { productId: string; quantity: number }[]
    >();
    for (const line of dto.items) {
      bySupplier.set(line.supplierId, [
        ...(bySupplier.get(line.supplierId) ?? []),
        line,
      ]);
    }
    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: dto.items.map((i) => i.productId) } },
      select: { id: true, costPrice: true },
    });
    const costBy = new Map(
      products.map((p) => [
        p.id,
        p.costPrice != null ? Number(p.costPrice) : 0,
      ]),
    );
    if (costBy.size !== new Set(dto.items.map((i) => i.productId)).size) {
      throw new BadRequestException('One or more products were not found');
    }

    const created: Awaited<ReturnType<PurchaseOrderService['create']>>[] = [];
    for (const [supplierId, lines] of bySupplier) {
      created.push(
        await this.purchaseOrders.create(organizationId, userId, {
          supplierId,
          locationId: dto.locationId,
          notes: 'Created from reorder suggestions',
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCost: costBy.get(l.productId) ?? 0,
          })),
        }),
      );
    }
    return created;
  }

  // Morning nudge to admins when anything is low. Once a day at most, and
  // only for orgs that watch at least one product.
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async notifyLowStock() {
    const orgs = await this.prisma.product.groupBy({
      by: ['organizationId'],
      where: { active: true, reorderPoint: { not: null } },
    });
    for (const { organizationId } of orgs) {
      try {
        const low = await this.report(organizationId);
        if (low.length === 0) continue;
        const admins = await this.prisma.user.findMany({
          where: {
            organizationId,
            role: 'ADMIN',
            active: true,
            removedAt: null,
          },
          select: { id: true },
        });
        await this.notifications.createMany(
          organizationId,
          admins.map((a) => a.id),
          'LOW_STOCK',
          `${low.length} product${low.length > 1 ? 's are' : ' is'} low on stock`,
          {
            body: low
              .slice(0, 5)
              .map((l) => l.name)
              .join(', '),
            link: '/purchasing/reorder',
          },
        );
      } catch (err) {
        this.logger.warn(
          `Low-stock check failed for org ${organizationId}: ${err}`,
        );
      }
    }
  }
}
