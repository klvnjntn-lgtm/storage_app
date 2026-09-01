import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { StockService } from '../stock/stock.service';
import { PrintTokenService } from '../common/print/print-token.service';
import { DeliveryOrderStatus, SalesOrderStatus, EventType, Prisma } from '@prisma/client';
import { CreateDeliveryOrderDto } from './dto/delivery-order.dto';

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
    private stockService: StockService,
    private printTokenService: PrintTokenService,
  ) {}

  // Creating a delivery order is a planned/prepared delivery — a
  // commitment against the sales order's remaining quantities, not a
  // physical movement. No stock is touched here. The actual departure
  // event is ship(), below.
  async create(organizationId: string, userId: string, dto: CreateDeliveryOrderDto) {
    await this.tenantOwnership.validate(organizationId, { locationId: dto.locationId });

    if (!dto.items?.length) {
      throw new BadRequestException('Delivery order must have at least one item');
    }

    return this.prisma.$transaction(async (tx) => {
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
        throw new BadRequestException(`Cannot deliver against a sales order in ${salesOrder.status} status`);
      }

      const itemsById = new Map(salesOrder.items.map((i) => [i.id, i]));
      for (const line of dto.items) {
        const soItem = itemsById.get(line.salesOrderItemId);
        if (!soItem) throw new BadRequestException(`Sales order item ${line.salesOrderItemId} not found on this order`);
        if (line.quantity <= 0) throw new BadRequestException('Delivery quantity must be positive');
        const remaining = Number(soItem.quantity) - Number(soItem.deliveredQuantity);
        if (line.quantity > remaining) {
          throw new BadRequestException(`Cannot deliver ${line.quantity} — only ${remaining} remaining on this line`);
        }
      }

      const productIds = dto.items
        .map((l) => itemsById.get(l.salesOrderItemId)!.productId)
        .filter((id): id is string => !!id);
      const products = productIds.length
        ? await tx.product.findMany({ where: { id: { in: productIds }, organizationId }, select: { id: true, name: true } })
        : [];
      const productNameById = new Map(products.map((p) => [p.id, p.name]));

      const year = new Date().getFullYear();
      const count = await tx.deliveryOrder.count({
        where: { organizationId, doNumber: { not: null }, createdAt: { gte: new Date(`${year}-01-01`) } },
      });
      const doNumber = await this.numbering.next({ prefix: 'DO', count, year });

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
          deliveryAddress: dto.deliveryAddress ?? salesOrder.customer?.address ?? null,
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
              };
            }),
          },
        },
        include: { items: true },
      });

      for (const line of dto.items) {
        await tx.salesOrderItem.update({
          where: { id: line.salesOrderItemId },
          data: { deliveredQuantity: { increment: line.quantity } },
        });
      }

      await this.salesOrderService.recomputeDeliveryStatus(organizationId, salesOrder.id, tx);

      return deliveryOrder;
    });
  }

  // The physical departure event. This is the ONLY place stock is
  // decremented for a delivery order's fulfillment — neither
  // SalesOrder.confirm() nor DeliveryOrder.create() touch stock (see
  // sales-order.service.ts for why: confirm is a commercial commitment,
  // create is a planned delivery, not proof anything left the building).
  //
  // Whether stock actually needs decrementing here is a per-delivery-order
  // fact, not an org-wide setting: a delivery order created from a
  // warehouse pack session (sessionId set) already had its stock moved at
  // pick time — decrementing again here would double it. A delivery order
  // created directly off a sales order with no session behind it has NOT
  // had stock touched yet, and needs it decremented here regardless of
  // whether the organization also uses warehouse pick/pack sessions for
  // other orders.
  //
  // Idempotency: the status flip to SHIPPED is done as an atomic
  // updateMany guarded on status === PACKED, as the FIRST statement
  // inside the transaction, before any stock is touched. If a concurrent
  // ship() call on the same delivery order already won that race, this
  // affects zero rows and the whole transaction throws before decrementing
  // anything — so stock can never be decremented twice for one shipment,
  // regardless of how many concurrent requests hit this at once.
  async ship(organizationId: string, id: string, userId: string) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (deliveryOrder.status !== DeliveryOrderStatus.PACKED) {
      throw new BadRequestException('Only a packed delivery order can be shipped');
    }

    const salesOrderId = deliveryOrder.salesOrderId; // narrowed once, reused below
    const shouldDecreaseStock = !deliveryOrder.sessionId && !!salesOrderId;

    if (shouldDecreaseStock) {
      const missingLocation = deliveryOrder.items.find((item) => item.productId && !item.locationId);
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
        throw new BadRequestException('This delivery order has already been shipped or is no longer packed');
      }

      if (shouldDecreaseStock && salesOrderId) {
        for (const item of deliveryOrder.items) {
          if (!item.productId || !item.locationId) continue;
          await this.stockService.decrease(
            organizationId, item.productId, item.locationId, Number(item.quantity), userId,
            { type: EventType.SALE, salesOrderId, metadata: { deliveryOrderId: deliveryOrder.id } },
            tx,
          );
        }
      }

      return tx.deliveryOrder.findUniqueOrThrow({ where: { id } });
    });
  }

  async recordProofOfDelivery(
    organizationId: string,
    id: string,
    params: { deliveredBy?: string; receivedBy?: string; signedAt?: Date },
  ) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({ where: { id, organizationId } });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (deliveryOrder.status !== DeliveryOrderStatus.SHIPPED) {
      throw new BadRequestException('Proof of delivery can only be recorded once the delivery order has shipped');
    }

    return this.prisma.deliveryOrder.update({
      where: { id },
      data: {
        deliveredBy: params.deliveredBy ?? deliveryOrder.deliveredBy,
        receivedBy: params.receivedBy ?? deliveryOrder.receivedBy,
        signedAt: params.signedAt ?? deliveryOrder.signedAt ?? new Date(),
      },
    });
  }

  // Only valid PACKED → CANCELLED. Nothing has physically left the
  // warehouse at PACKED (stock now only moves at ship()), so there is no
  // stock movement to reverse here — just release the reserved quantity
  // back onto the sales order line. A shipped delivery order that needs
  // reversing goes through recordReturn() instead, which is a distinct
  // event (a customer return), not an undo of a mistake.
  async cancel(organizationId: string, id: string, userId: string) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (deliveryOrder.status !== DeliveryOrderStatus.PACKED) {
      throw new BadRequestException('Only a packed (not yet shipped) delivery order can be cancelled');
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of deliveryOrder.items) {
        if (!item.salesOrderItemId) continue; // invoice-sourced item, no SO line to release
        await tx.salesOrderItem.update({
          where: { id: item.salesOrderItemId },
          data: { deliveredQuantity: { decrement: item.quantity } },
        });
      }
      const cancelled = await tx.deliveryOrder.update({ where: { id }, data: { status: DeliveryOrderStatus.CANCELLED } });
      if (deliveryOrder.salesOrderId) {
        await this.salesOrderService.recomputeDeliveryStatus(organizationId, deliveryOrder.salesOrderId, tx);
      }
      return cancelled;
    });
  }

  // A post-ship reversal — a customer return, not an undo of a mistake.
  // Supports partial returns: a customer may return only some of what
  // shipped, and this can be called more than once on the same delivery
  // order as further items trickle back (validated against what's still
  // outstanding — quantity minus returnedQuantity so far — not the
  // original shipped quantity each time).
  async recordReturn(
    organizationId: string,
    id: string,
    userId: string,
    items: { deliveryOrderItemId: string; quantity: number }[],
    reason?: string,
  ) {
    if (!items?.length) {
      throw new BadRequestException('At least one item is required to record a return');
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
      throw new BadRequestException('Only a shipped delivery order can have items returned');
    }

    const itemsById = new Map(deliveryOrder.items.map((i) => [i.id, i]));
    for (const line of items) {
      const doItem = itemsById.get(line.deliveryOrderItemId);
      if (!doItem) {
        throw new BadRequestException(`Delivery order item ${line.deliveryOrderItemId} not found on this delivery`);
      }
      if (line.quantity <= 0) throw new BadRequestException('Return quantity must be positive');
      const outstanding = Number(doItem.quantity) - Number(doItem.returnedQuantity);
      if (line.quantity > outstanding) {
        throw new BadRequestException(
          `Cannot return ${line.quantity} — only ${outstanding} of this line hasn't already been returned`,
        );
      }
    }

    const salesOrderId = deliveryOrder.salesOrderId;
    const invoiceId = deliveryOrder.invoiceId;
    if (!salesOrderId && !invoiceId) {
      // Should be unreachable — every DO is created with exactly one of
      // these — but fail loudly rather than silently mis-tagging the event.
      throw new BadRequestException('This delivery order has no originating sales order or invoice');
    }

    return this.prisma.$transaction(async (tx) => {
      for (const line of items) {
        const doItem = itemsById.get(line.deliveryOrderItemId)!;

        await tx.deliveryOrderItem.update({
          where: { id: doItem.id },
          data: { returnedQuantity: { increment: line.quantity } },
        });

        if (doItem.salesOrderItemId) {
          await tx.salesOrderItem.update({
            where: { id: doItem.salesOrderItemId },
            data: { deliveredQuantity: { decrement: line.quantity } },
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
              ? { type: EventType.RETURNS, salesOrderId, metadata: { deliveryOrderId: deliveryOrder.id, reason: reason ?? null } }
              : { type: EventType.RETURNS, invoiceId: invoiceId!, metadata: { deliveryOrderId: deliveryOrder.id, reason: reason ?? null } },
            tx,
          );
        }
      }

      const updated = await this.recomputeReturnStatus(organizationId, id, tx);
      if (salesOrderId) {
        await this.salesOrderService.recomputeDeliveryStatus(organizationId, salesOrderId, tx);
      }
      return updated;
    });
  }

  // Recomputes DeliveryOrder.status from summed returnedQuantity vs
  // quantity across its items — same derived-status pattern as
  // SalesOrderService.recomputeDeliveryStatus. Only ever transitions
  // between SHIPPED / PARTIALLY_RETURNED / RETURNED; PACKED and
  // CANCELLED are left untouched if somehow passed in (shouldn't happen,
  // since recordReturn() already gates on SHIPPED/PARTIALLY_RETURNED).
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
    const anyReturned = deliveryOrder.items.some((i) => Number(i.returnedQuantity) > 0);
    const newStatus = allReturned
      ? DeliveryOrderStatus.RETURNED
      : anyReturned
      ? DeliveryOrderStatus.PARTIALLY_RETURNED
      : DeliveryOrderStatus.SHIPPED;

    if (newStatus === deliveryOrder.status) return deliveryOrder;
    return tx.deliveryOrder.update({ where: { id: deliveryOrderId }, data: { status: newStatus } });
  }

  async list(organizationId: string, filters: { salesOrderId?: string; status?: DeliveryOrderStatus; page?: number; pageSize?: number }) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 20;

    const where: Prisma.DeliveryOrderWhereInput = {
      organizationId,
      ...(filters.salesOrderId ? { salesOrderId: filters.salesOrderId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.deliveryOrder.findMany({
        where, include: { items: true, salesOrder: { select: { orderNumber: true, customerName: true } } },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
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

  async getPrintView(organizationId: string, id: string): Promise<DeliveryOrderPrintView> {
    const deliveryOrder = await this.getPrintViewOrThrow(organizationId, id);
    return this.mapForPrint(deliveryOrder);
  }

  private async getPrintViewOrThrow(organizationId: string, id: string) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      include: {
        organization: { select: { name: true, legalName: true, address: true, phone: true, logoUrl: true } },
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
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 15000 });
      const pdfBuffer = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  verifyPrintToken(token: string, deliveryOrderId: string) {
    return this.printTokenService.verifyDocumentToken(token, 'delivery-order', deliveryOrderId);
  }

  async createFromInvoice(organizationId: string, userId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        items: { include: { product: { select: { name: true } } } },
        customer: true,
        deliveryOrders: { select: { id: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (invoice.salesOrderId) {
      throw new BadRequestException(
        'This invoice originated from a sales order — create the delivery order from the sales order instead',
      );
    }
    if (invoice.status !== 'ISSUED') {
      throw new BadRequestException('Only an issued invoice can be converted to a delivery order');
    }
    if (invoice.deliveryOrders.length > 0) {
      throw new BadRequestException('This invoice has already been converted to a delivery order');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const year = new Date().getFullYear();
        const count = await tx.deliveryOrder.count({
          where: { organizationId, doNumber: { not: null }, createdAt: { gte: new Date(`${year}-01-01`) } },
        });
        const doNumber = await this.numbering.next({ prefix: 'DO', count, year });

        return tx.deliveryOrder.create({
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
            notes: null,
            items: {
              create: invoice.items.map((item) => ({
                salesOrderItemId: null,
                invoiceItemId: String(item.id), // InvoiceItem.id is a numeric autoincrement column
                productId: item.productId,
                productName: item.product?.name ?? item.description ?? 'Service',
                quantity: item.quantity,
                unit: item.unit,
                locationId: item.locationId,
              })),
            },
          },
          include: { items: true },
        });
      });
    } catch (err) {
      // Race backstop, same pattern as SalesOrderService.createFromQuotation
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('This invoice has already been converted to a delivery order');
      }
      throw err;
    }
  }
}