import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { InvoiceService } from '../invoice/invoice.service';
import { PrintTokenService } from '../common/print/print-token.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import {
  DeliveryOrderStatus,
  SalesOrderStatus,
  EventType,
  Prisma,
  DeliveryPriority,
} from '@prisma/client';
import { CreateDeliveryOrderDto } from './dto/delivery-order.dto';
import { DeliveryRoutesService } from '../delivery-routes/delivery-routes.service';
import { NotificationsService } from '../notifications/notifications.service';

import puppeteer from 'puppeteer';

export type DeliveryOrderPrintView = {
  id: string;
  doNumber: string | null;
  status: string;

  businessName: string;
  businessLegalName: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessLogoUrl: string | null;
  invoiceNumber: string | null;

  locationName: string;
  locationAddress: string | null;

  salesOrderNumber: string | null;

  customerName: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  customerPoNumber: string | null;
  deliveryAddress: string | null;

  createdAt: Date;
  shippedAt: Date | null;
  notes: string | null;

  deliveredBy: string | null;
  receivedBy: string | null;
  signedAt: Date | null;

  items: {
    id: string;
    productName: string;
    quantity: number;
    unit: string | null;
  }[];
};

@Injectable()
export class DeliveryOrderService {
  constructor(
    private prisma: PrismaService,
    private tenantOwnership: TenantOwnershipService,
    private numbering: DocumentNumberingService,
    private salesOrderService: SalesOrderService,
    private invoiceService: InvoiceService,
    private stockService: StockService,
    private printTokenService: PrintTokenService,
    private postingRules: PostingRulesService,
    private deliveryRoutesService: DeliveryRoutesService,
    private notifications: NotificationsService,
  ) {}

  // Creating a delivery order is a planned/prepared delivery — a
  // commitment against the sales order's remaining quantities, not a
  // physical movement. No stock is touched here. The actual departure
  // event is ship(), below.
  //
  // Each created line snapshots unitCost off the originating
  // SalesOrderItem, same denormalization pattern as productName just
  // below it. This is what lets ship() and recordReturn() post COGS
  // without a join back to the sales order — the cost basis travels with
  // the delivery order the way productName already does, and doesn't
  // drift if the product's costPrice changes between order and shipment.
  async create(
    organizationId: string,
    userId: string,
    dto: CreateDeliveryOrderDto,
  ) {
    await this.tenantOwnership.validate(organizationId, {
      locationId: dto.locationId,
    });

    if (!dto.items?.length) {
      throw new BadRequestException(
        'Delivery order must have at least one item',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock the order row so a concurrent SalesOrderService.cancel()
      // (which takes the same lock) can't cancel this order out from
      // under a delivery that's about to be created against it.
      await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE id = ${dto.salesOrderId} FOR UPDATE`;

      const salesOrder = await tx.salesOrder.findFirst({
        where: { id: dto.salesOrderId, organizationId },
        include: { items: true, customer: true },
      });
      if (!salesOrder) throw new NotFoundException('Sales order not found');

      const allowedStatuses: SalesOrderStatus[] = [
        SalesOrderStatus.CONFIRMED,
        SalesOrderStatus.PARTIALLY_DELIVERED,
      ];
      if (!allowedStatuses.includes(salesOrder.status)) {
        throw new BadRequestException(
          `Cannot deliver against a sales order in ${salesOrder.status} status`,
        );
      }

      const itemsById = new Map(salesOrder.items.map((i) => [i.id, i]));
      for (const line of dto.items) {
        const soItem = itemsById.get(line.salesOrderItemId);
        if (!soItem)
          throw new BadRequestException(
            `Sales order item ${line.salesOrderItemId} not found on this order`,
          );
        if (line.quantity <= 0)
          throw new BadRequestException('Delivery quantity must be positive');
        // Fast pre-check only — this read isn't locked and can be stale
        // under concurrent deliveries against the same line. The
        // authoritative check is the atomic claim below.
        const remaining =
          Number(soItem.quantity) - Number(soItem.deliveredQuantity);
        if (line.quantity > remaining) {
          throw new BadRequestException(
            `Cannot deliver ${line.quantity} — only ${remaining} remaining on this line`,
          );
        }
      }

      const productIds = dto.items
        .map((l) => itemsById.get(l.salesOrderItemId)!.productId)
        .filter((id): id is string => !!id);
      const products = productIds.length
        ? await tx.product.findMany({
            where: { id: { in: productIds }, organizationId },
            select: { id: true, name: true },
          })
        : [];
      const productNameById = new Map(products.map((p) => [p.id, p.name]));

      const doNumber = await this.numbering.nextSequential(
        tx,
        organizationId,
        'DELIVERY_ORDER',
        'DO',
      );

      const deliveryOrder = await tx.deliveryOrder.create({
        data: {
          organizationId,
          salesOrderId: salesOrder.id,
          sessionId: dto.sessionId,
          locationId: dto.locationId,
          userId,
          doNumber,
          status: DeliveryOrderStatus.PACKED,
          customerId: salesOrder.customerId,
          customerName: salesOrder.customer?.name ?? salesOrder.customerName,
          customerAddress: salesOrder.customer?.address ?? null,
          customerPhone: salesOrder.customer?.phone ?? null,
          customerPoNumber: salesOrder.customerPoNumber,
          deliveryAddress:
            dto.deliveryAddress ?? salesOrder.customer?.address ?? null,
          // Inherit the customer's saved default location, if any — set
          // once on the customer, reused on every new shipment; still
          // correctable per-shipment via the existing destination picker.
          destinationLatitude: salesOrder.customer?.latitude ?? null,
          destinationLongitude: salesOrder.customer?.longitude ?? null,
          notes: dto.notes ?? null,
          items: {
            create: dto.items.map((line) => {
              const soItem = itemsById.get(line.salesOrderItemId)!;
              return {
                salesOrderItemId: soItem.id,
                productId: soItem.productId,
                productName: soItem.productId
                  ? (productNameById.get(soItem.productId) ?? 'Unknown product')
                  : (soItem.description ?? 'Service'),
                quantity: line.quantity,
                unit: soItem.unit,
                locationId: soItem.locationId,
                unitCost: soItem.unitCost,
              };
            }),
          },
        },
        include: { items: true },
      });

      for (const line of dto.items) {
        const soItem = itemsById.get(line.salesOrderItemId)!;
        // Atomic claim: only succeeds if deliveredQuantity + line.quantity
        // wouldn't exceed the ordered quantity, checked and applied in one
        // statement so two concurrent create() calls against the same
        // line can't both pass the (unlocked) pre-check above.
        const claim = await tx.salesOrderItem.updateMany({
          where: {
            id: line.salesOrderItemId,
            deliveredQuantity: { lte: Number(soItem.quantity) - line.quantity },
          },
          data: { deliveredQuantity: { increment: line.quantity } },
        });
        if (claim.count === 0) {
          throw new BadRequestException(
            `Cannot deliver ${line.quantity} on line ${line.salesOrderItemId} — remaining quantity changed concurrently, please retry`,
          );
        }
      }

      await this.salesOrderService.recomputeDeliveryStatus(
        organizationId,
        salesOrder.id,
        tx,
      );

      return deliveryOrder;
    });
  }

  // The physical departure event. This is the ONLY place stock is
  // decremented for a delivery order's fulfillment — neither
  // SalesOrder.confirm() nor DeliveryOrder.create() touch stock.
  //
  // This is also where COGS gets posted, for the same reason: this is
  // the first point at which goods for THIS delivery order actually left
  // the building. Revenue was already recognized back at Invoice.issue()
  // (for invoice-sourced DOs, the whole invoice total; for
  // sales-order-sourced DOs, revenue posts once the resulting invoice is
  // issued) — COGS has to track the shipment event specifically, not the
  // invoice event, since under the oversell/backorder model a delivery
  // order can ship well after its invoice was issued.
  //
  // A delivery order created from a warehouse Session (sessionId set)
  // skips both the stock decrement AND the COGS posting here — its stock
  // already moved at pick time, and that pick event is where COGS for it
  // belongs. See SessionsService.addItem()'s PICK case for that posting.
  //
  // costedLines carry each item's own locationId, not just
  // productId/quantity/unitCost — postCogs() groups by location itself,
  // which is what makes per-location P&L work correctly instead of every
  // COGS/Inventory line landing with locationId: null.
  async ship(organizationId: string, id: string, userId: string) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (deliveryOrder.status !== DeliveryOrderStatus.PACKED) {
      throw new BadRequestException(
        'Only a packed delivery order can be shipped',
      );
    }

    const salesOrderId = deliveryOrder.salesOrderId;
    const invoiceId = deliveryOrder.invoiceId;
    const shouldDecreaseStock = !deliveryOrder.sessionId;

    if (shouldDecreaseStock) {
      const missingLocation = deliveryOrder.items.find(
        (item) => item.productId && !item.locationId,
      );
      if (missingLocation) {
        throw new BadRequestException(
          `Item ${missingLocation.id} has a product but no location set; cannot decrease stock`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.deliveryOrder.updateMany({
        where: { id, organizationId, status: DeliveryOrderStatus.PACKED },
        data: { status: DeliveryOrderStatus.SHIPPED, shippedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new BadRequestException(
          'This delivery order has already been shipped or is no longer packed',
        );
      }

      const costedLines: {
        productId: string;
        quantity: number;
        unitCost: number | null;
        locationId: string | null;
      }[] = [];

      if (shouldDecreaseStock) {
        for (const item of deliveryOrder.items) {
          if (!item.productId || !item.locationId) continue;
          await this.stockService.decrease(
            organizationId,
            item.productId,
            item.locationId,
            Number(item.quantity),
            userId,
            salesOrderId
              ? {
                  type: EventType.SALE,
                  salesOrderId,
                  metadata: { deliveryOrderId: deliveryOrder.id },
                }
              : {
                  type: EventType.SALE,
                  invoiceId: invoiceId!,
                  metadata: { deliveryOrderId: deliveryOrder.id },
                },
            tx,
          );
          costedLines.push({
            productId: item.productId,
            quantity: Number(item.quantity),
            unitCost: item.unitCost != null ? Number(item.unitCost) : null,
            locationId: item.locationId,
          });
        }
      }

      if (invoiceId) {
        for (const item of deliveryOrder.items) {
          if (!item.invoiceItemId) continue;
          const shippedQty = Number(item.quantity);
          await tx.invoiceItem.update({
            where: { id: item.invoiceItemId },
            data: {
              reservedQuantity: { decrement: shippedQty },
              fulfilledQuantity: { increment: shippedQty },
            },
          });
        }
        await this.invoiceService.recomputeFulfillmentStatus(
          organizationId,
          invoiceId,
          tx,
        );
      }

      if (costedLines.length > 0) {
        await this.postingRules.postCogs(
          organizationId,
          {
            sourceId: `${deliveryOrder.id}:cogs`,
            date: new Date(),
            memo: `COGS for delivery order ${deliveryOrder.doNumber ?? deliveryOrder.id}`,
            lines: costedLines,
          },
          tx,
        );
      }

      return tx.deliveryOrder.findUniqueOrThrow({ where: { id } });
    });
  }

  // A DRIVER account may only act on a delivery order that's actually on
  // one of their own routes (see backend/src/delivery-routes) — ADMIN/USER
  // are unrestricted, same as every other delivery-order action, since
  // staff have always been able to record proof directly without a route.
  private async assertRequesterCanActOnDeliveryOrder(
    deliveryOrderId: string,
    requester?: { sub: string; role: string },
  ) {
    if (!requester || requester.role !== 'DRIVER') return;
    const stop = await this.prisma.routeStop.findFirst({
      where: { deliveryOrderId, route: { driverId: requester.sub } },
      select: { id: true },
    });
    if (!stop) {
      throw new ForbiddenException(
        'This delivery order is not on one of your routes',
      );
    }
  }

  async recordProofOfDelivery(
    organizationId: string,
    id: string,
    params: {
      deliveredBy?: string;
      receivedBy?: string;
      signedAt?: Date;
      completedLatitude?: number;
      completedLongitude?: number;
      proofPhotoUrl?: string;
    },
    requester?: { sub: string; role: string },
  ) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (deliveryOrder.status !== DeliveryOrderStatus.SHIPPED) {
      throw new BadRequestException(
        'Proof of delivery can only be recorded once the delivery order has shipped',
      );
    }
    await this.assertRequesterCanActOnDeliveryOrder(id, requester);

    const signedAt = params.signedAt ?? deliveryOrder.signedAt ?? new Date();
    const updated = await this.prisma.deliveryOrder.update({
      where: { id },
      data: {
        deliveredBy: params.deliveredBy ?? deliveryOrder.deliveredBy,
        receivedBy: params.receivedBy ?? deliveryOrder.receivedBy,
        signedAt,
        completedLatitude:
          params.completedLatitude ?? deliveryOrder.completedLatitude,
        completedLongitude:
          params.completedLongitude ?? deliveryOrder.completedLongitude,
        proofPhotoUrl: params.proofPhotoUrl ?? deliveryOrder.proofPhotoUrl,
      },
    });

    // Best-effort — an ETA-recalc hiccup must never block the delivery
    // action itself, which has already succeeded by this point.
    try {
      await this.deliveryRoutesService.recalculateEtasAfterResolution(
        id,
        signedAt,
      );
    } catch {
      // ignore
    }

    return updated;
  }

  // Single-shot GPS capture at the moment of a failed delivery attempt —
  // same "SHIPPED -> terminal status" shape as cancel()'s atomic claim,
  // parallel to recordProofOfDelivery but ends in FAILED instead of
  // leaving status at SHIPPED.
  async recordFailedDelivery(
    organizationId: string,
    id: string,
    params: {
      reason?: string;
      latitude?: number;
      longitude?: number;
      failedAt?: Date;
    },
    requester?: { sub: string; role: string },
  ) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (deliveryOrder.status !== DeliveryOrderStatus.SHIPPED) {
      throw new BadRequestException(
        'A failed delivery can only be recorded once the delivery order has shipped',
      );
    }
    await this.assertRequesterCanActOnDeliveryOrder(id, requester);

    const failedAt = params.failedAt ?? new Date();
    const claim = await this.prisma.deliveryOrder.updateMany({
      where: { id, organizationId, status: DeliveryOrderStatus.SHIPPED },
      data: {
        status: DeliveryOrderStatus.FAILED,
        failedAt,
        failureReason: params.reason ?? null,
        failureLatitude: params.latitude ?? null,
        failureLongitude: params.longitude ?? null,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        'This delivery order is no longer in SHIPPED status',
      );
    }

    try {
      await this.deliveryRoutesService.recalculateEtasAfterResolution(
        id,
        failedAt,
      );
    } catch {
      // ignore — best-effort, see recordProofOfDelivery's identical comment
    }

    await this.notifications.notifyOrgStaff(
      organizationId,
      'DELIVERY_FAILED',
      `Delivery failed: ${deliveryOrder.customerName ?? deliveryOrder.doNumber ?? id}`,
      { link: '/delivery/monitoring', payload: { deliveryOrderId: id } },
    );

    return this.prisma.deliveryOrder.findUniqueOrThrow({ where: { id } });
  }

  // Sets/corrects the destination pin used by the delivery map — planning
  // data, not a one-shot event capture, so unlike proof/failure above it
  // has no status gate and can be updated any time.
  async setDestination(
    organizationId: string,
    id: string,
    params: { latitude: number; longitude: number },
  ) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');

    return this.prisma.deliveryOrder.update({
      where: { id },
      data: {
        destinationLatitude: params.latitude,
        destinationLongitude: params.longitude,
      },
    });
  }

  // Planning data (priority, requested delivery window) — like
  // setDestination, correctable any time, no status gate.
  async updateDetails(
    organizationId: string,
    id: string,
    params: {
      priority?: DeliveryPriority;
      deliveryWindowStart?: Date;
      deliveryWindowEnd?: Date;
    },
  ) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');

    return this.prisma.deliveryOrder.update({
      where: { id },
      data: {
        priority: params.priority,
        deliveryWindowStart: params.deliveryWindowStart,
        deliveryWindowEnd: params.deliveryWindowEnd,
      },
    });
  }

  // Puts a FAILED delivery back into SHIPPED so it can be re-attempted —
  // unlinks it from whatever route it was on (bypassing removeStop's
  // "must be PENDING" guard, since this IS the recovery path for a
  // resolved-but-failed stop) so it becomes addable to a new route via the
  // ordinary addStop flow, on any date. failedAt/failureReason are kept as
  // history, not cleared — rescheduledAt records that this happened.
  async rescheduleDelivery(organizationId: string, id: string) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      include: { routeStop: { select: { id: true } } },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (deliveryOrder.status !== DeliveryOrderStatus.FAILED) {
      throw new BadRequestException(
        'Only a failed delivery can be rescheduled',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (deliveryOrder.routeStop) {
        await tx.routeStop.delete({
          where: { id: deliveryOrder.routeStop.id },
        });
      }
      return tx.deliveryOrder.update({
        where: { id },
        data: {
          status: DeliveryOrderStatus.SHIPPED,
          rescheduledAt: new Date(),
        },
      });
    });
  }

  // Only valid PACKED → CANCELLED. Nothing has physically left the
  // warehouse at PACKED (stock now only moves at ship()), so there is no
  // stock movement OR journal entry to reverse here — ship() hasn't run
  // yet, so no COGS was ever posted for this delivery order to begin with.
  async cancel(organizationId: string, id: string, userId: string) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (deliveryOrder.status !== DeliveryOrderStatus.PACKED) {
      throw new BadRequestException(
        'Only a packed (not yet shipped) delivery order can be cancelled',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Atomic status claim — same pattern as ship() — so two concurrent
      // cancel() calls on the same delivery order can't both pass the
      // (unlocked) status check above and both decrement quantities.
      const claim = await tx.deliveryOrder.updateMany({
        where: { id, organizationId, status: DeliveryOrderStatus.PACKED },
        data: { status: DeliveryOrderStatus.CANCELLED },
      });
      if (claim.count === 0) {
        throw new BadRequestException(
          'This delivery order is no longer packed — it may have already been shipped or cancelled',
        );
      }

      for (const item of deliveryOrder.items) {
        if (item.salesOrderItemId) {
          await tx.salesOrderItem.update({
            where: { id: item.salesOrderItemId },
            data: { deliveredQuantity: { decrement: item.quantity } },
          });
        } else if (item.invoiceItemId) {
          await tx.invoiceItem.update({
            where: { id: item.invoiceItemId },
            data: { reservedQuantity: { decrement: Number(item.quantity) } },
          });
        }
      }
      const cancelled = await tx.deliveryOrder.findUniqueOrThrow({
        where: { id },
      });
      if (deliveryOrder.salesOrderId) {
        await this.salesOrderService.recomputeDeliveryStatus(
          organizationId,
          deliveryOrder.salesOrderId,
          tx,
        );
      }
      return cancelled;
    });
  }

  // Finds the InvoiceItem that recognized revenue for a returned line,
  // regardless of which fulfillment path produced this DeliveryOrder.
  // Invoice-sourced DOs link directly via invoiceItemId. SalesOrder-sourced
  // DOs link only via salesOrderItemId — the matching InvoiceItem (if the
  // order was ever invoiced) carries the same salesOrderItemId, since
  // createDraftFromSalesOrder() copies SalesOrderItem lines forward onto
  // the new InvoiceItem rows it creates.
  //
  // Returns the invoiceId alongside the item id/quantity so the caller
  // never has to guess which invoice a SO-sourced return belongs to from
  // deliveryOrder.invoiceId (which is null for that path) — it comes
  // straight from wherever the InvoiceItem was actually found.
  private async resolveInvoiceItemForReturn(
    doItem: { invoiceItemId: number | null; salesOrderItemId: string | null },
    tx: Prisma.TransactionClient,
  ): Promise<{ id: number; invoiceId: string } | null> {
    if (doItem.invoiceItemId) {
      return tx.invoiceItem.findUnique({
        where: { id: doItem.invoiceItemId },
        select: { id: true, invoiceId: true },
      });
    }
    if (!doItem.salesOrderItemId) return null;

    // Safe to assume at most one invoice per SO — createDraftFromSalesOrder
    // refuses to create a second invoice while any prior one exists on the
    // order (see its `order.invoices.length > 0` check), so this can't
    // resolve to two different invoices across lines of the same DO.
    return tx.invoiceItem.findFirst({
      where: { salesOrderItemId: doItem.salesOrderItemId },
      select: { id: true, invoiceId: true },
    });
  }

  // A post-ship reversal — a customer return, not an undo of a mistake.
  // Supports partial returns.
  //
  // Mirrors ship()'s COGS posting: every unit that comes back via
  // stockService.increase() here had its cost expensed to COGS when it
  // shipped, so returning it has to reverse that same amount, or COGS
  // stays permanently overstated for anything ever returned.
  //
  // Also reverses revenue/tax/AR for whatever invoice line originally
  // recognized it — see postSalesReturn() for what that does and does
  // NOT touch (it leaves Invoice.amountPaid/paymentStatus alone; a
  // return against a paid invoice creates a real credit balance with no
  // refund workflow yet, which is a separate, not-yet-built piece).
  //
  // fulfilledQuantity/deliveredQuantity decrements use a clamped
  // updateMany (gte guard) rather than a plain update — this is the
  // ceiling that prevents postSalesReturn() from ever being asked to
  // reverse more revenue than was actually recognized on a line, even
  // across multiple partial recordReturn() calls over time.
  async recordReturn(
    organizationId: string,
    id: string,
    userId: string,
    items: { deliveryOrderItemId: string; quantity: number }[],
    reason?: string,
  ) {
    if (!items?.length) {
      throw new BadRequestException(
        'At least one item is required to record a return',
      );
    }

    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (
      deliveryOrder.status !== DeliveryOrderStatus.SHIPPED &&
      deliveryOrder.status !== DeliveryOrderStatus.PARTIALLY_RETURNED
    ) {
      throw new BadRequestException(
        'Only a shipped delivery order can have items returned',
      );
    }

    const itemsById = new Map(deliveryOrder.items.map((i) => [i.id, i]));
    for (const line of items) {
      const doItem = itemsById.get(line.deliveryOrderItemId);
      if (!doItem) {
        throw new BadRequestException(
          `Delivery order item ${line.deliveryOrderItemId} not found on this delivery`,
        );
      }
      if (line.quantity <= 0)
        throw new BadRequestException('Return quantity must be positive');
      const outstanding =
        Number(doItem.quantity) - Number(doItem.returnedQuantity);
      if (line.quantity > outstanding) {
        throw new BadRequestException(
          `Cannot return ${line.quantity} — only ${outstanding} of this line hasn't already been returned`,
        );
      }
    }

    const salesOrderId = deliveryOrder.salesOrderId;
    const invoiceId = deliveryOrder.invoiceId;
    if (!salesOrderId && !invoiceId) {
      throw new BadRequestException(
        'This delivery order has no originating sales order or invoice',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const costedReturnLines: {
        productId: string;
        quantity: number;
        unitCost: number | null;
        locationId: string | null;
      }[] = [];
      const revenueReturnLines: { invoiceItemId: number; quantity: number }[] =
        [];
      let resolvedInvoiceId: string | null = null;

      for (const line of items) {
        const doItem = itemsById.get(line.deliveryOrderItemId)!;

        await tx.deliveryOrderItem.update({
          where: { id: doItem.id },
          data: { returnedQuantity: { increment: line.quantity } },
        });

        if (doItem.salesOrderItemId) {
          const decremented = await tx.salesOrderItem.updateMany({
            where: {
              id: doItem.salesOrderItemId,
              deliveredQuantity: { gte: line.quantity },
            },
            data: { deliveredQuantity: { decrement: line.quantity } },
          });
          if (decremented.count === 0) {
            throw new BadRequestException(
              `Return quantity exceeds delivered quantity for sales order line ${doItem.salesOrderItemId}`,
            );
          }
        } else if (doItem.invoiceItemId) {
          const decremented = await tx.invoiceItem.updateMany({
            where: {
              id: doItem.invoiceItemId,
              fulfilledQuantity: { gte: line.quantity },
            },
            data: { fulfilledQuantity: { decrement: line.quantity } },
          });
          if (decremented.count === 0) {
            throw new BadRequestException(
              `Return quantity exceeds fulfilled quantity for invoice item ${doItem.invoiceItemId}`,
            );
          }
        }

        const revenueItem = await this.resolveInvoiceItemForReturn(doItem, tx);
        if (revenueItem) {
          if (
            resolvedInvoiceId &&
            resolvedInvoiceId !== revenueItem.invoiceId
          ) {
            throw new BadRequestException(
              'Return spans items from more than one invoice — this should not be possible',
            );
          }
          resolvedInvoiceId = revenueItem.invoiceId;
          revenueReturnLines.push({
            invoiceItemId: revenueItem.id,
            quantity: line.quantity,
          });
        }

        if (doItem.productId && doItem.locationId) {
          await this.stockService.increase(
            organizationId,
            doItem.productId,
            doItem.locationId,
            line.quantity,
            userId,
            salesOrderId
              ? {
                  type: EventType.RETURNS,
                  salesOrderId,
                  metadata: {
                    deliveryOrderId: deliveryOrder.id,
                    reason: reason ?? null,
                  },
                }
              : {
                  type: EventType.RETURNS,
                  invoiceId: invoiceId!,
                  metadata: {
                    deliveryOrderId: deliveryOrder.id,
                    reason: reason ?? null,
                  },
                },
            tx,
          );
          // Only goods whose stock actually came back have a COGS
          // reversal to post; a returned service line (no productId) has
          // no inventory/COGS entry to undo in the first place.
          costedReturnLines.push({
            productId: doItem.productId,
            quantity: line.quantity,
            unitCost: doItem.unitCost != null ? Number(doItem.unitCost) : null,
            locationId: doItem.locationId,
          });
        }
      }

      const updated = await this.recomputeReturnStatus(organizationId, id, tx);
      if (salesOrderId) {
        await this.salesOrderService.recomputeDeliveryStatus(
          organizationId,
          salesOrderId,
          tx,
        );
      }
      if (invoiceId) {
        await this.invoiceService.recomputeFulfillmentStatus(
          organizationId,
          invoiceId,
          tx,
        );
      }

      // One reversal entry per recordReturn() call, keyed by a timestamp
      // so multiple partial-return calls on the same delivery order each
      // get their own entry rather than colliding on sourceId.
      if (costedReturnLines.length > 0) {
        await this.postingRules.postCogsReturn(
          organizationId,
          {
            sourceId: `${deliveryOrder.id}:cogs-return:${Date.now()}`,
            date: new Date(),
            memo: `Return against delivery order ${deliveryOrder.doNumber ?? deliveryOrder.id}`,
            lines: costedReturnLines,
          },
          tx,
        );
      }

      // Reverse revenue/tax/AR for whatever had an invoice line to
      // reverse against. Gated on resolvedInvoiceId, not
      // deliveryOrder.invoiceId — a SalesOrder-sourced DO has a null
      // deliveryOrder.invoiceId but can still resolve an invoice via its
      // salesOrderItemId chain, and that resolved id is what must be used
      // here. If nothing resolved (e.g. the sales order was never
      // invoiced), nothing posts — correct, since no revenue was ever
      // recognized to reverse.
      if (revenueReturnLines.length > 0 && resolvedInvoiceId) {
        await this.postingRules.postSalesReturn(
          organizationId,
          {
            sourceId: `${deliveryOrder.id}:sales-return:${Date.now()}`,
            date: new Date(),
            memo: `Sales return against delivery order ${deliveryOrder.doNumber ?? deliveryOrder.id}`,
            invoiceId: resolvedInvoiceId,
            lines: revenueReturnLines,
          },
          tx,
        );
      }

      return updated;
    });
  }

  // Recomputes DeliveryOrder.status from summed returnedQuantity vs
  // quantity across its items.
  private async recomputeReturnStatus(
    organizationId: string,
    deliveryOrderId: string,
    tx: Prisma.TransactionClient,
  ) {
    const deliveryOrder = await tx.deliveryOrder.findFirst({
      where: { id: deliveryOrderId, organizationId },
      include: { items: true },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (
      deliveryOrder.status === DeliveryOrderStatus.PACKED ||
      deliveryOrder.status === DeliveryOrderStatus.CANCELLED
    ) {
      return deliveryOrder;
    }

    const allReturned = deliveryOrder.items.every(
      (i) => Number(i.returnedQuantity) >= Number(i.quantity),
    );
    const anyReturned = deliveryOrder.items.some(
      (i) => Number(i.returnedQuantity) > 0,
    );
    const newStatus = allReturned
      ? DeliveryOrderStatus.RETURNED
      : anyReturned
        ? DeliveryOrderStatus.PARTIALLY_RETURNED
        : DeliveryOrderStatus.SHIPPED;

    if (newStatus === deliveryOrder.status) return deliveryOrder;
    return tx.deliveryOrder.update({
      where: { id: deliveryOrderId },
      data: { status: newStatus },
    });
  }

  async list(
    organizationId: string,
    filters: {
      salesOrderId?: string;
      status?: DeliveryOrderStatus;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize =
      filters.pageSize && filters.pageSize > 0
        ? Math.min(filters.pageSize, 200)
        : 20;

    const where: Prisma.DeliveryOrderWhereInput = {
      organizationId,
      ...(filters.salesOrderId ? { salesOrderId: filters.salesOrderId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.deliveryOrder.findMany({
        where,
        include: {
          items: true,
          salesOrder: { select: { orderNumber: true, customerName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.deliveryOrder.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async getOne(organizationId: string, id: string) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      include: {
        items: { include: { product: true } },
        salesOrder: true,
        session: true,
        location: true,
        invoice: { select: { id: true, invoiceNumber: true } },
      },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    return deliveryOrder;
  }

  // ---- print / PDF ------------------------------------------------

  async getPrintView(
    organizationId: string,
    id: string,
  ): Promise<DeliveryOrderPrintView> {
    const deliveryOrder = await this.getPrintViewOrThrow(organizationId, id);
    return this.mapForPrint(deliveryOrder);
  }

  private async getPrintViewOrThrow(organizationId: string, id: string) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      include: {
        organization: {
          select: {
            name: true,
            legalName: true,
            address: true,
            phone: true,
            logoUrl: true,
          },
        },
        location: { select: { name: true, address: true } },
        salesOrder: { select: { orderNumber: true } },
        invoice: { select: { invoiceNumber: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    return deliveryOrder;
  }

  private mapForPrint(deliveryOrder: any): DeliveryOrderPrintView {
    return {
      id: deliveryOrder.id,
      doNumber: deliveryOrder.doNumber,
      status: deliveryOrder.status,

      businessName: deliveryOrder.organization.name,
      businessLegalName: deliveryOrder.organization.legalName,
      businessAddress: deliveryOrder.organization.address,
      businessPhone: deliveryOrder.organization.phone,
      businessLogoUrl: deliveryOrder.organization.logoUrl,
      invoiceNumber: deliveryOrder.invoice?.invoiceNumber ?? null,

      locationName: deliveryOrder.location?.name ?? '',
      locationAddress: deliveryOrder.location?.address ?? null,

      salesOrderNumber: deliveryOrder.salesOrder?.orderNumber ?? null,

      customerName: deliveryOrder.customerName,
      customerAddress: deliveryOrder.customerAddress,
      customerPhone: deliveryOrder.customerPhone,
      customerPoNumber: deliveryOrder.customerPoNumber,
      deliveryAddress: deliveryOrder.deliveryAddress,

      createdAt: deliveryOrder.createdAt,
      shippedAt: deliveryOrder.shippedAt,
      notes: deliveryOrder.notes,

      deliveredBy: deliveryOrder.deliveredBy,
      receivedBy: deliveryOrder.receivedBy,
      signedAt: deliveryOrder.signedAt,

      items: deliveryOrder.items.map((item: any) => ({
        id: item.id,
        productName: item.productName,
        quantity: Number(item.quantity),
        unit: item.unit,
      })),
    };
  }

  async renderPdf(organizationId: string, id: string): Promise<Buffer> {
    const printView = await this.getPrintView(organizationId, id);

    const printToken = this.printTokenService.sign({
      documentType: 'delivery-order',
      documentId: id,
      organizationId,
    });
    const printUrl = `${process.env.FRONTEND_URL}/print/delivery-orders/${id}?token=${printToken}`;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.emulateMediaType('print');
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: 'light' },
      ]);
      await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 15000 });
      const pdfBuffer = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  verifyPrintToken(token: string, deliveryOrderId: string) {
    return this.printTokenService.verifyDocumentToken(
      token,
      'delivery-order',
      deliveryOrderId,
    );
  }

  // An invoice is fulfilled EITHER through a fulfillment session (pick-time
  // stock + COGS) OR through delivery orders created here (ship-time stock
  // + COGS), never both, and never twice through DIRECT_ISSUE either. The
  // fulfillmentPath claim below is the sole enforcement mechanism — it
  // replaces the earlier SELECT ... FOR UPDATE + Session-existence recheck,
  // which only protected against a concurrent second call to THIS method,
  // not against a concurrent SessionsService.create() or
  // InvoiceService.issue() doing the conflicting thing on another table.
  // A single atomic UPDATE against Invoice.fulfillmentPath is what makes
  // all three call sites contend for the same lock.
  //
  // Re-claimable when already DELIVERY_ORDER (not just null) — this method
  // is legitimately called more than once per invoice for partial
  // deliveries, so the claim's WHERE clause accepts either state.
  //
  // Snapshot unitCost off the InvoiceItem here too, same as create() does
  // off SalesOrderItem: ship() needs it to post COGS without a join back.
  async createFromInvoice(
    organizationId: string,
    userId: string,
    invoiceId: string,
    itemOverrides?: { invoiceItemId: string; quantity: number }[],
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        items: { include: { product: { select: { name: true } } } },
        customer: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (invoice.salesOrderId) {
      throw new BadRequestException(
        'This invoice originated from a sales order — create the delivery order from the sales order instead',
      );
    }
    if (invoice.status !== 'ISSUED') {
      throw new BadRequestException(
        'Only an issued invoice can be converted to a delivery order',
      );
    }

    // Cheap early check using the invoice already fetched — no extra
    // query, and fulfillmentPath is the source of truth rather than a
    // derived Session lookup. The authoritative check is the atomic claim
    // inside the transaction below; this just gives a fast, friendly
    // failure before doing any pricing work.
    if (invoice.fulfillmentPath === 'SESSION') {
      throw new BadRequestException(
        'Cannot fulfill invoice directly. This invoice is already assigned to a warehouse fulfillment session.',
      );
    }
    if (invoice.fulfillmentPath === 'DIRECT_ISSUE') {
      throw new BadRequestException(
        'Cannot fulfill invoice directly. This invoice was already fulfilled directly at issuance.',
      );
    }

    const overrideByItemId = new Map(
      (itemOverrides ?? []).map((o) => [o.invoiceItemId, o.quantity]),
    );

    const candidateLines = invoice.items
      .filter((item) => item.productId)
      .map((item) => {
        const outstanding =
          Number(item.quantity) -
          Number(item.fulfilledQuantity) -
          Number(item.reservedQuantity);
        const requested = overrideByItemId.has(String(item.id))
          ? overrideByItemId.get(String(item.id))!
          : outstanding;
        return { item, quantity: requested, outstanding };
      })
      .filter((l) => l.quantity > 0);

    for (const l of candidateLines) {
      if (l.quantity > l.outstanding) {
        throw new BadRequestException(
          `Cannot deliver ${l.quantity} of "${l.item.product?.name ?? l.item.description}" — only ${l.outstanding} unit(s) are outstanding (accounting for what's already fulfilled or reserved on another delivery order)`,
        );
      }
    }

    if (candidateLines.length === 0) {
      throw new BadRequestException(
        'This invoice has nothing outstanding to deliver',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Atomic claim — the actual lock. Matches null (first-ever claim)
        // OR DELIVERY_ORDER (this invoice's own path already, e.g. a
        // second partial delivery order). An update to 0 rows means
        // fulfillmentPath is SESSION or DIRECT_ISSUE.
        const claimed = await tx.invoice.updateMany({
          where: {
            id: invoice.id,
            organizationId,
            OR: [
              { fulfillmentPath: null },
              { fulfillmentPath: 'DELIVERY_ORDER' },
            ],
          },
          data: { fulfillmentPath: 'DELIVERY_ORDER' },
        });
        if (claimed.count === 0) {
          const current = await tx.invoice.findUniqueOrThrow({
            where: { id: invoice.id },
          });
          throw new BadRequestException(
            current.fulfillmentPath === 'SESSION'
              ? 'Cannot fulfill invoice directly. This invoice is already assigned to a warehouse fulfillment session.'
              : 'Cannot fulfill invoice directly. This invoice was already fulfilled directly at issuance.',
          );
        }

        const doNumber = await this.numbering.nextSequential(
          tx,
          organizationId,
          'DELIVERY_ORDER',
          'DO',
        );

        const deliveryOrder = await tx.deliveryOrder.create({
          data: {
            organizationId,
            invoiceId: invoice.id,
            salesOrderId: null,
            locationId: invoice.locationId,
            userId,
            doNumber,
            status: DeliveryOrderStatus.PACKED,
            customerId: invoice.customerId,
            customerName: invoice.customer?.name ?? invoice.customerName,
            customerAddress: invoice.customer?.address ?? null,
            customerPhone: invoice.customer?.phone ?? null,
            customerPoNumber: invoice.customerPoNumber,
            deliveryAddress: invoice.customer?.address ?? null,
            destinationLatitude: invoice.customer?.latitude ?? null,
            destinationLongitude: invoice.customer?.longitude ?? null,
            notes: null,
            items: {
              create: candidateLines.map(({ item, quantity }) => ({
                salesOrderItemId: null,
                invoiceItemId: item.id,
                productId: item.productId,
                productName:
                  item.product?.name ?? item.description ?? 'Service',
                quantity,
                unit: item.unit,
                locationId: item.locationId,
                unitCost: item.unitCost,
              })),
            },
          },
          include: { items: true },
        });

        for (const { item, quantity } of candidateLines) {
          await tx.invoiceItem.update({
            where: { id: item.id },
            data: { reservedQuantity: { increment: quantity } },
          });
        }

        return deliveryOrder;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(
          'A conflicting delivery order was created concurrently — please retry',
        );
      }
      throw err;
    }
  }
}
