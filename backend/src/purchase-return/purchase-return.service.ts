import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CostChangeSource,
  EventType,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { issueAtCost } from '../accounting/inventory-costing';
import { assertSerialCount, normalizeSerials, takeSerials } from '../serials/serial-moves';
import { CreatePurchaseReturnDto } from './dto/purchase-return.dto';

type Db = Prisma.TransactionClient | PrismaService;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Goods sent back to the supplier. Only what actually came in through a
// goods receipt can go back (historic Accurate-imported quantities never
// credited AP here, so returning them would debit AP that was never
// owed), less whatever was already returned.
//
// Valued exactly like the receipt that brought the goods in
// (PostingRulesService.postGoodsReceipt): the PO's discount and tax are
// allocated in proportion to the returned units' raw value, so a full
// return reverses the receipt's AP credit to the rupiah.
@Injectable()
export class PurchaseReturnService {
  constructor(
    private prisma: PrismaService,
    private stock: StockService,
    private tenantOwnership: TenantOwnershipService,
    private numbering: DocumentNumberingService,
    private postingRules: PostingRulesService,
  ) {}

  async list(organizationId: string, purchaseOrderId?: string) {
    return this.prisma.purchaseReturn.findMany({
      where: { organizationId, ...(purchaseOrderId && { purchaseOrderId }) },
      include: {
        items: {
          include: {
            product: { select: { name: true, sku: true } },
            batch: { select: { batchNumber: true } },
          },
        },
        location: { select: { name: true } },
        purchaseOrder: {
          select: { poNumber: true, supplier: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // Per PO line: received through goods receipts, already returned, and
  // what can still go back.
  async returnable(organizationId: string, purchaseOrderId: string) {
    const po = await this.getPoOrThrow(organizationId, purchaseOrderId);
    const { received, returned } = await this.quantities(purchaseOrderId);
    const serialTracked = new Set(
      (
        await this.prisma.product.findMany({
          where: {
            organizationId,
            trackSerials: true,
            id: { in: po.items.map((i) => i.productId).filter((x): x is string => !!x) },
          },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    return {
      purchaseOrderId: po.id,
      items: po.items.map((item) => {
        const r = received.get(item.id) ?? 0;
        const back = returned.get(item.id) ?? 0;
        return {
          purchaseOrderItemId: item.id,
          productId: item.productId,
          description: item.description,
          unitCost: Number(item.unitCost),
          received: r,
          returned: back,
          returnable: round2(r - back),
          // The return form asks which units on these.
          trackSerials: !!item.productId && serialTracked.has(item.productId),
        };
      }),
    };
  }

  async create(
    organizationId: string,
    userId: string,
    purchaseOrderId: string,
    dto: CreatePurchaseReturnDto,
  ) {
    const po = await this.getPoOrThrow(organizationId, purchaseOrderId);
    await this.tenantOwnership.validate(organizationId, {
      locationId: dto.locationId,
    });
    const poItems = new Map(po.items.map((i) => [i.id, i]));

    const requested = new Map<string, number>();
    for (const line of dto.items) {
      if (!poItems.has(line.purchaseOrderItemId)) {
        throw new NotFoundException(
          `Purchase order item ${line.purchaseOrderItemId} not found on this PO`,
        );
      }
      requested.set(
        line.purchaseOrderItemId,
        round2((requested.get(line.purchaseOrderItemId) ?? 0) + line.quantity),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Same lock as GoodsReceiptService.receive, so a return and a receipt
      // against one PO can't both read stale totals.
      await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${po.id} FOR UPDATE`;

      const { received, returned } = await this.quantities(po.id, tx);
      for (const [poItemId, qty] of requested) {
        const left = round2(
          (received.get(poItemId) ?? 0) - (returned.get(poItemId) ?? 0),
        );
        if (qty > left) {
          throw new BadRequestException(
            `Cannot return ${qty} — only ${left} received and not yet returned for this item`,
          );
        }
      }

      const poSubtotal = Number(po.subtotal);
      const netFactor =
        poSubtotal > 0 ? 1 - Number(po.discountAmount) / poSubtotal : 1;
      const taxFactor = poSubtotal > 0 ? Number(po.taxAmount) / poSubtotal : 0;

      let rawValue = 0;
      const lines = dto.items.map((line) => {
        const poItem = poItems.get(line.purchaseOrderItemId)!;
        rawValue += line.quantity * Number(poItem.unitCost);
        return {
          line,
          poItem,
          netUnitCost: round2(Number(poItem.unitCost) * netFactor),
        };
      });
      const allocatedDiscount = round2(
        Number(po.discountAmount) *
          (poSubtotal > 0 ? rawValue / poSubtotal : 0),
      );
      const subtotal = round2(rawValue - allocatedDiscount);
      const taxAmount = round2(rawValue * taxFactor);
      const total = round2(subtotal + taxAmount);

      // Serial-tracked products go back unit by unit.
      const serialProducts = new Map(
        (
          await tx.product.findMany({
            where: {
              organizationId,
              trackSerials: true,
              id: { in: lines.map((l) => l.poItem.productId).filter((x): x is string => !!x) },
            },
            select: { id: true, name: true },
          })
        ).map((p) => [p.id, p.name]),
      );
      const serialsByLine = lines.map(({ line, poItem }) => {
        if (!poItem.productId || !serialProducts.has(poItem.productId)) return [];
        const serials = normalizeSerials(line.serialNumbers);
        assertSerialCount(serialProducts.get(poItem.productId)!, line.quantity, serials);
        return serials;
      });

      for (const { line, poItem } of lines) {
        if (line.batchId) {
          if (!poItem.productId)
            throw new BadRequestException('Batch not found for this product');
          const batch = await tx.productBatch.findFirst({
            where: {
              id: line.batchId,
              organizationId,
              productId: poItem.productId,
            },
          });
          if (!batch)
            throw new BadRequestException('Batch not found for this product');
        }
      }

      const returnNumber = await this.numbering.nextSequential(
        tx,
        organizationId,
        'PURCHASE_RETURN',
        'PR',
      );
      const created = await tx.purchaseReturn.create({
        data: {
          organizationId,
          purchaseOrderId: po.id,
          locationId: dto.locationId,
          userId,
          returnNumber,
          reason: dto.reason?.trim() || null,
          subtotal,
          taxAmount,
          total,
          items: {
            create: lines.map(({ line, poItem, netUnitCost }, i) => ({
              purchaseOrderItemId: poItem.id,
              productId: poItem.productId,
              quantity: line.quantity,
              unitCost: netUnitCost,
              batchId: line.batchId ?? null,
              serialNumbers: serialsByLine[i],
            })),
          },
        },
        include: { items: true },
      });

      for (const [i, { line, poItem, netUnitCost }] of lines.entries()) {
        if (!poItem.productId) continue;
        await takeSerials(tx, {
          organizationId,
          productId: poItem.productId,
          locationId: dto.locationId,
          serials: serialsByLine[i],
          to: 'RETURNED_TO_SUPPLIER',
          refs: { purchaseReturnId: created.id },
        });
        // Before the decrease: the average is recomputed against what was
        // on hand including these units.
        await issueAtCost(tx, {
          organizationId,
          productId: poItem.productId,
          quantity: line.quantity,
          unitCost: netUnitCost,
          source: CostChangeSource.PURCHASE_RETURN,
          sourceId: created.id,
          userId,
        });
        await this.stock.decrease(
          organizationId,
          poItem.productId,
          dto.locationId,
          line.quantity,
          userId,
          {
            type: EventType.PURCHASE_RETURN,
            metadata: { purchaseOrderId: po.id, purchaseReturnId: created.id },
          },
          tx,
        );
        if (line.batchId) {
          // Guarded so a batch can't go negative — also covers two lines (or
          // two concurrent returns) drawing on the same batch.
          const taken = await tx.productBatch.updateMany({
            where: { id: line.batchId, quantity: { gte: line.quantity } },
            data: { quantity: { decrement: line.quantity } },
          });
          if (taken.count === 0)
            throw new BadRequestException(
              'This batch does not have enough quantity left to return',
            );
        }
      }

      await this.postingRules.postPurchaseReturn(
        organizationId,
        created.id,
        tx,
      );
      return created;
    });
  }

  private async getPoOrThrow(organizationId: string, purchaseOrderId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    const allowed: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
      PurchaseOrderStatus.FULLY_RECEIVED,
      // A PO cancelled after a partial receipt still has goods that can go back.
      PurchaseOrderStatus.CANCELLED,
    ];
    if (!allowed.includes(po.status)) {
      throw new BadRequestException(
        `Nothing has been received on a purchase order in ${po.status} status`,
      );
    }
    return po;
  }

  private async quantities(purchaseOrderId: string, db: Db = this.prisma) {
    const [receivedRows, returnedRows] = await Promise.all([
      db.goodsReceiptItem.groupBy({
        by: ['purchaseOrderItemId'],
        where: { goodsReceipt: { purchaseOrderId } },
        _sum: { quantity: true },
      }),
      db.purchaseReturnItem.groupBy({
        by: ['purchaseOrderItemId'],
        where: { purchaseReturn: { purchaseOrderId } },
        _sum: { quantity: true },
      }),
    ]);
    const toMap = (
      rows: {
        purchaseOrderItemId: string;
        _sum: { quantity: Prisma.Decimal | null };
      }[],
    ) =>
      new Map(
        rows.map((r) => [r.purchaseOrderItemId, Number(r._sum.quantity ?? 0)]),
      );
    return { received: toMap(receivedRows), returned: toMap(returnedRows) };
  }
}
