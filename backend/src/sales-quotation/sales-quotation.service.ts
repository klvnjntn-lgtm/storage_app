import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';
import { PrintTokenService } from '../common/print/print-token.service';
import { Prisma, SalesQuotationStatus, SalesQuotationActivityEventType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import puppeteer from 'puppeteer';
import { CreateSalesQuotationDto, UpdateSalesQuotationDto } from './dto/sales-quotation.dto';

const quotationDetailInclude = {
  items: { include: { product: true, taxes: true } },
  taxes: true,
  customer: true,
  location: { select: { name: true, address: true, phone: true } },
  organization: {
    select: {
      name: true,
      legalName: true,
      npwp: true,
      bankName: true,           // NEW
      bankAccountNumber: true,  // NEW
      bankAccountName: true,    // NEW

      logoUrl: true,
      address: true,
      phone: true,
    },
  },
  salesOrders: { select: { id: true, orderNumber: true, status: true } },
  invoices: { select: { id: true, invoiceNumber: true, status: true } },
} satisfies Prisma.SalesQuotationInclude;

// Statuses in which item/field edits are allowed. SENT is included per
// the SENT -> edit -> DRAFT -> send -> SENT rule: nothing sent to a
// customer stays mutable under the same SENT status.
const EDITABLE_STATUSES: SalesQuotationStatus[] = [
  SalesQuotationStatus.DRAFT,
  SalesQuotationStatus.SENT,
];

export type QuotationPrintView = {
  id: string;
  quotationNumber: string | null;
  status: string;
  format: string;
  businessName: string;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  businessAddress: string | null;
  businessPhone: string | null;

  discount: number;
  bankName: string | null;            // NEW
  bankAccountNumber: string | null;   // NEW
  bankAccountName: string | null;     // NEW

  quotationDate: Date | null;        // NEW
  termsAndConditions: string | null; // NEW — note: customerPoNumber deliberately NOT added here, spec says Quotation never prints it

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

  validUntil: Date | null;
  sentAt: Date | null;
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
    unitPrice: number;
    itemTaxAmount: number;
    lineTotal: number;
    itemTotal: number;
    unit: string | null;
    itemDiscount: number;
  }[];
};

@Injectable()
export class SalesQuotationService {
  constructor(
    private prisma: PrismaService,
    private tenantOwnership: TenantOwnershipService,
    private numbering: DocumentNumberingService,
    private pricing: LineItemPricingService,
    private printTokenService: PrintTokenService,
  ) {}

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  // ---- activity log ---------------------------------------------------

  private async logActivity(
    tx: any,
    params: {
      quotationId: string;
      quotationNumber: string | null;
      organizationId: string;
      userId: string;
      eventType: SalesQuotationActivityEventType;
      reason?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    return tx.salesQuotationActivityEvent.create({
      data: {
        quotationId: params.quotationId,
        quotationNumber: params.quotationNumber,
        organizationId: params.organizationId,
        userId: params.userId,
        eventType: params.eventType,
        reason: params.reason,
        metadata: params.metadata,
      },
    });
  }

  async getActivityHistory(organizationId: string, quotationId: string) {
    return this.prisma.salesQuotationActivityEvent.findMany({
      where: { quotationId, organizationId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  // ---- create -----------------------------------------------------------

  async create(organizationId: string, userId: string, dto: CreateSalesQuotationDto) {
    await this.tenantOwnership.validate(organizationId, dto);
    const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
      await this.pricing.priceLines(organizationId, dto.items);
    const quotationDate = dto.quotationDate ? new Date(dto.quotationDate) : new Date(); // NEW

    try {
      return await this.prisma.$transaction(async (tx) => {
        const quotation = await tx.salesQuotation.create({
          data: {
            organizationId,
            userId,
            locationId: dto.locationId,
            customerId: dto.customerId,
            customerName: dto.customerName,
            customerPoNumber: dto.customerPoNumber ?? null, // NEW
            quotationDate, // NEW
            termsAndConditions: dto.termsAndConditions ?? null, // NEW

            format: dto.format,
            validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
            status: SalesQuotationStatus.DRAFT,
            subtotal,
            // SalesQuotation.discount existed in the schema but was
            // never written; now derived as sum(item discountAmount).
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
                unit: l.unit, // NEW — was missing
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
          quotationId: quotation.id,
          quotationNumber: null,
          organizationId,
          userId,
          eventType: SalesQuotationActivityEventType.CREATED,
        });

        return quotation;
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

  // ---- update (DRAFT or SENT; SENT reverts to DRAFT) ---------------------

async update(organizationId: string, id: string, userId: string, dto: UpdateSalesQuotationDto) {
  const quotation = await this.getEditableOrThrow(organizationId, id);
  await this.tenantOwnership.validate(organizationId, dto);
    // Editing a SENT quotation silently reverts it to DRAFT — nothing the
    // customer received stays mutable under the same SENT status. The
    // caller must explicitly re-send to hand out a new version.
      if (
    dto.items !== undefined &&
    dto.items.length === 0 &&
    quotation.items.length > 0 &&
    !dto.clearItems
  ) {
    throw new BadRequestException(
      'Refusing to replace existing items with an empty list — pass clearItems: true if this is intentional',
    );
  }
    const wasSent = quotation.status === SalesQuotationStatus.SENT;

    if (!dto.items) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const updated = await tx.salesQuotation.update({
            where: { id: quotation.id },
            data: {
              locationId: dto.locationId ?? quotation.locationId,
              format: dto.format ?? quotation.format,
              customerId: dto.customerId ?? quotation.customerId,
              customerName: dto.customerName ?? quotation.customerName,
              customerPoNumber: dto.customerPoNumber !== undefined ? dto.customerPoNumber : quotation.customerPoNumber,
              quotationDate: dto.quotationDate !== undefined
                ? (dto.quotationDate ? new Date(dto.quotationDate) : null)
                : quotation.quotationDate,
              termsAndConditions: dto.termsAndConditions !== undefined ? dto.termsAndConditions : quotation.termsAndConditions,

              validUntil: dto.validUntil !== undefined
                ? (dto.validUntil ? new Date(dto.validUntil) : null)
                : undefined,
              status: wasSent ? SalesQuotationStatus.DRAFT : undefined,
              // NO subtotal/taxAmount/total/items/taxes here — nothing
              // priced in this branch, items are untouched.
            },
            include: { items: true, taxes: true, customer: true },
          });

          await this.logActivity(tx, {
            quotationId: quotation.id,
            quotationNumber: quotation.quotationNumber,
            organizationId,
            userId,
            eventType: SalesQuotationActivityEventType.EDITED,
            metadata: {
              revertedFromSent: wasSent,
              fields: {
                format: dto.format ?? quotation.format,   // kept once, dup removed
                locationId: dto.locationId,
                customerId: dto.customerId,
                customerName: dto.customerName,
                validUntil: dto.validUntil,
                    customerPoNumber: dto.customerPoNumber,        // NEW
    quotationDate: dto.quotationDate,               // NEW
    termsAndConditions: dto.termsAndConditions,     // NEW

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
          await tx.salesQuotationItem.findMany({ where: { salesQuotationId: quotation.id }, select: { id: true } })
        ).map((i) => i.id);
        if (existingItemIds.length) {
          await tx.salesQuotationItemTax.deleteMany({ where: { salesQuotationItemId: { in: existingItemIds } } });
        }
        await tx.salesQuotationItem.deleteMany({ where: { salesQuotationId: quotation.id } });
        await tx.salesQuotationTax.deleteMany({ where: { salesQuotationId: quotation.id } });

const updated = await tx.salesQuotation.update({
  where: { id: quotation.id },
  data: {
    locationId: dto.locationId ?? quotation.locationId,
    format: dto.format ?? quotation.format,
    customerId: dto.customerId ?? quotation.customerId,
    customerName: dto.customerName ?? quotation.customerName,
    customerPoNumber: dto.customerPoNumber !== undefined ? dto.customerPoNumber : quotation.customerPoNumber,
    quotationDate: dto.quotationDate !== undefined
      ? (dto.quotationDate ? new Date(dto.quotationDate) : null)
      : quotation.quotationDate,
    termsAndConditions: dto.termsAndConditions !== undefined ? dto.termsAndConditions : quotation.termsAndConditions,
    validUntil: dto.validUntil !== undefined
      ? (dto.validUntil ? new Date(dto.validUntil) : null)
      : undefined,
    status: wasSent ? SalesQuotationStatus.DRAFT : undefined,

    // ADDED — these were computed above and never written:
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
        const diff = this.buildEditDiff(quotation.items, lines);

await this.logActivity(tx, {
  quotationId: quotation.id,
  quotationNumber: quotation.quotationNumber,
  organizationId,
  userId,
  eventType: SalesQuotationActivityEventType.EDITED,
  metadata: {
    revertedFromSent: wasSent,
    changes: diff,
    fields: {                                          // NEW block
      customerPoNumber: dto.customerPoNumber,
      quotationDate: dto.quotationDate,
      termsAndConditions: dto.termsAndConditions,
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

  async send(organizationId: string, id: string, userId: string) {
    const quotation = await this.getEditableOrThrow(organizationId, id);
    if (quotation.status !== SalesQuotationStatus.DRAFT) {
      throw new BadRequestException('Only a draft quotation can be sent');
    }
    if (quotation.items.length === 0) {
      throw new BadRequestException('Cannot send an empty quotation');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const year = new Date().getFullYear();
        const count = await tx.salesQuotation.count({
          where: { organizationId, quotationNumber: { not: null }, sentAt: { gte: new Date(`${year}-01-01`) } },
        });
        const quotationNumber = await this.numbering.next({ prefix: 'SQ', count, year });

        const updated = await tx.salesQuotation.update({
          where: { id: quotation.id },
          data: { status: SalesQuotationStatus.SENT, quotationNumber, sentAt: new Date() },
          include: { items: true, taxes: true, customer: true },
        });

        await this.logActivity(tx, {
          quotationId: quotation.id,
          quotationNumber: updated.quotationNumber,
          organizationId,
          userId,
          eventType: SalesQuotationActivityEventType.SENT,
        });

        return updated;
      });
    } catch (err) {
      // FIX: quotation-number race — two concurrent send() calls can read
      // the same `count` before either commits. Translate the resulting
      // P2002 into a friendly, retryable error instead of an unhandled
      // Prisma exception (mirrors the same backstop used elsewhere for
      // quotation -> sales order conversion races).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(
          'Quotation number assignment conflicted with a concurrent send — please retry',
        );
      }
      throw err;
    }
  }

  async accept(organizationId: string, id: string, userId: string) {
    return this.transition(
      organizationId, id, userId,
      [SalesQuotationStatus.SENT], SalesQuotationStatus.ACCEPTED,
      SalesQuotationActivityEventType.ACCEPTED,
    );
  }

  async reject(organizationId: string, id: string, userId: string, reason?: string) {
    return this.transition(
      organizationId, id, userId,
      [SalesQuotationStatus.SENT], SalesQuotationStatus.REJECTED,
      SalesQuotationActivityEventType.REJECTED, reason,
    );
  }

  // Cancel is your company withdrawing the quote; reject is the customer's
  // call. Allowed from SENT or ACCEPTED — not DRAFT (that's discardDraft's
  // job) and not CONVERTED (locked once it became another document).
  async cancel(organizationId: string, id: string, userId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to cancel a quotation');
    }
    return this.transition(
      organizationId, id, userId,
      [SalesQuotationStatus.SENT, SalesQuotationStatus.ACCEPTED],
      SalesQuotationStatus.CANCELLED,
      SalesQuotationActivityEventType.CANCELLED, reason,
    );
  }

  private async transition(
    organizationId: string,
    id: string,
    userId: string,
    allowedFrom: SalesQuotationStatus[],
    to: SalesQuotationStatus,
    eventType: SalesQuotationActivityEventType,
    reason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const quotation = await tx.salesQuotation.findFirst({ where: { id, organizationId } });
      if (!quotation) throw new NotFoundException('Quotation not found');
      if (!allowedFrom.includes(quotation.status)) {
        throw new BadRequestException(`Cannot move quotation from ${quotation.status} to ${to}`);
      }

      const updated = await tx.salesQuotation.update({ where: { id }, data: { status: to } });

      await this.logActivity(tx, {
        quotationId: id,
        quotationNumber: quotation.quotationNumber,
        organizationId,
        userId,
        eventType,
        reason,
      });

      return updated;
    });
  }

  // ---- conversion ---------------------------------------------------------
  // Split by target type for type safety at the call site — no string-typed
  // "documentType" param that could be passed inconsistently with the id.

  async markConvertedToInvoice(
    organizationId: string,
    id: string,
    userId: string,
    invoiceId: string,
    tx: PrismaService | any = this.prisma,
  ) {
    return this.markConverted(
      organizationId, id, userId, tx,
      { convertedToType: 'INVOICE', convertedToId: invoiceId },
    );
  }

  // No SalesOrder model exists yet — this exists so future SO-conversion
  // code has a typed method to call rather than another signature change
  // later. Delete if SO conversion ends up working differently.
  async markConvertedToSalesOrder(
    organizationId: string,
    id: string,
    userId: string,
    salesOrderId: string,
    tx: PrismaService | any = this.prisma,
  ) {
    return this.markConverted(
      organizationId, id, userId, tx,
      { convertedToType: 'SALES_ORDER', convertedToId: salesOrderId },
    );
  }

  private async markConverted(
    organizationId: string,
    id: string,
    userId: string,
    tx: PrismaService | any,
    metadata: Prisma.InputJsonValue,
  ) {
    const quotation = await tx.salesQuotation.findFirst({ where: { id, organizationId } });
    if (!quotation) throw new NotFoundException('Quotation not found');

    const updated = await tx.salesQuotation.update({
      where: { id },
      data: { status: SalesQuotationStatus.CONVERTED },
    });

    await this.logActivity(tx, {
      quotationId: id,
      quotationNumber: quotation.quotationNumber,
      organizationId,
      userId,
      eventType: SalesQuotationActivityEventType.CONVERTED,
      metadata,
    });

    return updated;
  }

  // Called by InvoiceService when a linked invoice is voided or discarded,
  // to flip CONVERTED back to ACCEPTED. Logged as ACCEPTED with metadata
  // distinguishing it from a normal accept() — not a 9th event type.
  async reopenIfConverted(
    organizationId: string,
    id: string,
    userId: string,
    reason: string,
    tx: PrismaService | any = this.prisma,
  ) {
    const quotation = await tx.salesQuotation.findFirst({ where: { id, organizationId } });
    if (!quotation || quotation.status !== SalesQuotationStatus.CONVERTED) return;

    const updated = await tx.salesQuotation.update({
      where: { id },
      data: { status: SalesQuotationStatus.ACCEPTED },
    });

    await this.logActivity(tx, {
      quotationId: id,
      quotationNumber: quotation.quotationNumber,
      organizationId,
      userId,
      eventType: SalesQuotationActivityEventType.ACCEPTED,
      reason,
      metadata: { reopenedFromConverted: true } as Prisma.InputJsonValue,
    });

    return updated;
  }

  // ---- discard ------------------------------------------------------------

  async discardDraft(organizationId: string, id: string, userId: string) {
    const quotation = await this.prisma.salesQuotation.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status !== SalesQuotationStatus.DRAFT) {
      throw new BadRequestException('Only a draft quotation can be discarded');
    }

    return this.prisma.$transaction(async (tx) => {
      const itemIds = (
        await tx.salesQuotationItem.findMany({
          where: { salesQuotationId: quotation.id },
          select: { id: true },
        })
      ).map((i) => i.id);

      if (itemIds.length) {
        await tx.salesQuotationItemTax.deleteMany({
          where: { salesQuotationItemId: { in: itemIds } },
        });
      }
      await tx.salesQuotationItem.deleteMany({ where: { salesQuotationId: quotation.id } });
      await tx.salesQuotationTax.deleteMany({ where: { salesQuotationId: quotation.id } });

      // Log before delete. quotationId is SetNull on delete, and
      // quotationNumber is snapshotted, so this row survives the parent's
      // deletion — but it still needs to be created while the FK target
      // exists.
      await this.logActivity(tx, {
        quotationId: quotation.id,
        quotationNumber: quotation.quotationNumber,
        organizationId,
        userId,
        eventType: SalesQuotationActivityEventType.DISCARDED,
      });

      return tx.salesQuotation.delete({ where: { id: quotation.id } });
    });
  }

  // ---- read -----------------------------------------------------------

  async list(
    organizationId: string,
    filters: {
      status?: SalesQuotationStatus;
      from?: Date;
      to?: Date;
      dateField?: 'sent' | 'created';
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{ data: any[]; total: number; page: number; pageSize: number }> {
    const dateFilter = filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined;

    const dateCondition: Prisma.SalesQuotationWhereInput | undefined = dateFilter
      ? filters.dateField === 'sent'
        ? { sentAt: dateFilter }
        : { createdAt: dateFilter }
      : undefined;

    const searchTerm = filters.search?.trim();
    const searchCondition: Prisma.SalesQuotationWhereInput | undefined = searchTerm
      ? {
          OR: [
            { quotationNumber: { contains: searchTerm, mode: 'insensitive' } },
            { customerName: { contains: searchTerm, mode: 'insensitive' } },
            { customer: { name: { contains: searchTerm, mode: 'insensitive' } } },
          ],
        }
      : undefined;

    const where: Prisma.SalesQuotationWhereInput = {
      organizationId,
      status: filters.status,
      AND: [dateCondition, searchCondition].filter(
        (c): c is Prisma.SalesQuotationWhereInput => c !== undefined,
      ),
    };

    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 20;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.salesQuotation.findMany({
        where, include: { items: true, customer: true, location: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.salesQuotation.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async getOne(organizationId: string, id: string) {
    const quotation = await this.prisma.salesQuotation.findFirst({
      where: { id, organizationId },
      include: quotationDetailInclude,
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }

  private async getEditableOrThrow(organizationId: string, id: string) {
    const quotation = await this.prisma.salesQuotation.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (!EDITABLE_STATUSES.includes(quotation.status)) {
      throw new BadRequestException(`Quotation is no longer editable (status: ${quotation.status})`);
    }
    return quotation;
  }

  // ---- print / PDF ---------------------------------------------------------

  async getPrintView(organizationId: string, id: string): Promise<QuotationPrintView> {
    const quotation = await this.prisma.salesQuotation.findFirst({
      where: { id, organizationId },
      include: quotationDetailInclude,
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    return this.mapQuotationForPrint(quotation);
  }

  private mapQuotationForPrint(
    quotation: Prisma.SalesQuotationGetPayload<{ include: typeof quotationDetailInclude }>,
  ): QuotationPrintView {
    const toNumber = (d: Decimal) => Number(d);

    return {
      id: quotation.id,
      quotationNumber: quotation.quotationNumber,
      status: quotation.status,
      format: quotation.format,
      discount: toNumber(quotation.discount),
      quotationDate: quotation.quotationDate,               // NEW
      termsAndConditions: quotation.termsAndConditions,      // NEW
      bankName: quotation.organization.bankName,                   // NEW
      bankAccountNumber: quotation.organization.bankAccountNumber, // NEW
      bankAccountName: quotation.organization.bankAccountName,     // NEW

      businessName: quotation.organization.name,
      businessLegalName: quotation.organization.legalName,
      businessNpwp: quotation.organization.npwp,
      businessLogoUrl: quotation.organization.logoUrl,
      businessAddress: quotation.organization.address,
      businessPhone: quotation.organization.phone,

      locationName: quotation.location?.name ?? '',
      locationAddress: quotation.location?.address ?? null,
      locationPhone: quotation.location?.phone ?? null,

      customerName: quotation.customer?.name ?? quotation.customerName,
      customerAddress: quotation.customer?.address ?? null,
      customerPhone: quotation.customer?.phone ?? null,
      customerNpwp: quotation.customer?.npwp ?? null,

      subtotal: toNumber(quotation.subtotal),
      taxAmount: toNumber(quotation.taxAmount),
      total: toNumber(quotation.total),

      validUntil: quotation.validUntil,
      sentAt: quotation.sentAt,
      createdAt: quotation.createdAt,

      taxes: quotation.taxes.map((tax) => ({
        name: tax.name,
        percentage: toNumber(tax.percentage),
        amount: toNumber(tax.amount),
      })),

      items: quotation.items.map((item) => ({
        id: String(item.id),
        productName: item.product?.name ?? item.description ?? '',
        sku: item.product?.sku ?? null,
        unit: item.unit,
        itemDiscount: toNumber(item.discountAmount), // NEW
        itemTotal: toNumber(item.netAmount), // NEW — matches Invoice's convention: pre-tax, post-discount
        itemTaxAmount: toNumber(item.taxAmount), // NEW

        quantity: toNumber(item.quantity),
        unitPrice: toNumber(item.unitPrice),
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
        documentType: 'quotation',
        documentId: id,
        organizationId,
      });
      const printUrl =
        `${process.env.FRONTEND_URL}/print/quotations/${id}?format=${format}&token=${printToken}`;

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
      console.error('Quotation PDF render failed:', e);
      throw e;
    }
  }
  // unchanged: sign() usage in renderPdf() stays as-is

  verifyPrintToken(token: string, quotationId: string) {
    return this.printTokenService.verifyDocumentToken(token, 'quotation', quotationId);
  }
}