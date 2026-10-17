import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventType, Prisma, StockTransferStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { assertSerialCount, landTransferSerials, normalizeSerials, takeSerials } from '../serials/serial-moves';
import {
  CreateStockTransferDto,
  ReceiveStockTransferDto,
} from './dto/stock-transfer.dto';

type Tx = Prisma.TransactionClient;

const transferInclude = {
  fromLocation: { select: { id: true, name: true } },
  toLocation: { select: { id: true, name: true } },
  items: {
    include: {
      product: { select: { id: true, name: true, sku: true, unit: true } },
    },
  },
} satisfies Prisma.StockTransferInclude;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Stock moving between the business's own locations as a document, for
// when it isn't instant (a truck between branches). A quick move is the
// same document shipped and received in one step, for moves within a site
// — so every move, instant or not, is listed and carries its serials.
//
// No journal entry for the move itself: Inventory is one account for all
// locations, so its value doesn't change. While IN_TRANSIT the goods are in
// no Stock row; inventory-costing still counts them as on hand. Only a
// shortfall at receipt (lost or damaged on the way) is written off, at the
// current average cost, exactly like a stock adjustment.
@Injectable()
export class StockTransferService {
  constructor(
    private prisma: PrismaService,
    private stock: StockService,
    private tenantOwnership: TenantOwnershipService,
    private numbering: DocumentNumberingService,
    private postingRules: PostingRulesService,
  ) {}

  list(organizationId: string, status?: StockTransferStatus) {
    return this.prisma.stockTransfer.findMany({
      where: { organizationId, ...(status && { status }) },
      include: transferInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async get(organizationId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, organizationId },
      include: transferInclude,
    });
    if (!transfer) throw new NotFoundException('Stock transfer not found');
    return transfer;
  }

  async create(
    organizationId: string,
    userId: string,
    dto: CreateStockTransferDto,
  ) {
    if (dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException('Choose two different locations');
    }
    await this.tenantOwnership.validate(organizationId, {
      locationId: dto.fromLocationId,
    });
    await this.tenantOwnership.validate(organizationId, {
      locationId: dto.toLocationId,
    });

    // One line per product, quantities (and any serial numbers) combined.
    const byProduct = new Map<string, number>();
    const serialsByProduct = new Map<string, string[]>();
    for (const line of dto.items) {
      byProduct.set(
        line.productId,
        round2((byProduct.get(line.productId) ?? 0) + line.quantity),
      );
      serialsByProduct.set(line.productId, [...(serialsByProduct.get(line.productId) ?? []), ...(line.serialNumbers ?? [])]);
    }
    // Serial-tracked products move unit by unit: one serial per quantity.
    const tracked = await this.prisma.product.findMany({
      where: { id: { in: [...byProduct.keys()] }, organizationId, trackSerials: true },
      select: { id: true, name: true },
    });
    for (const p of tracked) {
      const serials = normalizeSerials(serialsByProduct.get(p.id));
      assertSerialCount(p.name, byProduct.get(p.id)!, serials);
      serialsByProduct.set(p.id, serials);
    }
    const trackedIds = new Set(tracked.map((p) => p.id));
    const products = await this.prisma.product.count({
      where: {
        id: { in: [...byProduct.keys()] },
        organizationId,
        active: true,
      },
    });
    if (products !== byProduct.size)
      throw new BadRequestException(
        'One or more products were not found or are archived',
      );

    return this.prisma.$transaction(async (tx) => {
      const transferNumber = await this.numbering.nextSequential(
        tx,
        organizationId,
        'STOCK_TRANSFER',
        'TR',
      );
      const created = await tx.stockTransfer.create({
        data: {
          organizationId,
          transferNumber,
          fromLocationId: dto.fromLocationId,
          toLocationId: dto.toLocationId,
          quickMove: !!dto.quickMove,
          notes: dto.notes?.trim() || null,
          createdById: userId,
          items: {
            create: [...byProduct].map(([productId, quantity]) => ({
              productId,
              quantity,
              serialNumbers: trackedIds.has(productId) ? serialsByProduct.get(productId) : [],
            })),
          },
        },
        include: transferInclude,
      });
      if (!dto.quickMove) return created;
      await this.shipIn(tx, organizationId, created.id, userId);
      return this.receiveIn(tx, organizationId, created.id, userId, {});
    });
  }

  // The goods leave the source location.
  ship(organizationId: string, id: string, userId: string) {
    return this.prisma.$transaction((tx) =>
      this.shipIn(tx, organizationId, id, userId),
    );
  }

  private async shipIn(tx: Tx, organizationId: string, id: string, userId: string) {
    const transfer = await this.lockInStatus(tx, organizationId, id, [
      StockTransferStatus.DRAFT,
    ]);
    for (const item of transfer.items) {
      await takeSerials(tx, {
        organizationId,
        productId: item.productId,
        locationId: transfer.fromLocationId,
        serials: item.serialNumbers,
        to: 'IN_TRANSIT',
        refs: { stockTransferId: id },
      });
      await this.stock.decrease(
        organizationId,
        item.productId,
        transfer.fromLocationId,
        Number(item.quantity),
        userId,
        {
          type: EventType.TRANSFER_OUT,
          metadata: {
            stockTransferId: id,
            toLocationId: transfer.toLocationId,
          },
        },
        tx,
      );
    }
    return tx.stockTransfer.update({
      where: { id },
      data: {
        status: StockTransferStatus.IN_TRANSIT,
        shippedAt: new Date(),
        shippedById: userId,
      },
      include: transferInclude,
    });
  }

  receive(
    organizationId: string,
    id: string,
    userId: string,
    dto: ReceiveStockTransferDto,
  ) {
    return this.prisma.$transaction((tx) =>
      this.receiveIn(tx, organizationId, id, userId, dto),
    );
  }

  private async receiveIn(
    tx: Tx,
    organizationId: string,
    id: string,
    userId: string,
    dto: ReceiveStockTransferDto,
  ) {
    const transfer = await this.lockInStatus(tx, organizationId, id, [
      StockTransferStatus.IN_TRANSIT,
    ]);
    const counted = new Map(
      (dto.items ?? []).map((l) => [l.itemId, l.receivedQuantity]),
    );
    const missingSerials = new Map(
      (dto.items ?? []).map((l) => [l.itemId, normalizeSerials(l.missingSerials)]),
    );
    for (const itemId of counted.keys()) {
      if (!transfer.items.some((i) => i.id === itemId))
        throw new BadRequestException(
          `Item ${itemId} is not on this transfer`,
        );
    }

    for (const item of transfer.items) {
      const shipped = Number(item.quantity);
      const received = round2(counted.get(item.id) ?? shipped);
      if (received > shipped) {
        throw new BadRequestException(
          'Received quantity cannot be more than was shipped',
        );
      }
      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: { receivedQuantity: received },
      });
      if (item.serialNumbers.length) {
        // Which units didn't arrive has to be said, not guessed.
        const lost = missingSerials.get(item.id) ?? [];
        const shortBy = round2(shipped - received);
        if (lost.length !== shortBy || lost.some((s) => !item.serialNumbers.includes(s))) {
          throw new BadRequestException(
            shortBy > 0
              ? `List the ${shortBy} serial number(s) that did not arrive`
              : 'Only list missing serial numbers when something is short',
          );
        }
        await landTransferSerials(tx, {
          organizationId,
          stockTransferId: id,
          locationId: transfer.toLocationId,
          productId: item.productId,
          lost,
        });
      }
      if (received > 0) {
        await this.stock.increase(
          organizationId,
          item.productId,
          transfer.toLocationId,
          received,
          userId,
          {
            type: EventType.TRANSFER_IN,
            metadata: {
              stockTransferId: id,
              fromLocationId: transfer.fromLocationId,
            },
          },
          tx,
        );
      }
      const shortfall = round2(shipped - received);
      if (shortfall > 0) {
        const product = await tx.product.findFirst({
          where: { id: item.productId, organizationId },
          select: { costPrice: true },
        });
        await this.postingRules.postStockAdjustment(
          organizationId,
          {
            sourceId: `stock-transfer:${item.id}`,
            date: new Date(),
            memo: `Shortfall on stock transfer ${transfer.transferNumber ?? id}`,
            qtyDelta: -shortfall,
            unitCost:
              product?.costPrice != null ? Number(product.costPrice) : null,
            locationId: transfer.toLocationId,
            counter: 'ADJUSTMENT',
          },
          tx,
        );
      }
    }

    // Status last: until it changes, the shortfall's units still count as
    // in transit for costing, which is what they were at that moment.
    return tx.stockTransfer.update({
      where: { id },
      data: {
        status: StockTransferStatus.RECEIVED,
        receivedAt: new Date(),
        receivedById: userId,
      },
      include: transferInclude,
    });
  }

  // A draft is simply dropped; goods already on the way go back to the
  // source location.
  async cancel(organizationId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await this.lockInStatus(tx, organizationId, id, [
        StockTransferStatus.DRAFT,
        StockTransferStatus.IN_TRANSIT,
      ]);
      if (transfer.status === StockTransferStatus.IN_TRANSIT) {
        await landTransferSerials(tx, {
          organizationId,
          stockTransferId: id,
          locationId: transfer.fromLocationId,
        });
        for (const item of transfer.items) {
          await this.stock.increase(
            organizationId,
            item.productId,
            transfer.fromLocationId,
            Number(item.quantity),
            userId,
            {
              type: EventType.TRANSFER_IN,
              metadata: { stockTransferId: id, cancelled: true },
            },
            tx,
          );
        }
      }
      return tx.stockTransfer.update({
        where: { id },
        data: {
          status: StockTransferStatus.CANCELLED,
          cancelledAt: new Date(),
        },
        include: transferInclude,
      });
    });
  }

  // Row lock so ship/receive/cancel can't race each other on one transfer.
  private async lockInStatus(
    tx: Tx,
    organizationId: string,
    id: string,
    allowed: StockTransferStatus[],
  ) {
    await tx.$queryRaw`SELECT id FROM "StockTransfer" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
    const transfer = await tx.stockTransfer.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!transfer) throw new NotFoundException('Stock transfer not found');
    if (!allowed.includes(transfer.status)) {
      throw new BadRequestException(
        `This transfer is ${transfer.status.toLowerCase().replace('_', ' ')}`,
      );
    }
    return transfer;
  }
}
