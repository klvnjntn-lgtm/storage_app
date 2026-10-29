import { createHash, randomBytes } from 'crypto';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';
import { PrintTokenService } from '../common/print/print-token.service';
import { BankAccountResolverService } from '../bank-accounts/bank-account-resolver.service';
import { ModuleKey, Prisma, SalesQuotationStatus, SalesQuotationActivityEventType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import puppeteer from 'puppeteer';
import { withPdfRenderSlot } from '../common/print/pdf-render-limiter';
import { CreateSalesQuotationDto, RespondToQuotationDto, UpdateSalesQuotationDto } from './dto/sales-quotation.dto';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { NotificationsService } from '../notifications/notifications.service';
import { businessDayBounds, resolveTimezone } from '../accounting/business-date';
import { escapeLike } from '../common/text/escape-like';
import { lineMatches, memberMatches } from '../common/text/document-search';
import { resolveBranchId } from '../branches/resolve-branch';

// bank* fields removed from organization.select — SalesQuotation now
// carries its own snapshot columns (bankAccountId/bankName/
// bankAccountNumber/bankAccountName), same as Invoice.
const quotationDetailInclude = {
  items: { include: { product: { include: { prices: { select: { priceLevelId: true, price: true } } } }, taxes: true } },
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
  salesOrders: { select: { id: true, orderNumber: true, status: true } },
  invoices: { select: { id: true, invoiceNumber: true, status: true } },
  // Workshops: the car, the job it became, and the quotation chain (original ↔ additional parts).
  vehicle: { select: { id: true, plateNumber: true, vehicleModel: true, odometer: true } },
  workOrder: { select: { id: true, number: true, status: true } },
  parentQuotation: { select: { id: true, quotationNumber: true, status: true } },
  additions: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, quotationNumber: true, status: true, total: true, createdAt: true },
  },
} satisfies Prisma.SalesQuotationInclude;

// How long a customer approval link stays valid.
const APPROVAL_LINK_DAYS = 30;

const EDITABLE_STATUSES: SalesQuotationStatus[] = [
  SalesQuotationStatus.DRAFT,
  SalesQuotationStatus.SENT,
];

export type QuotationPrintView = {
  id: string;
  quotationNumber: string | null;
  // Workshops: the car quoted for, its odometer at quoting and the complaint.
  vehiclePlateNumber: string | null;
  vehicleModel: string | null;
  vehicleOdometer: number | null;
  complaint: string | null;
  status: string;
  format: string;
  businessName: string;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  businessAddress: string | null;
  businessPhone: string | null;

  discount: number;
  // Snapshotted on the quotation itself now, not read off organization.
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;

  quotationDate: Date | null;
  termsAndConditions: string | null;

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
    private bankAccounts: BankAccountResolverService,
    private modules: OrganizationModulesService,
    private notifications: NotificationsService,
  ) {}

  // ---- workshop fields --------------------------------------------------

  // The car must be this org's, and the quoted customer's when one is set. A new odometer reading
  // can't be below the car's current one — the same rule invoices and work orders enforce.
  private async validateVehicle(
    organizationId: string,
    vehicleId: string | null | undefined,
    customerId: string | null | undefined,
    odometer?: number | null,
  ) {
    if (!vehicleId) return;
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, organizationId },
      select: { customerId: true, odometer: true },
    });
    if (!vehicle) throw new BadRequestException('Vehicle not found');
    if (odometer != null && vehicle.odometer != null && odometer < vehicle.odometer) {
      throw new BadRequestException(
        `Odometer (${odometer} km) cannot be lower than the vehicle's current reading (${vehicle.odometer} km)`,
      );
    }
    if (customerId && vehicle.customerId !== customerId) {
      throw new BadRequestException("That vehicle belongs to another customer");
    }
  }

  // Only the workshop fields the request sent; null / '' clears one.
  private workshopFields(dto: { vehicleId?: string | null; odometer?: number | null; complaint?: string | null }) {
    return {
      ...(dto.vehicleId !== undefined && { vehicleId: dto.vehicleId || null }),
      ...(dto.odometer !== undefined && { odometer: dto.odometer ?? null }),
      ...(dto.complaint !== undefined && { complaint: dto.complaint?.trim() || null }),
    };
  }

  private async assertWorkshop(organizationId: string) {
    const enabled = await this.modules.getEnabledModules(organizationId);
    if (!enabled.includes(ModuleKey.WORKSHOP_RMS)) {
      throw new ForbiddenException('Customer approval links come with the Workshop module');
    }
  }

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
    await this.validateVehicle(organizationId, dto.vehicleId, dto.customerId, dto.odometer);
    const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
      await this.pricing.priceLines(organizationId, dto.items, undefined, { customerId: dto.customerId, userId });
    const quotationDate = dto.quotationDate ? new Date(dto.quotationDate) : new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const branchId = await resolveBranchId(tx, organizationId, { branchId: dto.branchId, locationId: dto.locationId });
        const bank = await this.bankAccounts.resolve(organizationId, dto.bankAccountId, tx, branchId);

        const quotation = await tx.salesQuotation.create({
          data: {
            organizationId,
            userId,
            branchId,
            locationId: dto.locationId,
            customerId: dto.customerId,
            customerName: dto.customerName,
            customerPoNumber: dto.customerPoNumber ?? null,
            quotationDate,
            termsAndConditions: dto.termsAndConditions ?? null,
            bankAccountId: bank.bankAccountId,
            bankName: bank.bankName,
            bankAccountNumber: bank.bankAccountNumber,
            bankAccountName: bank.bankAccountName,

            format: dto.format,
            validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
            ...this.workshopFields(dto),
            status: SalesQuotationStatus.DRAFT,
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
                unitPrice: l.unitPrice, priceLevelId: l.priceLevelId,
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
      this.tenantOwnership.handleFkViolation(err);
      throw err;
    }
  }

  // ---- update (DRAFT or SENT; SENT reverts to DRAFT) ---------------------

  async update(organizationId: string, id: string, userId: string, dto: UpdateSalesQuotationDto) {
    const quotation = await this.getEditableOrThrow(organizationId, id);
    await this.tenantOwnership.validate(organizationId, dto);
    const vehicleId = dto.vehicleId !== undefined ? dto.vehicleId : quotation.vehicleId;
    await this.validateVehicle(
      organizationId,
      vehicleId,
      dto.customerId ?? quotation.customerId,
      // Only a new reading is checked: a draft saved before the car's odometer moved on still saves.
      dto.odometer != null && (dto.odometer !== quotation.odometer || vehicleId !== quotation.vehicleId)
        ? dto.odometer
        : null,
    );
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
          const bank = dto.bankAccountId !== undefined
            ? await this.bankAccounts.resolve(organizationId, dto.bankAccountId, tx)
            : null;

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
              ...this.workshopFields(dto),
              ...(bank && {
                bankAccountId: bank.bankAccountId,
                bankName: bank.bankName,
                bankAccountNumber: bank.bankAccountNumber,
                bankAccountName: bank.bankAccountName,
              }),
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
                format: dto.format ?? quotation.format,
                locationId: dto.locationId,
                customerId: dto.customerId,
                customerName: dto.customerName,
                validUntil: dto.validUntil,
                customerPoNumber: dto.customerPoNumber,
                quotationDate: dto.quotationDate,
                termsAndConditions: dto.termsAndConditions,
                bankAccountId: dto.bankAccountId,
              },
            } as Prisma.InputJsonValue,
          });

          return updated;
        });
      } catch (err) {
        this.tenantOwnership.handleFkViolation(err);
        throw err;
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
          await this.pricing.priceLines(organizationId, dto.items!, tx, {
            customerId: dto.customerId ?? quotation.customerId,
            userId,
          });

        const bank = dto.bankAccountId !== undefined
          ? await this.bankAccounts.resolve(organizationId, dto.bankAccountId, tx)
          : null;

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
            ...this.workshopFields(dto),
            ...(bank && {
              bankAccountId: bank.bankAccountId,
              bankName: bank.bankName,
              bankAccountNumber: bank.bankAccountNumber,
              bankAccountName: bank.bankAccountName,
            }),

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
                unitPrice: l.unitPrice, priceLevelId: l.priceLevelId,
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
            fields: {
              customerPoNumber: dto.customerPoNumber,
              quotationDate: dto.quotationDate,
              termsAndConditions: dto.termsAndConditions,
              bankAccountId: dto.bankAccountId,
            },
          } as Prisma.InputJsonValue,
        });

        return updated;
      });
    } catch (err) {
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
        // Claim first: a second concurrent send (double-click) finds no
        // DRAFT row and stops before taking a number from the sequence.
        const claim = await tx.salesQuotation.updateMany({
          where: { id: quotation.id, organizationId, status: SalesQuotationStatus.DRAFT },
          data: { status: SalesQuotationStatus.SENT },
        });
        if (claim.count === 0) {
          throw new BadRequestException('Quotation is no longer a draft — it may have already been sent');
        }
        const quotationNumber = await this.numbering.nextSequential(tx, organizationId, 'SALES_QUOTATION', 'SQ');

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

  // ---- customer approval link (workshops) ----------------------------------

  // The secret for /estimate/<token>. A draft is sent first (it gets its number); the link is reused while
  // valid, so one already sent to the customer keeps working when staff copy it again.
  async approvalLink(organizationId: string, id: string, userId: string) {
    await this.assertWorkshop(organizationId);
    let quotation = await this.prisma.salesQuotation.findFirst({ where: { id, organizationId } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status === SalesQuotationStatus.DRAFT) {
      quotation = await this.send(organizationId, id, userId);
    }
    if (quotation.status !== SalesQuotationStatus.SENT && quotation.status !== SalesQuotationStatus.ACCEPTED) {
      throw new BadRequestException('Only a sent or accepted quotation can be shared with the customer');
    }
    if (quotation.approvalToken && quotation.approvalTokenExpiresAt && quotation.approvalTokenExpiresAt > new Date()) {
      return { token: quotation.approvalToken, expiresAt: quotation.approvalTokenExpiresAt };
    }
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + APPROVAL_LINK_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.salesQuotation.update({
      where: { id },
      data: { approvalToken: token, approvalTokenExpiresAt: expiresAt },
    });
    return { token, expiresAt };
  }

  private async byApprovalToken(token: string) {
    const quotation = await this.prisma.salesQuotation.findUnique({
      where: { approvalToken: token },
      select: { id: true, organizationId: true, approvalTokenExpiresAt: true },
    });
    if (!quotation) throw new NotFoundException('This link is not valid');
    if (!quotation.approvalTokenExpiresAt || quotation.approvalTokenExpiresAt < new Date()) {
      throw new GoneException('This link has expired — ask the workshop for a new one');
    }
    const enabled = await this.modules.getEnabledModules(quotation.organizationId);
    if (!enabled.includes(ModuleKey.WORKSHOP_RMS)) throw new NotFoundException('This link is not valid');
    return quotation;
  }

  // What the customer sees: no internal notes or staff names.
  async publicView(token: string) {
    const { id, approvalTokenExpiresAt } = await this.byApprovalToken(token);
    const q = await this.prisma.salesQuotation.findUniqueOrThrow({
      where: { id },
      include: {
        ...quotationDetailInclude,
        activityEvents: {
          where: { eventType: SalesQuotationActivityEventType.ACCEPTED },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    const lines = q.items.map((i) => ({
      name: i.product?.name ?? i.description ?? '',
      isPart: !!i.productId,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      lineTotal: Number(i.netAmount),
    }));
    return {
      business: {
        name: q.organization.name,
        legalName: q.organization.legalName,
        npwp: q.organization.npwp,
        address: q.organization.address,
        phone: q.organization.phone,
        logoUrl: q.organization.logoUrl,
      },
      number: q.quotationNumber,
      createdAt: q.sentAt ?? q.createdAt,
      status: q.status,
      approvedAt: q.activityEvents[0]?.createdAt ?? null,
      customerName: q.customer?.name ?? q.customerName,
      customerCompany: q.customer?.companyName ?? null,
      customerNpwp: q.customer?.npwp ?? null,
      validUntil: q.validUntil,
      customerPoNumber: q.customerPoNumber,
      termsAndConditions: q.termsAndConditions,
      vehicle: q.vehicle
        ? { plateNumber: q.vehicle.plateNumber, vehicleModel: q.vehicle.vehicleModel, odometer: q.odometer ?? null }
        : null,
      complaint: q.complaint,
      lines,
      subtotal: Number(q.subtotal),
      discountAmount: Number(q.discount),
      taxAmount: Number(q.taxAmount),
      total: Number(q.total),
      expiresAt: approvalTokenExpiresAt,
      // A fingerprint of what the customer is shown, echoed back on approve/decline: if staff changed the
      // quotation since, it's refused.
      version: createHash('sha256')
        .update(JSON.stringify([q.complaint, lines, Number(q.total), q.validUntil]))
        .digest('hex')
        .slice(0, 16),
    };
  }

  // The customer's answer: SENT → ACCEPTED or REJECTED, claimed on status so two answers can't both win.
  async respond(token: string, approve: boolean, dto: RespondToQuotationDto) {
    const { id, organizationId } = await this.byApprovalToken(token);
    const current = await this.publicView(token);
    if (current.status === SalesQuotationStatus.DRAFT) {
      throw new ConflictException('The workshop is updating this quotation — please try again shortly');
    }
    if (current.status !== SalesQuotationStatus.SENT) {
      throw new BadRequestException('This quotation has already been answered');
    }
    if (current.version !== dto.version) {
      throw new ConflictException('This quotation was updated — please reload to see the latest version');
    }
    if (approve && current.validUntil && endOfDay(current.validUntil) < new Date()) {
      throw new BadRequestException('This quotation is no longer valid — ask the workshop for an updated one');
    }
    const name = dto.name.trim();
    const note = approve
      ? `Approved online by ${name}`
      : `Declined online by ${name}${dto.reason?.trim() ? `: ${dto.reason.trim()}` : ''}`;

    const quotation = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.salesQuotation.updateMany({
        where: { id, status: SalesQuotationStatus.SENT },
        data: {
          status: approve ? SalesQuotationStatus.ACCEPTED : SalesQuotationStatus.REJECTED,
          responseNote: note,
        },
      });
      if (claimed.count === 0) throw new BadRequestException('This quotation has already been answered');
      const q = await tx.salesQuotation.findUniqueOrThrow({
        where: { id },
        select: { quotationNumber: true, userId: true, vehicle: { select: { plateNumber: true } } },
      });
      // The log needs a member: it's filed under whoever made the quotation, the note says who answered.
      if (q.userId) {
        await this.logActivity(tx, {
          quotationId: id,
          quotationNumber: q.quotationNumber,
          organizationId,
          userId: q.userId,
          eventType: approve ? SalesQuotationActivityEventType.ACCEPTED : SalesQuotationActivityEventType.REJECTED,
          reason: note,
        });
      }
      return q;
    });

    const label = [quotation.quotationNumber, quotation.vehicle?.plateNumber].filter(Boolean).join(' · ');
    await this.notifications.notifyOrgStaff(
      organizationId,
      approve ? 'QUOTATION_APPROVED' : 'QUOTATION_DECLINED',
      approve ? `Quotation ${label} was approved` : `Quotation ${label} was declined`,
      { body: note, link: `/sales/quotations/${id}` },
    );
    return this.publicView(token);
  }

  // ---- additional quotation (extra parts mid-job) ---------------------------

  // A new draft for the same customer, car and branch, linked to the original quotation. Converting it adds
  // its lines to the original's work order.
  async createAddition(organizationId: string, id: string, userId: string) {
    const picked = await this.prisma.salesQuotation.findFirst({ where: { id, organizationId } });
    if (!picked) throw new NotFoundException('Quotation not found');
    // An addition to an addition belongs to the same original.
    const original = picked.parentQuotationId
      ? await this.prisma.salesQuotation.findFirstOrThrow({ where: { id: picked.parentQuotationId, organizationId } })
      : picked;
    if (!original.workOrderId) {
      throw new BadRequestException(
        'Convert the quotation to a work order first — an additional quotation is for parts found during the job',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const addition = await tx.salesQuotation.create({
        data: {
          organizationId,
          userId,
          branchId: original.branchId,
          locationId: original.locationId,
          customerId: original.customerId,
          customerName: original.customerName,
          customerPoNumber: original.customerPoNumber,
          vehicleId: original.vehicleId,
          format: original.format,
          quotationDate: new Date(),
          termsAndConditions: original.termsAndConditions,
          bankAccountId: original.bankAccountId,
          bankName: original.bankName,
          bankAccountNumber: original.bankAccountNumber,
          bankAccountName: original.bankAccountName,
          parentQuotationId: original.id,
          status: SalesQuotationStatus.DRAFT,
        },
      });
      await this.logActivity(tx, {
        quotationId: addition.id,
        quotationNumber: null,
        organizationId,
        userId,
        eventType: SalesQuotationActivityEventType.CREATED,
        metadata: { additionTo: original.quotationNumber } as Prisma.InputJsonValue,
      });
      return addition;
    });
  }

  // ---- conversion ---------------------------------------------------------

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

  // Logged on every conversion; the quotation only becomes CONVERTED once nothing is left on it — until
  // then it stays SENT/ACCEPTED and the rest can still be ordered or invoiced. Called after the new
  // order's / invoice's lines exist (same transaction), so they're counted.
  private async markConverted(
    organizationId: string,
    id: string,
    userId: string,
    tx: PrismaService | any,
    metadata: Prisma.InputJsonValue,
  ) {
    const quotation = await tx.salesQuotation.findFirst({ where: { id, organizationId } });
    if (!quotation) throw new NotFoundException('Quotation not found');

    const anyLeft = (await this.conversionLines(organizationId, id, tx)).some((l) => l.remaining > 0);
    const updated = anyLeft
      ? quotation
      : await tx.salesQuotation.update({ where: { id }, data: { status: SalesQuotationStatus.CONVERTED } });

    await this.logActivity(tx, {
      quotationId: id,
      quotationNumber: quotation.quotationNumber,
      organizationId,
      userId,
      eventType: SalesQuotationActivityEventType.CONVERTED,
      metadata: { ...(metadata as object), partial: anyLeft } as Prisma.InputJsonValue,
    });

    return updated;
  }

  // ---- partial conversion ---------------------------------------------------

  // Per line: quoted, on live sales orders, invoiced straight from the quotation (live invoices; one made
  // from a sales order counts through the order), and what's left. Computed, not stored, so cancelling an
  // order or voiding an invoice frees its quantity by itself.
  async conversionLines(organizationId: string, quotationId: string, tx: PrismaService | any = this.prisma) {
    const items: {
      id: string;
      productId: string | null;
      description: string | null;
      quantity: Decimal;
      product: { name: string } | null;
      orderedLines: { quantity: Decimal }[];
      invoicedLines: { quantity: Decimal }[];
    }[] = await tx.salesQuotationItem.findMany({
      where: { salesQuotationId: quotationId, salesQuotation: { organizationId } },
      select: {
        id: true,
        productId: true,
        description: true,
        quantity: true,
        product: { select: { name: true } },
        orderedLines: { where: { salesOrder: { status: { not: 'CANCELLED' } } }, select: { quantity: true } },
        invoicedLines: {
          where: { invoice: { status: { not: 'VOID' }, salesOrderId: null } },
          select: { quantity: true },
        },
      },
    });
    const sum = (rows: { quantity: Decimal }[]) => this.round2(rows.reduce((n, r) => n + Number(r.quantity), 0));
    return items.map((i) => {
      const quoted = Number(i.quantity);
      const ordered = sum(i.orderedLines);
      const invoiced = sum(i.invoicedLines);
      return {
        id: i.id,
        name: i.product?.name ?? i.description ?? '',
        quoted,
        ordered,
        invoiced,
        remaining: Math.max(0, this.round2(quoted - ordered - invoiced)),
      };
    });
  }

  // The lines and quantities a conversion takes: the ones asked for (each within what's left), or
  // everything still left. Run inside the converting transaction, after its lock on the quotation.
  async linesToConvert(
    organizationId: string,
    quotationId: string,
    requested: { quotationItemId: string; quantity: number }[] | undefined,
    tx: PrismaService | any,
  ): Promise<{ quotationItemId: string; quantity: number }[]> {
    const progress = await this.conversionLines(organizationId, quotationId, tx);
    let picks: { quotationItemId: string; quantity: number }[];
    if (!requested?.length) {
      picks = progress.filter((l) => l.remaining > 0).map((l) => ({ quotationItemId: l.id, quantity: l.remaining }));
    } else {
      const merged = new Map<string, number>();
      for (const r of requested) merged.set(r.quotationItemId, this.round2((merged.get(r.quotationItemId) ?? 0) + r.quantity));
      picks = [...merged].map(([quotationItemId, quantity]) => {
        const line = progress.find((l) => l.id === quotationItemId);
        if (!line) throw new BadRequestException('That line is not on this quotation');
        if (quantity > line.remaining) {
          throw new BadRequestException(
            line.remaining > 0
              ? `Only ${line.remaining} of "${line.name}" is left to order or invoice`
              : `"${line.name}" has already been fully ordered or invoiced`,
          );
        }
        return { quotationItemId, quantity };
      });
    }
    if (picks.length === 0) {
      throw new BadRequestException('Everything on this quotation has already been ordered or invoiced');
    }
    return picks;
  }

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

  // ---- conversion to a work order (workshops) ---------------------------------

  // Claimed before the work order is made, so a double click can't make two: a sent or accepted quotation,
  // not yet a job, becomes CONVERTED. Returns the status to put back if making the job fails.
  async claimForWorkOrder(organizationId: string, id: string): Promise<SalesQuotationStatus> {
    const quotation = await this.prisma.salesQuotation.findFirst({ where: { id, organizationId } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    // The job takes the whole quotation; part of it already ordered or invoiced would be billed twice.
    if ((await this.conversionLines(organizationId, id)).some((l) => l.ordered > 0 || l.invoiced > 0)) {
      throw new BadRequestException('Part of this quotation was already ordered or invoiced — it can’t also become a work order');
    }
    const claimable: SalesQuotationStatus[] = [SalesQuotationStatus.SENT, SalesQuotationStatus.ACCEPTED];
    const claimed = await this.prisma.salesQuotation.updateMany({
      where: { id, organizationId, workOrderId: null, status: { in: claimable } },
      data: { status: SalesQuotationStatus.CONVERTED },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('This quotation is already a work order, or was declined or cancelled');
    }
    return quotation.status;
  }

  async releaseWorkOrderClaim(id: string, status: SalesQuotationStatus) {
    await this.prisma.salesQuotation.update({ where: { id }, data: { status } });
  }

  async recordWorkOrder(organizationId: string, id: string, userId: string, workOrderId: string) {
    const quotation = await this.prisma.salesQuotation.update({ where: { id }, data: { workOrderId } });
    await this.logActivity(this.prisma, {
      quotationId: id,
      quotationNumber: quotation.quotationNumber,
      organizationId,
      userId,
      eventType: SalesQuotationActivityEventType.CONVERTED,
      metadata: { convertedToType: 'WORK_ORDER', convertedToId: workOrderId },
    });
  }

  // The picked quotation lines as pricing input for the order / invoice, at the quantities picked: each
  // keeps its price and level (a quotation that said Rp100k must not become Rp110k because a level changed
  // since), its tax, and its discount — a fixed-amount one scaled to the part taken.
  pickedLineInputs(
    items: {
      id: string;
      productId: string | null;
      description: string | null;
      locationId: string | null;
      quantity: Decimal;
      unitPrice: Decimal;
      unit: string | null;
      priceLevelId: string | null;
      discountType: 'FIXED' | 'PERCENTAGE' | null;
      discountValue: Decimal | null;
      taxes: { taxRateId: string | null }[];
    }[],
    picks: { quotationItemId: string; quantity: number }[],
  ) {
    const picked = picks.map((p) => {
      const item = items.find((i) => i.id === p.quotationItemId);
      if (!item) throw new BadRequestException('That line is not on this quotation');
      return { item, quantity: p.quantity };
    });
    const forcedUnitPriceByIndex = new Map<number, number>();
    const forcedPriceLevelIdByIndex = new Map<number, string | null>();
    const inputs = picked.map(({ item: i, quantity }, idx) => {
      if (i.productId) {
        forcedUnitPriceByIndex.set(idx, Number(i.unitPrice));
        forcedPriceLevelIdByIndex.set(idx, i.priceLevelId ?? null);
      }
      const share = Number(i.quantity) ? quantity / Number(i.quantity) : 1;
      return {
        productId: i.productId ?? undefined,
        description: i.description ?? undefined,
        locationId: i.locationId ?? undefined,
        quantity,
        unitPrice: Number(i.unitPrice),
        unit: i.unit ?? undefined,
        discountType: i.discountType ?? undefined,
        discountValue:
          i.discountValue == null
            ? undefined
            : i.discountType === 'FIXED'
              ? this.round2(Number(i.discountValue) * share)
              : Number(i.discountValue),
        taxRateIds: i.taxes.map((t) => t.taxRateId).filter((id): id is string => !!id),
      };
    });
    return { quotationItemIds: picked.map((p) => p.item.id), inputs, forcedUnitPriceByIndex, forcedPriceLevelIdByIndex };
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
      // YYYY-MM-DD business days (or exact instants) — see businessDayBounds.
      from?: string;
      to?: string;
      dateField?: 'sent' | 'created';
      search?: string;
      page?: number;
      pageSize?: number;
      branchId?: string;
    },
  ): Promise<{ data: any[]; total: number; page: number; pageSize: number }> {
    let dateFilter: { gte?: Date; lte?: Date } | undefined;
    if (filters.from || filters.to) {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
      dateFilter = businessDayBounds(filters.from, filters.to, resolveTimezone(org));
    }

    const dateCondition: Prisma.SalesQuotationWhereInput | undefined = dateFilter
      ? filters.dateField === 'sent'
        ? { sentAt: dateFilter }
        : { createdAt: dateFilter }
      : undefined;

    const searchTerm = filters.search?.trim();
    const searchCondition: Prisma.SalesQuotationWhereInput | undefined = searchTerm
      ? {
          OR: [
            { quotationNumber: { contains: escapeLike(searchTerm), mode: 'insensitive' } },
            { customerName: { contains: escapeLike(searchTerm), mode: 'insensitive' } },
            { customer: { name: { contains: escapeLike(searchTerm), mode: 'insensitive' } } },
            // What was quoted, and who quoted it.
            { items: lineMatches(searchTerm) },
            { user: memberMatches(searchTerm) },
          ],
        }
      : undefined;

    const where: Prisma.SalesQuotationWhereInput = {
      organizationId,
      status: filters.status,
      branchId: filters.branchId,
      AND: [dateCondition, searchCondition].filter(
        (c): c is Prisma.SalesQuotationWhereInput => c !== undefined,
      ),
    };

    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 20;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.salesQuotation.findMany({
        where,
        include: {
          items: true,
          customer: true,
          location: { select: { name: true } },
          // Where it came from and what it became, for the list's links.
          parentQuotation: { select: { id: true, quotationNumber: true } },
          salesOrders: { select: { id: true, orderNumber: true, status: true }, orderBy: { createdAt: 'asc' } },
          invoices: { select: { id: true, invoiceNumber: true, status: true }, orderBy: { createdAt: 'asc' } },
          workOrder: { select: { id: true, number: true, status: true } },
        },
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
    // Each line's ordered / invoiced / left — the quotation converts in parts.
    return { ...quotation, conversion: await this.conversionLines(organizationId, id) };
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
      vehiclePlateNumber: quotation.vehicle?.plateNumber ?? null,
      vehicleModel: quotation.vehicle?.vehicleModel ?? null,
      vehicleOdometer: quotation.odometer ?? null,
      complaint: quotation.complaint ?? null,
      status: quotation.status,
      format: quotation.format,
      discount: toNumber(quotation.discount),
      quotationDate: quotation.quotationDate,
      termsAndConditions: quotation.termsAndConditions,
      // Snapshotted on the quotation itself now.
      bankName: quotation.bankName,
      bankAccountNumber: quotation.bankAccountNumber,
      bankAccountName: quotation.bankAccountName,

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
        itemDiscount: toNumber(item.discountAmount),
        itemTotal: toNumber(item.netAmount),
        itemTaxAmount: toNumber(item.taxAmount),

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
      const printView = await this.getPrintView(organizationId, id);
      const format = formatOverride ?? printView.format;

      const printToken = this.printTokenService.sign({
        documentType: 'quotation',
        documentId: id,
        organizationId,
      });
      const printUrl =
        `${process.env.FRONTEND_URL}/print/quotations/${encodeURIComponent(id)}?format=${encodeURIComponent(format)}&token=${printToken}`;

      // Capped — each render is a whole Chromium (see pdf-render-limiter.ts).
      return await withPdfRenderSlot(async () => {
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
      });
    } catch (e) {
      console.error('Quotation PDF render failed:', e);
      throw e;
    }
  }

  verifyPrintToken(token: string, quotationId: string) {
    return this.printTokenService.verifyDocumentToken(token, 'quotation', quotationId);
  }
}

// A DATE column holds midnight UTC; the quotation is good through that day.
function endOfDay(date: Date) {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
}
