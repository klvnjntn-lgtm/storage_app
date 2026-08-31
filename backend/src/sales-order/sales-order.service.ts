import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';
import { SalesQuotationService } from 'src/sales-quotation/sales-quotation.service';
import { PrintTokenService } from '../common/print/print-token.service';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import puppeteer from 'puppeteer';
import { CreateSalesOrderDto, UpdateSalesOrderDto } from './dto/sales-order.dto';

// eventType is a plain String column on SalesOrderActivityEvent (not a
// Prisma enum, unlike InvoiceActivityEventType / SalesQuotationActivityEventType)
// — keep these values as the single source of truth for what gets written,
// so callers/readers agree on the vocabulary without a schema migration.
export const SalesOrderActivityEventType = {
  CREATED: 'CREATED',
  EDITED: 'EDITED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
} as const;

// Mirrors quotationDetailInclude in SalesQuotationService — same shape of
// relations needed to render a printable document, applied to SalesOrder.
const orderDetailInclude = {
  items: { include: { product: true, taxes: true } },
  taxes: true,
  customer: true,
  location: { select: { name: true, address: true, phone: true } },
  organization: {
    select: {
      name: true,
      legalName: true,
      npwp: true,
      logoUrl: true,
      address: true,
      phone: true,
    },
  },
  quotation: { select: { id: true, quotationNumber: true, status: true } },
  deliveryOrders: { select: { id: true, doNumber: true, status: true } },
  invoices: { select: { id: true, invoiceNumber: true, status: true } },
} satisfies Prisma.SalesOrderInclude;

// Mirrors QuotationPrintView — `format` is stored on SalesOrder.format
// (set from dto.format on create/update) and read back here, same as
// SalesQuotation.
export type SalesOrderPrintView = {
  id: string;
  orderNumber: string | null;
  status: string;
  format: string;
  orderDate: Date | null;          // NEW
  customerPoNumber: string | null; // NEW

  businessName: string;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  businessAddress: string | null;
  businessPhone: string | null;

  discount: number;
  locationName: string;
  locationAddress: string | null;
  locationPhone: string | null;

  customerName: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  customerNpwp: string | null;

  subtotal: number;
  taxAmount: number;
  total: number;

  confirmedAt: Date | null;
  createdAt: Date;

  taxes: {
    name: string;
    percentage: number;
    amount: number;
  }[];

  items: {
    id: string;
    productName: string;
    sku: string | null;
    quantity: number;
    unit: string | null;
    itemTaxAmount: number;
    itemDiscount: number;
    itemTotal: number;
    unitPrice: number;
    lineTotal: number;
  }[];
};

@Injectable()
export class SalesOrderService {
  constructor(
    private prisma: PrismaService,
    private tenantOwnership: TenantOwnershipService,
    private numbering: DocumentNumberingService,
    private pricing: LineItemPricingService,
    private quotationService: SalesQuotationService,
    private printTokenService: PrintTokenService,
  ) {}

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  // ---- activity log ---------------------------------------------------
  // Same pattern as SalesQuotationService.logActivity — the table
  // (SalesOrderActivityEvent) already existed in the schema, it just had
  // no writer wired up yet.

  private async logActivity(
    tx: any,
    params: {
      salesOrderId: string;
      organizationId: string;
      userId: string;
      eventType: string;
      reason?: string;
      metadata?: Prisma.InputJsonValue; // NEW — was missing entirely; SalesOrderActivityEvent
                                        // has no metadata column today (unlike
                                        // SalesQuotationActivityEvent), see schema note below
    },
  ) {
    return tx.salesOrderActivityEvent.create({
      data: {
        salesOrderId: params.salesOrderId,
        organizationId: params.organizationId,
        userId: params.userId,
        eventType: params.eventType,
        reason: params.reason,
        metadata: params.metadata, // NEW
      },
    });
  }

  async getActivityHistory(organizationId: string, salesOrderId: string) {
    return this.prisma.salesOrderActivityEvent.findMany({
      where: { salesOrderId, organizationId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  async create(organizationId: string, userId: string, dto: CreateSalesOrderDto) {
    await this.tenantOwnership.validate(organizationId, dto);
    const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
      await this.pricing.priceLines(organizationId, dto.items);
    const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date(); // NEW

    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.salesOrder.create({
          data: {
            organizationId,
            userId,
            locationId: dto.locationId,
            customerId: dto.customerId,
            customerName: dto.customerName,
            format: dto.format,
            customerPoNumber: dto.customerPoNumber ?? null, // NEW
            orderDate, // NEW

            status: SalesOrderStatus.DRAFT,
            subtotal,
            discount: discountAmount, // NEW — SalesOrder.discount was never written before
            taxAmount,
            total: this.round2(subtotal - discountAmount + taxAmount),
            items: {
              create: lines.map((l) => ({
                productId: l.productId,
                description: l.description,
                locationId: l.locationId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                unit: l.unit, // NEW
                unitCost: l.unitCost,
                lineTotal: l.lineTotal,
                discountType: l.discountType,
                discountValue: l.discountValue,
                discountAmount: l.discountAmount,
                netAmount: l.netAmount,
                taxAmount: l.taxAmount,
                total: l.total,
                taxes: { create: l.taxes },
              })),
            },
            taxes: { create: taxLines },
          },
          include: { items: true, taxes: true, customer: true },
        });

await this.logActivity(tx, {
  salesOrderId: order.id,
  organizationId,
  userId,
  eventType: SalesOrderActivityEventType.EDITED,
  metadata: {
    fields: {
      locationId: dto.locationId,
      customerId: dto.customerId,
      customerName: dto.customerName,
      format: dto.format ?? order.format,
      customerPoNumber: dto.customerPoNumber,   // NEW
      orderDate: dto.orderDate,                  // NEW
    },
  } as Prisma.InputJsonValue,
});

        return order;
      });
    } catch (err) {
      // FIX: handleFkViolation only throws on FK-constraint errors. If it
      // returns normally for anything else (validation errors, unexpected
      // P2002s, connection blips), this function must not silently resolve
      // to `undefined` — always rethrow so callers see a real error.
      this.tenantOwnership.handleFkViolation(err);
      throw err;
    }
  }

  // Copies a SENT/ACCEPTED quotation's lines into a new DRAFT order, then
  // flips the quotation to CONVERTED. Re-prices rather than copying
  // amounts verbatim — product prices/tax rates may have moved between
  // quotation and conversion, and a sales order should reflect current
  // pricing, not a stale snapshot.
  async createFromQuotation(organizationId: string, userId: string, quotationId: string) {
    const quotation = await this.prisma.salesQuotation.findFirst({
      where: { id: quotationId, organizationId },
      include: { items: true },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status !== 'SENT' && quotation.status !== 'ACCEPTED') {
      throw new BadRequestException('Only a sent or accepted quotation can be converted to an order');
    }
    // NOTE: no separate "does an active SalesOrder already exist" check
    // here, unlike Invoice's guard — status gating already covers it
    // correctly. Once converted, status becomes CONVERTED (blocking this
    // check on its own), and cancel()'s reopenIfConverted() flips it back
    // to ACCEPTED specifically to allow a legitimate re-conversion after a
    // cancelled order. Adding a raw "any salesOrders exist" check would
    // break that flow, since a cancelled order would still count.

    const items = quotation.items.map((i) => ({
      productId: i.productId ?? undefined,
      description: i.description ?? undefined,
      locationId: i.locationId ?? undefined,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      unit: i.unit ?? undefined,
      discountType: i.discountType ?? undefined,
      discountValue: i.discountValue != null ? Number(i.discountValue) : undefined,
      taxRateIds: [] as string[],
    }));

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
          await this.pricing.priceLines(organizationId, items, tx);

        const order = await tx.salesOrder.create({
          data: {
            organizationId,
            userId,
            locationId: quotation.locationId,
            customerId: quotation.customerId,
            customerPoNumber: quotation.customerPoNumber ?? null, // NEW
            orderDate: new Date(), // NEW

            customerName: quotation.customerName,
            quotationId: quotation.id,
            status: SalesOrderStatus.DRAFT,
            subtotal,
            discount: discountAmount,
            taxAmount,
            total: this.round2(subtotal - discountAmount + taxAmount),
            items: {
              create: lines.map((l) => ({
                productId: l.productId,
                description: l.description,
                locationId: l.locationId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                unit: l.unit,
                unitCost: l.unitCost,
                lineTotal: l.lineTotal,
                discountType: l.discountType,
                discountValue: l.discountValue,
                discountAmount: l.discountAmount,
                netAmount: l.netAmount,
                taxAmount: l.taxAmount,
                total: l.total,
                taxes: { create: l.taxes },
              })),
            },
            taxes: { create: taxLines },
          },
          include: { items: true, taxes: true, customer: true },
        });

        await this.quotationService.markConvertedToSalesOrder(
          organizationId, quotation.id, userId, order.id, tx,
        );

        await this.logActivity(tx, {
          salesOrderId: order.id,
          organizationId,
          userId,
          eventType: SalesOrderActivityEventType.CREATED,
          reason: `Converted from quotation ${quotation.quotationNumber ?? quotation.id}`,
        });

        return order;
      });
    } catch (err) {
      // Same race-window backstop as InvoiceService.createDraftFromQuotation.
      // Two concurrent requests can both read status === 'ACCEPTED' before
      // either transaction's markConvertedToSalesOrder() commits.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('This quotation has already been converted to a sales order');
      }
      throw err;
    }
  }

  private buildEditDiff(
    oldItems: {
      productId: string | null;
      description: string | null;
      quantity: Decimal;
      unitPrice: Decimal;
      discountAmount: Decimal;
    }[],
    newItems: {
      productId: string | null;
      description: string | null;
      quantity: number;
      unitPrice: number;
      discountAmount: number;
    }[],
  ): { key: string; before: string; after: string }[] {
    const keyOf = (i: { productId: string | null; description: string | null }) =>
      i.productId ? `p:${i.productId}` : `s:${i.description}`;

    const describe = (i: { quantity: number; unitPrice: any; discountAmount: any }) => {
      const discount = Number(i.discountAmount ?? 0);
      const base = `× ${i.quantity} @ ${Number(i.unitPrice)}`;
      return discount > 0 ? `${base} (disc ${discount})` : base;
    };

    const oldByKey = new Map(oldItems.map((i) => [keyOf(i), i]));
    const newByKey = new Map(newItems.map((i) => [keyOf(i), i]));
    const changes: { key: string; before: string; after: string }[] = [];

    for (const key of new Set([...oldByKey.keys(), ...newByKey.keys()])) {
      const before = oldByKey.get(key);
      const after = newByKey.get(key);

      if (!before) {
        changes.push({
          key,
          before: '—',
          after: `added ${describe({ quantity: after!.quantity, unitPrice: after!.unitPrice, discountAmount: after!.discountAmount })}`,
        });
      } else if (!after) {
        changes.push({
          key,
          before: describe({ quantity: Number(before.quantity), unitPrice: before.unitPrice, discountAmount: before.discountAmount }),
          after: 'removed',
        });
      } else if (
        Number(before.quantity) !== after.quantity ||
        Number(before.unitPrice) !== after.unitPrice ||
        Number(before.discountAmount ?? 0) !== Number(after.discountAmount ?? 0)
      ) {
        changes.push({
          key,
          before: describe({ quantity: Number(before.quantity), unitPrice: before.unitPrice, discountAmount: before.discountAmount }),
          after: describe({ quantity: after.quantity, unitPrice: after.unitPrice, discountAmount: after.discountAmount }),
        });
      }
    }
    return changes;
  }

  async update(organizationId: string, id: string, userId: string, dto: UpdateSalesOrderDto) {
    const order = await this.getDraftOrThrow(organizationId, id);
    await this.tenantOwnership.validate(organizationId, dto);

    if (!dto.items) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const updated = await tx.salesOrder.update({
            where: { id: order.id },
            data: {
              locationId: dto.locationId,
              customerId: dto.customerId,
              customerName: dto.customerName,
              customerPoNumber: dto.customerPoNumber !== undefined ? dto.customerPoNumber : order.customerPoNumber, // NEW
              orderDate: dto.orderDate !== undefined
                ? (dto.orderDate ? new Date(dto.orderDate) : null)
                : order.orderDate, // NEW
              format: dto.format ?? order.format,
            },
            include: { items: true, taxes: true, customer: true },
          });

          // Was a bare EDITED with no detail. Mirrors Quotation's
          // no-items branch: logs which header fields were sent.
          await this.logActivity(tx, {
            salesOrderId: order.id,
            organizationId,
            userId,
            eventType: SalesOrderActivityEventType.EDITED,
            metadata: {
              fields: {
                locationId: dto.locationId,
                customerId: dto.customerId,
                customerName: dto.customerName,
                format: dto.format ?? order.format,
                      customerPoNumber: dto.customerPoNumber, // NEW
      orderDate: dto.orderDate,               // NEW

              },
            } as Prisma.InputJsonValue,
          });

          return updated;
        });
      } catch (err) {
        // FIX: same silent-swallow issue as create() — always rethrow.
        this.tenantOwnership.handleFkViolation(err);
        throw err;
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
          await this.pricing.priceLines(organizationId, dto.items!, tx);

        const existingItemIds = (
          await tx.salesOrderItem.findMany({ where: { salesOrderId: order.id }, select: { id: true } })
        ).map((i) => i.id);
        if (existingItemIds.length) {
          await tx.salesOrderItemTax.deleteMany({ where: { salesOrderItemId: { in: existingItemIds } } });
        }
        await tx.salesOrderItem.deleteMany({ where: { salesOrderId: order.id } });
        await tx.salesOrderTax.deleteMany({ where: { salesOrderId: order.id } });

        const updated = await tx.salesOrder.update({
          where: { id: order.id },
          data: {
            locationId: dto.locationId ?? order.locationId,
            customerId: dto.customerId ?? order.customerId,
            customerName: dto.customerName ?? order.customerName,
            customerPoNumber: dto.customerPoNumber !== undefined ? dto.customerPoNumber : order.customerPoNumber, // NEW
            orderDate: dto.orderDate !== undefined
              ? (dto.orderDate ? new Date(dto.orderDate) : null)
              : order.orderDate, // NEW
            subtotal,
            discount: discountAmount,
            taxAmount,
            total: this.round2(subtotal - discountAmount + taxAmount),
            items: {
              create: lines.map((l) => ({
                productId: l.productId,
                description: l.description,
                locationId: l.locationId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                unit: l.unit,
                unitCost: l.unitCost,
                lineTotal: l.lineTotal,
                discountType: l.discountType,
                discountValue: l.discountValue,
                discountAmount: l.discountAmount,
                netAmount: l.netAmount,
                taxAmount: l.taxAmount,
                total: l.total,
                taxes: { create: l.taxes },
              })),
            },
            taxes: { create: taxLines },
          },
          include: { items: true, taxes: true, customer: true },
        });

        // Real diff, was previously omitted entirely.
const diff = this.buildEditDiff(order.items, lines);

await this.logActivity(tx, {
  salesOrderId: order.id,
  organizationId,
  userId,
  eventType: SalesOrderActivityEventType.EDITED,
  metadata: {
    changes: diff,
    fields: {                          // NEW block
      customerPoNumber: dto.customerPoNumber,
      orderDate: dto.orderDate,
    },
  } as Prisma.InputJsonValue,
});

        return updated;
      });
    } catch (err) {
      // FIX: same silent-swallow issue as create() — always rethrow.
      this.tenantOwnership.handleFkViolation(err);
      throw err;
    }
  }

  // Mirrors InvoiceService.issue: assigns the order number and decreases
  // stock here, unless WAREHOUSE_OPS is enabled, in which case fulfillment
  // (and the stock movement) happens through a Session instead.
async confirm(organizationId: string, id: string, userId: string) {
  const order = await this.getDraftOrThrow(organizationId, id);
  if (order.items.length === 0) {
    throw new BadRequestException('Cannot confirm an empty order');
  }

  // No stock movement here. Confirming a sales order is a commercial
  // commitment — proof of intent to fulfill — not proof that goods
  // physically left inventory. The actual departure event is
  // DeliveryOrder.ship() (WAREHOUSE_OPS) or Invoice.issue() (otherwise).
  // An order that's confirmed but never delivered/invoiced does not
  // decrement stock; that's intentional under this model, not a gap.

  try {
    return await this.prisma.$transaction(async (tx) => {
      // Atomic status guard — first statement in the transaction. If a
      // concurrent confirm() call already won this race, this affects
      // zero rows and we throw before doing any further work, so an
      // order can never be confirmed twice.
      const claim = await tx.salesOrder.updateMany({
        where: { id: order.id, organizationId, status: SalesOrderStatus.DRAFT },
        data: { status: SalesOrderStatus.CONFIRMED, confirmedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new BadRequestException('Order is no longer a draft — it may have already been confirmed');
      }

      const year = new Date().getFullYear();
      const count = await tx.salesOrder.count({
        where: { organizationId, orderNumber: { not: null }, confirmedAt: { gte: new Date(`${year}-01-01`) } },
      });
      const orderNumber = await this.numbering.next({ prefix: 'SO', count, year });

      const updated = await tx.salesOrder.update({
        where: { id: order.id },
        data: { orderNumber },
        include: { items: true, taxes: true, customer: true },
      });

      await this.logActivity(tx, {
        salesOrderId: order.id,
        organizationId,
        userId,
        eventType: SalesOrderActivityEventType.CONFIRMED,
      });

      return updated;
    });
  } catch (err) {
    // Numbering race — two concurrent confirm() calls can read the same
    // `count` before either commits. Translate the resulting P2002 into
    // a friendly, retryable error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadRequestException(
        'Order number assignment conflicted with a concurrent confirmation — please retry',
      );
    }
    throw err;
  }
}
  // Reason is now required, same as InvoiceService.voidInvoice and
  // SalesQuotationService.cancel — "who cancelled this and why" should
  // always be answerable from the activity log, not left to memory.
  async cancel(organizationId: string, id: string, userId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to cancel an order');
    }

    const order = await this.prisma.salesOrder.findFirst({ where: { id, organizationId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new BadRequestException('Only a draft order can be cancelled directly');
    }

    return this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.salesOrder.update({ where: { id }, data: { status: SalesOrderStatus.CANCELLED } });

      if (order.quotationId) {
        await this.quotationService.reopenIfConverted(
          organizationId,
          order.quotationId,
          userId,
          reason.trim(),
          tx,
        );
      }

      await this.logActivity(tx, {
        salesOrderId: order.id,
        organizationId,
        userId,
        eventType: SalesOrderActivityEventType.CANCELLED,
        reason: reason.trim(),
      });

      return cancelled;
    });
  }

  async list(organizationId: string, filters: { status?: SalesOrderStatus; page?: number; pageSize?: number }) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 20;
    const where = { organizationId, status: filters.status };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.salesOrder.findMany({
        where, include: { items: true, customer: true },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async getOne(organizationId: string, id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, organizationId },
      include: {
        items: { include: { product: true, taxes: true } },
        taxes: true,
        customer: true,
        quotation: { select: { id: true, quotationNumber: true, status: true } },
        deliveryOrders: { select: { id: true, doNumber: true, status: true } },
        invoices: { select: { id: true, invoiceNumber: true, status: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private async getDraftOrThrow(organizationId: string, id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new BadRequestException('Order is no longer editable');
    }
    return order;
  }

  // Recomputes SalesOrder.status from summed deliveredQuantity vs quantity
  // across its items — the derived-status rule the schema comment on
  // SalesOrderItem.deliveredQuantity calls for. Called from inside the same
  // transaction that creates/cancels a DeliveryOrder; never call this
  // standalone outside that transaction, or the two can drift.
  async recomputeDeliveryStatus(organizationId: string, salesOrderId: string, tx: PrismaService | any = this.prisma) {
    const order = await tx.salesOrder.findFirst({ where: { id: salesOrderId, organizationId }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === SalesOrderStatus.CANCELLED) return order;

    const allFullyDelivered = order.items.every((i: any) => Number(i.deliveredQuantity) >= Number(i.quantity));
    const anyDelivered = order.items.some((i: any) => Number(i.deliveredQuantity) > 0);
    const newStatus = allFullyDelivered
      ? SalesOrderStatus.FULLY_DELIVERED
      : anyDelivered
      ? SalesOrderStatus.PARTIALLY_DELIVERED
      : SalesOrderStatus.CONFIRMED;

    if (newStatus === order.status) return order;
    return tx.salesOrder.update({ where: { id: salesOrderId }, data: { status: newStatus } });
  }

  // ---- print / PDF ---------------------------------------------------------
  // Same shape as SalesQuotationService's print pipeline: a tenant-scoped
  // read-model (getPrintView), a mapper into that flat view, and a
  // puppeteer render that goes through a signed, document-scoped print
  // token rather than trusting the :id in the URL alone.

  async getPrintView(organizationId: string, id: string): Promise<SalesOrderPrintView> {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, organizationId },
      include: orderDetailInclude,
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.mapOrderForPrint(order);
  }

  private mapOrderForPrint(
    order: Prisma.SalesOrderGetPayload<{ include: typeof orderDetailInclude }>,
  ): SalesOrderPrintView {
    const toNumber = (d: Decimal) => Number(d);

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      format: order.format,

      businessName: order.organization.name,
      businessLegalName: order.organization.legalName,
      businessNpwp: order.organization.npwp,
      businessLogoUrl: order.organization.logoUrl,
      businessAddress: order.organization.address,
      businessPhone: order.organization.phone,
      orderDate: order.orderDate,                    // NEW
      customerPoNumber: order.customerPoNumber,       // NEW

      locationName: order.location?.name ?? '',
      locationAddress: order.location?.address ?? null,
      locationPhone: order.location?.phone ?? null,

      customerName: order.customer?.name ?? order.customerName,
      customerAddress: order.customer?.address ?? null,
      customerPhone: order.customer?.phone ?? null,
      customerNpwp: order.customer?.npwp ?? null,

      subtotal: toNumber(order.subtotal),
      discount: toNumber(order.discount), // NEW
      taxAmount: toNumber(order.taxAmount),
      total: toNumber(order.total),

      confirmedAt: order.confirmedAt,
      createdAt: order.createdAt,

      taxes: order.taxes.map((tax) => ({
        name: tax.name,
        percentage: toNumber(tax.percentage),
        amount: toNumber(tax.amount),
      })),

      items: order.items.map((item) => ({
        id: String(item.id),
        productName: item.product?.name ?? item.description ?? '',
        sku: item.product?.sku ?? null,
        quantity: toNumber(item.quantity),
        unit: item.unit, // NEW
        itemTaxAmount: toNumber(item.taxAmount),
        unitPrice: toNumber(item.unitPrice),
        itemDiscount: toNumber(item.discountAmount), // NEW
        itemTotal: toNumber(item.netAmount), // NEW
        lineTotal: toNumber(item.lineTotal),
      })),
    };
  }

  async renderPdf(
    organizationId: string,
    id: string,
    formatOverride?: string,
  ): Promise<Buffer> {
    try {
      // confirms tenant ownership before a token is ever minted
      const printView = await this.getPrintView(organizationId, id);
      const format = formatOverride ?? printView.format;

      const printToken = this.printTokenService.sign({
        documentType: 'sales-order',
        documentId: id,
        organizationId,
      });
      const printUrl =
        `${process.env.FRONTEND_URL}/print/sales-orders/${id}?format=${format}&token=${printToken}`;

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
    } catch (e) {
      console.error('Sales order PDF render failed:', e);
      throw e;
    }
  }

  verifyPrintToken(token: string, salesOrderId: string) {
    return this.printTokenService.verifyDocumentToken(token, 'sales-order', salesOrderId);
  }
}