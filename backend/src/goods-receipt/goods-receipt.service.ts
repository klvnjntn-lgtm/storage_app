import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { PurchaseOrderStatus, EventType } from '@prisma/client';
import { ReceiveGoodsDto } from './dto/goods-receipt.dto';

@Injectable()
export class GoodsReceiptService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
    private tenantOwnership: TenantOwnershipService,
    private numbering: DocumentNumberingService,
  ) {}

  async getReceivingSummary(organizationId: string, purchaseOrderId: string) {
    const po = await this.getReceivableOrThrow(organizationId, purchaseOrderId);
    const receivedByItem = await this.receivedQuantitiesByPoItem(purchaseOrderId);

    return {
      purchaseOrderId: po.id,
      status: po.status,
      items: po.items.map((item) => {
        const ordered = Number(item.quantity);
        const received = receivedByItem.get(item.id) ?? 0;
        return {
          purchaseOrderItemId: item.id,
          productId: item.productId,
          ordered,
          previouslyReceived: received,
          remaining: ordered - received,
        };
      }),
    };
  }

  async receive(
    organizationId: string,
    userId: string,
    purchaseOrderId: string,
    dto: ReceiveGoodsDto,
  ) {
    if (!dto.items?.length) {
      throw new BadRequestException('Must receive at least one item');
    }

    const po = await this.getReceivableOrThrow(organizationId, purchaseOrderId);
    await this.tenantOwnership.validate(organizationId, { locationId: dto.locationId });

    const poItemsById = new Map(po.items.map((i) => [i.id, i]));

    // Fast, non-transactional pre-check — fails fast for the common
    // non-concurrent case so a bad request doesn't even open a
    // transaction. This alone is NOT sufficient under concurrency; see
    // the re-check inside the transaction below.
    const receivedByItem = await this.receivedQuantitiesByPoItem(purchaseOrderId);
    for (const line of dto.items) {
      const poItem = poItemsById.get(line.purchaseOrderItemId);
      if (!poItem) {
        throw new NotFoundException(
          `Purchase order item ${line.purchaseOrderItemId} not found on this PO`,
        );
      }
      const alreadyReceived = receivedByItem.get(poItem.id) ?? 0;
      const remaining = Number(poItem.quantity) - alreadyReceived;
      if (line.quantity > remaining) {
        throw new BadRequestException(
          `Cannot receive ${line.quantity} — only ${remaining} remaining for this item`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // NEW — re-validate against a fresh, transaction-scoped read.
      // Two concurrent receive() calls could both pass the outer
      // pre-check above using the same stale receivedByItem snapshot;
      // this closes that race by re-reading and re-checking inside the
      // same transaction that will commit the new receipt, so the check
      // and the write are atomic with respect to each other.
      const freshReceivedByItem = await this.receivedQuantitiesByPoItem(purchaseOrderId, tx);
      for (const line of dto.items) {
        const poItem = poItemsById.get(line.purchaseOrderItemId)!;
        const alreadyReceived = freshReceivedByItem.get(poItem.id) ?? 0;
        const remaining = Number(poItem.quantity) - alreadyReceived;
        if (line.quantity > remaining) {
          throw new BadRequestException(
            `Cannot receive ${line.quantity} — only ${remaining} remaining for this item`,
          );
        }
      }

      const year = new Date().getFullYear();
      const count = await tx.goodsReceipt.count({
        where: { organizationId, createdAt: { gte: new Date(`${year}-01-01`) } },
      });
      const receiptNumber = await this.numbering.next({ prefix: 'GR', count, year });

      const receipt = await tx.goodsReceipt.create({
        data: {
          organizationId,
          purchaseOrderId: po.id,
          locationId: dto.locationId,
          userId,
          notes: dto.notes,
          receiptNumber,
          items: {
            create: dto.items.map((line) => ({
              purchaseOrderItemId: line.purchaseOrderItemId,
              productId: poItemsById.get(line.purchaseOrderItemId)!.productId,
              quantity: line.quantity,
            })),
          },
        },
        include: { items: true },
      });

      for (const line of dto.items) {
        const poItem = poItemsById.get(line.purchaseOrderItemId)!;
if (!poItem.productId) continue;
        await this.stockService.increase(
          organizationId,
          poItem.productId,
          dto.locationId,
          line.quantity,
          userId,
          {
            type: EventType.RECEIVE,
            metadata: { purchaseOrderId: po.id, goodsReceiptId: receipt.id },
          },
          tx,
        );
      }

      const updatedReceivedByItem = await this.receivedQuantitiesByPoItem(po.id, tx);
      const isFullyReceived = po.items.every((item) => {
        const total = updatedReceivedByItem.get(item.id) ?? 0;
        return total >= Number(item.quantity);
      });

      const newStatus = isFullyReceived
        ? PurchaseOrderStatus.FULLY_RECEIVED
        : PurchaseOrderStatus.PARTIALLY_RECEIVED;

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: newStatus },
      });

      return { ...receipt, purchaseOrderStatus: newStatus };
    });
  }

  async listReceipts(organizationId: string, purchaseOrderId: string) {
    await this.getReceivableOrThrow(organizationId, purchaseOrderId, /* allowFullyReceived */ true);
    return this.prisma.goodsReceipt.findMany({
      where: { organizationId, purchaseOrderId },
      include: { items: true, location: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---- helpers ------------------------------------------------

  private async receivedQuantitiesByPoItem(
    purchaseOrderId: string,
    tx: any = this.prisma,
  ): Promise<Map<string, number>> {
    const rows = await tx.goodsReceiptItem.groupBy({
      by: ['purchaseOrderItemId'],
      where: { goodsReceipt: { purchaseOrderId } },
      _sum: { quantity: true },
    });
    const map = new Map<string, number>();
    for (const r of rows as any[]) {
      map.set(r.purchaseOrderItemId, r._sum.quantity ?? 0);
    }
    return map;
  }

  private async getReceivableOrThrow(
    organizationId: string,
    purchaseOrderId: string,
    allowFullyReceived = false,
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    const receivableStatuses: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.SENT,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
      ...(allowFullyReceived ? [PurchaseOrderStatus.FULLY_RECEIVED] : []),
    ];
    if (!receivableStatuses.includes(po.status)) {
      throw new BadRequestException(
        `Cannot receive goods against a purchase order in ${po.status} status`,
      );
    }
    return po;
  }
}