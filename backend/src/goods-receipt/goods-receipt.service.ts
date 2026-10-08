import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { PurchaseOrderStatus, EventType, Prisma, CostChangeSource } from '@prisma/client';
import { receiveAtCost } from '../accounting/inventory-costing';
import { ReceiveGoodsDto } from './dto/goods-receipt.dto';

// Quantities are Decimal(12,2); keep sums on that grid so float drift never
// blocks receiving the last 0.1 of a line.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class GoodsReceiptService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
    private tenantOwnership: TenantOwnershipService,
    private numbering: DocumentNumberingService,
    private postingRules: PostingRulesService,
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
          remaining: round2(ordered - received),
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

    // Totalled per PO line: the same line listed twice used to be checked
    // twice against the same "remaining" and could over-receive together.
    const requestedByItem = new Map<string, number>();
    for (const line of dto.items) {
      if (!poItemsById.has(line.purchaseOrderItemId)) {
        throw new NotFoundException(`Purchase order item ${line.purchaseOrderItemId} not found on this PO`);
      }
      requestedByItem.set(
        line.purchaseOrderItemId,
        round2((requestedByItem.get(line.purchaseOrderItemId) ?? 0) + line.quantity),
      );
    }
    const assertWithinRemaining = (received: Map<string, number>) => {
      for (const [poItemId, quantity] of requestedByItem) {
        const poItem = poItemsById.get(poItemId)!;
        const remaining = round2(Number(poItem.quantity) - (received.get(poItemId) ?? 0));
        if (quantity > remaining) {
          throw new BadRequestException(`Cannot receive ${quantity} — only ${remaining} remaining for this item`);
        }
      }
    };

    assertWithinRemaining(await this.receivedQuantitiesByPoItem(purchaseOrderId));

    return this.prisma.$transaction(async (tx) => {
      // Lock the PurchaseOrder row so a concurrent receive() against the
      // same PO blocks here until this transaction commits or rolls back —
      // receivedQuantitiesByPoItem() below is a plain aggregate with no
      // row lock of its own, so without this, two concurrent receives
      // could both read the same "already received" total and both pass.
      await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${po.id} FOR UPDATE`;

      // The status was read before the lock — a cancel committed since then
      // must stop this receipt.
      const fresh = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, select: { status: true } });
      if (fresh.status !== PurchaseOrderStatus.SENT && fresh.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
        throw new BadRequestException(`Cannot receive goods against a purchase order in ${fresh.status} status`);
      }

      assertWithinRemaining(await this.receivedQuantitiesByPoItem(purchaseOrderId, tx));

      const receiptNumber = await this.numbering.nextSequential(tx, organizationId, 'GOODS_RECEIPT', 'GR');

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

      // Unit cost as it lands in Inventory: postGoodsReceipt() books each
      // receipt net of the PO discount, allocated in proportion to value, so
      // every line carries the same discount fraction. Tax is input VAT, not
      // part of the cost.
      const poSubtotal = Number(po.subtotal);
      const netFactor = poSubtotal > 0 ? 1 - Number(po.discountAmount) / poSubtotal : 1;

      for (const line of dto.items) {
        const poItem = poItemsById.get(line.purchaseOrderItemId)!;
        if (!poItem.productId) continue;
        // Before the stock increase: the average is taken against what was
        // on hand before these units arrived.
        await receiveAtCost(tx, {
          organizationId,
          productId: poItem.productId,
          quantity: line.quantity,
          unitCost: Number(poItem.unitCost) * netFactor,
          source: CostChangeSource.GOODS_RECEIPT,
          sourceId: receipt.id,
          userId,
        });
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

      // Inventory (+ Input VAT) debit, AP credit, same transaction as
      // the receipt. If posting throws, the receipt, stock increase, and
      // status change all roll back together.
      await this.postingRules.postGoodsReceipt(organizationId, receipt.id, tx);

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

  private async receivedQuantitiesByPoItem(
    purchaseOrderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, number>> {
    const [receiptRows, items] = await Promise.all([
      tx.goodsReceiptItem.groupBy({
        by: ['purchaseOrderItemId'],
        where: { goodsReceipt: { purchaseOrderId } },
        _sum: { quantity: true },
      }),
      tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId },
        select: { id: true, importedReceivedQuantity: true },
      }),
    ]);

    const map = new Map<string, number>();

    for (const item of items as any[]) {
      const imported = Number(item.importedReceivedQuantity ?? 0);
      if (imported > 0) map.set(item.id, imported);
    }

    for (const r of receiptRows as any[]) {
      const existing = map.get(r.purchaseOrderItemId) ?? 0;
      map.set(r.purchaseOrderItemId, round2(existing + Number(r._sum.quantity ?? 0)));
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
      throw new BadRequestException(`Cannot receive goods against a purchase order in ${po.status} status`);
    }
    return po;
  }
}