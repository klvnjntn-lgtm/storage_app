import {
  BadRequestException,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { SessionsService } from '../sessions/sessions.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';
import { PrintTokenService } from '../common/print/print-token.service';
import {
  CreateDraftInvoiceDto,
  UpdateDraftInvoiceDto,
} from './dto/invoice.dto';
import {
  EventType,
  InvoiceActivityEventType,
  InvoiceStatus,
  ModuleKey,
  Prisma,
  SessionType,
} from '@prisma/client';
import { PaymentStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import puppeteer from 'puppeteer';
import { EditIssuedInvoiceDto } from './dto/edit-invoice.dto';
import { SalesQuotationService } from '../sales-quotation/sales-quotation.service';

// ---- InvoicePrintView type ----
export type InvoicePrintView = {
  id: string;
  format: string;

  invoiceNumber: string | null;
  status: string;
  vehicleId: string | null;
  paymentStatus: string;
  vehiclePlateNumber: string | null;
  vehicleModel: string | null;
  vehicleVin: string | null;
  vehicleOdometer: number | null;
  businessAddress: string | null;
  businessPhone: string | null;
  customerPoNumber: string | null; // NEW — optional/reference field per
                                    // updated PO Number policy; print
                                    // only when non-null (frontend concern)

  businessName: string;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;

  locationName: string;
  locationAddress: string | null;
  locationPhone: string | null;

  customerName: string | null;
  customerAddress: string | null;
  // NEW — spec requires Invoice to show Billing Address distinct from
  // Customer Address (Quotation/SO/DO only ever show customerAddress).
  // Falls back to customerAddress when the customer has no dedicated
  // billing address on file. Customer.billingAddress confirmed to exist
  // on the schema (String?), so this reads it directly — no fallback-only
  // uncertainty here anymore.
  billingAddress: string | null;
  customerPhone: string | null;
  customerNpwp: string | null;
  discountType: string | null;
  discountValue: number | null;

  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  invoiceDate: Date | null;
  dueDate: Date | null;
  issuedAt: Date | null;
  createdAt: Date;
  paymentTerms: string | null;
  notes: string | null;

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

    unitPrice: number;
    // NEW — per-item discount, tax, and line total. Spec requires
    // Discount/Tax/Item Total columns on the Invoice item table; these
    // were already computed and persisted on InvoiceItem
    // (taxAmount/total) but never left the service.
    itemDiscount: number;
    itemTaxAmount: number;
    itemTotal: number;
    lineTotal: number;
    locationName: string;
  }[];
};

// ---- invoiceDetailInclude ----
const invoiceDetailInclude = {
  organization: {
    select: {
      name: true,
      legalName: true,
      npwp: true,
      logoUrl: true,
      bankName: true,
      address: true,
      phone: true,

      bankAccountNumber: true,
      bankAccountName: true,
    },
  },
  location: { select: { name: true, address: true, phone: true } },
  // billingAddress selected alongside the existing customer fields so
  // mapInvoiceForPrint can fall back to `address` when it's unset.
  customer: true,
  vehicle: true,
  items: {
    include: {
      product: { select: { name: true, sku: true } },
      location: { select: { name: true } },
    },
  },
  taxes: { select: { name: true, percentage: true, amount: true } },
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class InvoiceService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
    private orgModulesService: OrganizationModulesService,
    private sessionsService: SessionsService,
    private printTokenService: PrintTokenService,
    private tenantOwnership: TenantOwnershipService,
    private numbering: DocumentNumberingService,
    private pricing: LineItemPricingService,
    private quotationService: SalesQuotationService,
  ) {}

  // ---- draft cart -------------------------------------------------

  async createDraft(
    organizationId: string,
    userId: string,
    dto: CreateDraftInvoiceDto,
  ) {
    await this.tenantOwnership.validate(organizationId, dto);
    const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
      await this.pricing.priceLines(organizationId, dto.items);
    // Discount is computed per-line inside priceLines (including the
    // 0–100 bound), and discountAmount/taxAmount above are already the
    // correct post-discount aggregates.
    const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Consolidated into one call via applyOdometerReading; still
        // fully atomic within the same transaction, so ordering relative
        // to invoice.create doesn't matter.
        if (dto.vehicleId && dto.odometer != null) {
          await this.applyOdometerReading(tx, organizationId, dto.vehicleId, dto.odometer);
        }

        const invoice = await tx.invoice.create({
          data: {
            organizationId,
            userId,
            locationId: dto.locationId,
            format: dto.format,
            odometer: dto.odometer ?? null,
            customerName: dto.customerName,
            customerId: dto.customerId,
            vehicleId: dto.vehicleId,
            customerPoNumber: dto.customerPoNumber ?? null,
            paymentTerms: dto.paymentTerms ?? null,
            notes: dto.notes ?? null,
            invoiceDate,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
            status: InvoiceStatus.DRAFT,
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
                unitCost: l.unitCost,
                lineTotal: l.lineTotal,
                unit: l.unit,
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
          include: {
            items: { include: { product: true, location: true, taxes: true } },
            customer: true,
            taxes: true,
          },
        });

        await tx.invoiceActivityEvent.create({
          data: {
            invoiceId: invoice.id,
            organizationId,
            userId,
            eventType: InvoiceActivityEventType.CREATED,
          },
        });

        return invoice;
      });
    } catch (err) {
      // FIX: handleFkViolation only throws on FK-constraint errors. If it
      // returns normally for anything else, this must not silently
      // resolve to `undefined` — always rethrow.
      this.tenantOwnership.handleFkViolation(err);
      throw err;
    }
  }

  async updateDraft(
    organizationId: string,
    invoiceId: string,
    dto: UpdateDraftInvoiceDto,
  ) {
    const invoice = await this.getDraftOrThrow(organizationId, invoiceId);
    await this.tenantOwnership.validate(organizationId, dto);

    if (!dto.items) {
      // FIX: this branch previously contained a full copy of the
      // items-repricing logic and called `this.pricing.priceLines(...,
      // dto.items!, tx)` — but dto.items is falsy inside this `if`, so
      // that call would throw (or behave incorrectly) on every
      // header-only update. Restored to what the branch name promises:
      // update header fields only, touch nothing pricing-related.
      try {
        return await this.prisma.$transaction(async (tx) => {
          const resolvedVehicleId = dto.vehicleId ?? invoice.vehicleId;
          if (resolvedVehicleId && dto.odometer != null) {
            await this.applyOdometerReading(tx, organizationId, resolvedVehicleId, dto.odometer);
          }

          return tx.invoice.update({
            where: { id: invoice.id },
            data: {
              customerName: dto.customerName ?? invoice.customerName,
              customerId: dto.customerId ?? invoice.customerId,
              vehicleId: dto.vehicleId ?? invoice.vehicleId,
              customerPoNumber: dto.customerPoNumber !== undefined ? dto.customerPoNumber : invoice.customerPoNumber,
              paymentTerms: dto.paymentTerms !== undefined ? dto.paymentTerms : invoice.paymentTerms,
              notes: dto.notes !== undefined ? dto.notes : invoice.notes,
              odometer: dto.odometer !== undefined ? dto.odometer : invoice.odometer,
              invoiceDate: dto.invoiceDate !== undefined
                ? (dto.invoiceDate ? new Date(dto.invoiceDate) : null)
                : invoice.invoiceDate,
              dueDate: dto.dueDate !== undefined
                ? (dto.dueDate ? new Date(dto.dueDate) : null)
                : invoice.dueDate,
              // NO subtotal/discount/taxAmount/total/items/taxes here —
              // nothing priced in this branch, items are untouched.
            },
            include: {
              items: { include: { product: true, location: true, taxes: true } },
              customer: true,
              taxes: true,
            },
          });
        });
      } catch (err) {
        this.tenantOwnership.handleFkViolation(err);
        throw err;
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
          await this.pricing.priceLines(organizationId, dto.items!, tx);

        const resolvedVehicleId = dto.vehicleId ?? invoice.vehicleId;
        if (resolvedVehicleId && dto.odometer != null) {
          await this.applyOdometerReading(tx, organizationId, resolvedVehicleId, dto.odometer);
        }

        const existingItemIds = (
          await tx.invoiceItem.findMany({
            where: { invoiceId: invoice.id },
            select: { id: true },
          })
        ).map((i) => i.id);
        if (existingItemIds.length) {
          await tx.invoiceItemTax.deleteMany({
            where: { invoiceItemId: { in: existingItemIds } },
          });
        }
        await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
        await tx.invoiceTax.deleteMany({ where: { invoiceId: invoice.id } });

        return tx.invoice.update({
          where: { id: invoice.id },
          data: {
            customerName: dto.customerName ?? invoice.customerName,
            customerId: dto.customerId ?? invoice.customerId,
            vehicleId: dto.vehicleId ?? invoice.vehicleId,
            customerPoNumber: dto.customerPoNumber !== undefined ? dto.customerPoNumber : invoice.customerPoNumber,
            paymentTerms: dto.paymentTerms !== undefined ? dto.paymentTerms : invoice.paymentTerms,
            notes: dto.notes !== undefined ? dto.notes : invoice.notes,
            odometer: dto.odometer !== undefined ? dto.odometer : invoice.odometer,
            invoiceDate: dto.invoiceDate !== undefined
              ? (dto.invoiceDate ? new Date(dto.invoiceDate) : null)
              : invoice.invoiceDate,
            dueDate: dto.dueDate !== undefined
              ? (dto.dueDate ? new Date(dto.dueDate) : null)
              : invoice.dueDate,
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
          include: {
            items: { include: { product: true, location: true, taxes: true } },
            customer: true,
            taxes: true,
          },
        });
      });
    } catch (err) {
      this.tenantOwnership.handleFkViolation(err);
      throw err;
    }
  }

  // ---- print / issue ------------------------------------------------
async issue(organizationId: string, invoiceId: string): Promise<InvoicePrintView & { sessionId: string | null }> {
  const invoice = await this.getDraftOrThrow(organizationId, invoiceId);
  if (invoice.items.length === 0) {
    throw new BadRequestException('Cannot print an empty invoice');
  }
  if (!invoice.userId) {
    throw new BadRequestException('Invoice has no associated user');
  }

  const enabledModules = await this.orgModulesService.getEnabledModules(organizationId);
  const hasWarehouseOps = enabledModules.includes(ModuleKey.WAREHOUSE_OPS);

  // Under WAREHOUSE_OPS, exactly one workflow owns physical stock
  // movement for a sales-order-originated invoice: delivery
  // (DeliveryOrder.ship()), not invoicing. createDraftFromSalesOrder()
  // only ever invoices already-delivered quantities in that mode, so
  // stock for these items was already decremented when they shipped —
  // creating a FULFILLMENT session here would pick and decrement the
  // same items a second time. Direct invoices (no salesOrderId) have no
  // delivery workflow of their own, so they keep using the session/PICK
  // path as before.
  const ownedByDeliveryWorkflow = hasWarehouseOps && !!invoice.salesOrderId;

  if (!hasWarehouseOps) {
    const missingLocation = invoice.items.find((item) => item.productId && !item.locationId);
    if (missingLocation) {
      throw new BadRequestException(
        `Item ${missingLocation.id} has a product but no location set; cannot decrease stock`,
      );
    }
  }

  try {
    return await this.prisma.$transaction(async (tx) => {
      const claim = await tx.invoice.updateMany({
        where: { id: invoice.id, organizationId, status: InvoiceStatus.DRAFT },
        data: { status: InvoiceStatus.ISSUED, issuedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new BadRequestException('Invoice is no longer a draft — it may have already been issued');
      }

      if (!hasWarehouseOps) {
        for (const item of invoice.items) {
          if (!item.productId) continue;
          await this.stockService.decrease(
            organizationId,
            item.productId,
            item.locationId as string,
            Number(item.quantity),
            invoice.userId!,
            { type: EventType.SALE, invoiceId: invoice.id },
            tx,
          );
        }
      }

      const invoiceNumber = await this.nextInvoiceNumber(tx, organizationId);
      const invoiceDate = invoice.invoiceDate ?? new Date();

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: { invoiceDate, invoiceNumber },
        include: invoiceDetailInclude,
      });

      await tx.invoiceActivityEvent.create({
        data: {
          invoiceId: invoice.id,
          organizationId,
          userId: invoice.userId!,
          eventType: InvoiceActivityEventType.ISSUED,
        },
      });

      let sessionId: string | null = null;
      if (hasWarehouseOps && !ownedByDeliveryWorkflow) {
        const session = await this.sessionsService.create(
          organizationId,
          SessionType.FULFILLMENT,
          updated.id,
          tx,
        );
        sessionId = session.id;
      }

      return { ...this.mapInvoiceForPrint(updated), sessionId };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadRequestException(
        'Invoice number assignment conflicted with a concurrent issue — please retry',
      );
    }
    throw err;
  }
}

async getRevenueReport(
    organizationId: string,
    from: Date,
    to: Date,
    locationId?: string,
  ) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        locationId,
        status: InvoiceStatus.ISSUED,
        issuedAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        invoiceNumber: true,
        issuedAt: true,
        amountPaid: true,
        total: true,
        items: {
          select: { quantity: true, unitPrice: true, unitCost: true },
        },
      },
      orderBy: { issuedAt: 'desc' },
    });

    let revenue = 0;
    let cost = 0;
    let profit = 0;
    let profitCoverage = 0;
    let lineItemCount = 0;
    let collected = 0;

    const rows = invoices.map((inv) => {
      let invCost = 0;
      let invProfit = 0;
      let unitsSold = 0;

      for (const item of inv.items) {
        lineItemCount++;
        unitsSold += item.quantity;

        if (item.unitCost != null) {
          profitCoverage++;
          const lineCost = Number(item.unitCost) * item.quantity;
          const lineProfit = (Number(item.unitPrice) - Number(item.unitCost)) * item.quantity;
          invCost += lineCost;
          invProfit += lineProfit;
        }
      }

      revenue += Number(inv.total);
      cost += invCost;
      profit += invProfit;
      collected += Number(inv.amountPaid);

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        issuedAt: inv.issuedAt,
        gross: Number(inv.total),
        cost: invCost,
        profit: invProfit,
        unitsSold,
        collected: Number(inv.amountPaid),
      };
    });

    return {
      revenue,
      invoiceCount: invoices.length,
      cost,
      profit,
      profitCoverage,
      lineItemCount,
      invoices: rows,
      collected,
    };
  }

  async list(
    organizationId: string,
    filters: {
      status?: InvoiceStatus;
      from?: Date;
      to?: Date;
      locationId?: string;
      dateField?: 'issued' | 'invoice';
      page?: number;
      pageSize?: number;
      paymentStatus?: PaymentStatus;
      overdue?: boolean;
      search?: string;
    },
  ): Promise<{ data: any[]; total: number; page: number; pageSize: number }> {
    const dateFilter = filters.from || filters.to
      ? { gte: filters.from, lte: filters.to }
      : undefined;

    const now = new Date();
    const todayUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const overdueFilter = filters.overdue
      ? {
          status: InvoiceStatus.ISSUED,
          paymentStatus: { not: PaymentStatus.PAID },
          dueDate: { lt: todayUtcMidnight },
        }
      : {};

    const dateCondition: Prisma.InvoiceWhereInput | undefined = dateFilter
      ? filters.dateField === 'invoice'
        ? { invoiceDate: dateFilter }
        : {
            OR: [
              { status: InvoiceStatus.ISSUED, issuedAt: dateFilter },
              { status: { not: InvoiceStatus.ISSUED }, createdAt: dateFilter },
            ],
          }
      : undefined;

    const searchTerm = filters.search?.trim();
    const searchCondition: Prisma.InvoiceWhereInput | undefined = searchTerm
      ? {
          OR: [
            { invoiceNumber: { contains: searchTerm, mode: 'insensitive' } },
            { customerName: { contains: searchTerm, mode: 'insensitive' } },
            { customer: { name: { contains: searchTerm, mode: 'insensitive' } } },
          ],
        }
      : undefined;

    const where: Prisma.InvoiceWhereInput = {
      organizationId,
      status: filters.status,
      locationId: filters.locationId,
      ...(!filters.overdue && filters.paymentStatus ? { paymentStatus: filters.paymentStatus } : {}),
      ...overdueFilter,
      AND: [dateCondition, searchCondition].filter(
        (c): c is Prisma.InvoiceWhereInput => c !== undefined,
      ),
    };

    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 20;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: { items: true, location: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async renderPdf(
    organizationId: string,
    id: string,
    formatOverride?: string,
  ): Promise<Buffer> {
    try {
      const invoice = await this.getOne(organizationId, id);
      const format = formatOverride ?? invoice.format;

      const printToken = this.printTokenService.sign({
        documentType: 'invoice',
        documentId: id,
        organizationId,
      });
      const printUrl =
        `${process.env.FRONTEND_URL}/print/invoices/${id}?format=${format}&token=${printToken}`;

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
      console.error('PDF render failed:', e);
      throw e;
    }
  }

  verifyPrintToken(token: string, invoiceId: string) {
    return this.printTokenService.verifyDocumentToken(token, 'invoice', invoiceId);
  }

  // ---- detail / print view ------------------------------------------
  async getOne(organizationId: string, id: string): Promise<InvoicePrintView> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: invoiceDetailInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    return this.mapInvoiceForPrint(invoice);
  }

  private mapInvoiceForPrint(
    invoice: Prisma.InvoiceGetPayload<{ include: typeof invoiceDetailInclude }>,
  ): InvoicePrintView {
    const toNumber = (d: Decimal) => Number(d);

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      format: invoice.format,

      vehicleId: invoice.vehicleId ?? null,
      businessAddress: invoice.organization.address,
      businessPhone: invoice.organization.phone,
      paymentTerms: invoice.paymentTerms,
      notes: invoice.notes,
      customerPoNumber: invoice.customerPoNumber,
      paymentStatus: invoice.paymentStatus,
      vehiclePlateNumber: invoice.vehicle?.plateNumber ?? null,
      vehicleModel: invoice.vehicle?.vehicleModel ?? null,
      vehicleVin: invoice.vehicle?.vin ?? null,
      vehicleOdometer: invoice.odometer ?? invoice.vehicle?.odometer ?? null,
      businessName: invoice.organization.name,
      businessLegalName: invoice.organization.legalName,
      businessNpwp: invoice.organization.npwp,
      businessLogoUrl: invoice.organization.logoUrl,
      bankName: invoice.organization.bankName,
      bankAccountNumber: invoice.organization.bankAccountNumber,
      bankAccountName: invoice.organization.bankAccountName,

      locationName: invoice.location?.name ?? '',
      locationAddress: invoice.location?.address ?? null,
      locationPhone: invoice.location?.phone ?? null,
      discountType: invoice.discountType,
      discountValue: invoice.discountValue != null ? toNumber(invoice.discountValue) : null,

      customerName: invoice.customer?.name ?? invoice.customerName,
      customerAddress: invoice.customer?.address ?? null,
      // Confirmed: Customer.billingAddress exists on the schema (String?).
      // Falls back to customer.address when the customer has no dedicated
      // billing address on file.
      billingAddress: invoice.customer?.billingAddress ?? invoice.customer?.address ?? null,
      customerPhone: invoice.customer?.phone ?? null,
      customerNpwp: invoice.customer?.npwp ?? null,

      subtotal: toNumber(invoice.subtotal),
      discount: toNumber(invoice.discount),
      taxAmount: toNumber(invoice.taxAmount),
      total: toNumber(invoice.total),
      // FIX: every other Decimal field here goes through toNumber();
      // amountPaid was returned raw, which leaks a Prisma Decimal
      // instance into the print view instead of a plain number
      // (getRevenueReport / getCustomerStatement both already treat
      // amountPaid as a Decimal via Number(inv.amountPaid), confirming
      // the type mismatch here).
      amountPaid: Number(invoice.amountPaid),
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      issuedAt: invoice.issuedAt,
      createdAt: invoice.createdAt,

      taxes: invoice.taxes.map((tax) => ({
        name: tax.name,
        percentage: toNumber(tax.percentage),
        amount: toNumber(tax.amount),
      })),

      items: invoice.items.map((item) => ({
        id: String(item.id),
        productName: item.product?.name ?? item.description ?? '',
        sku: item.product?.sku ?? null,
        quantity: item.quantity,
        unit: item.unit,

        unitPrice: toNumber(item.unitPrice),
        itemDiscount: toNumber(item.discountAmount),
        itemTaxAmount: toNumber(item.taxAmount),
        // FIX (consistency): now uses item.netAmount, matching the
        // SalesQuotation and SalesOrder convention for "itemTotal"
        // (pre-tax, post-discount). Previously used item.total, which
        // silently disagreed with the sibling documents for the same
        // logical field — a shared Item Table component would have
        // rendered a different number on Invoice than on
        // Quotation/SalesOrder for the same underlying line.
        itemTotal: toNumber(item.netAmount),
        lineTotal: toNumber(item.lineTotal),
        locationName: item.location?.name ?? '',
      })),
    };
  }

  // Whole method wrapped in one transaction, and the quotation reopen is
  // passed `tx` instead of running standalone. Previously the reopen ran
  // ahead of three non-transactional deletes — if any delete failed
  // partway, the quotation would already be back at ACCEPTED while the
  // draft invoice (or orphaned items) still existed.
  //
  // NOTE: signature changed — now requires `userId` (reopenIfConverted
  // needs it to log the ACCEPTED activity event). Update the controller
  // call site to pass the authenticated user's id.
  async discardDraft(organizationId: string, id: string, userId: string) {
    const invoice = await this.getDraftOrThrow(organizationId, id);

    return this.prisma.$transaction(async (tx) => {
      if (invoice.quotationId) {
        await this.quotationService.reopenIfConverted(
          organizationId,
          invoice.quotationId,
          userId,
          'Draft invoice discarded',
          tx,
        );
      }

      const itemIds = (
        await tx.invoiceItem.findMany({
          where: { invoiceId: invoice.id },
          select: { id: true },
        })
      ).map((i) => i.id);

      if (itemIds.length) {
        await tx.invoiceItemTax.deleteMany({
          where: { invoiceItemId: { in: itemIds } },
        });
      }
      await tx.invoiceItem.deleteMany({
        where: { invoiceId: invoice.id },
      });
      return tx.invoice.delete({ where: { id: invoice.id } });
    });
  }

  // ---- helpers ------------------------------------------------

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  private async getDraftOrThrow(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { items: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Invoice is no longer editable');
    }
    return invoice;
  }

  private async nextInvoiceNumber(tx: any, organizationId: string) {
    const year = new Date().getFullYear();
    const count = await tx.invoice.count({
      where: {
        organizationId,
        status: InvoiceStatus.ISSUED,
        issuedAt: { gte: new Date(`${year}-01-01`) },
      },
    });
    return this.numbering.next({ prefix: 'INV', count, year });
  }

  async getDraftDetail(organizationId: string, id: string) {
    return this.getDraftOrThrowFull(organizationId, id);
  }

  private async getDraftOrThrowFull(organizationId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId, status: InvoiceStatus.DRAFT },
      include: {
        items: {
          include: {
            product: { select: { name: true, sku: true, barcode: true } },
            location: { select: { name: true } },
            taxes: true,
          },
        },
        customer: true,
        taxes: true,
        location: true,
      },
    });
    if (!invoice) throw new NotFoundException('Draft invoice not found');
    return invoice;
  }

  async getCustomerStatement(
    organizationId: string,
    customerId: string,
    from: Date,
    to: Date,
    vehicleIds?: string[],
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true, name: true, address: true, phone: true, npwp: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        name: true,
        legalName: true,
        npwp: true,
        logoUrl: true,
        bankName: true,
        bankAccountNumber: true,
        bankAccountName: true,
        address: true,
        phone: true,
      },
    });

    const vehicleFilter =
      vehicleIds && vehicleIds.length > 0 ? { vehicleId: { in: vehicleIds } } : {};

    const [priorInvoices, periodInvoices] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          customerId,
          status: InvoiceStatus.ISSUED,
          issuedAt: { lt: from },
          ...vehicleFilter,
        },
        select: { total: true, amountPaid: true },
      }),
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          customerId,
          status: InvoiceStatus.ISSUED,
          issuedAt: { gte: from, lte: to },
          ...vehicleFilter,
        },
        select: {
          id: true,
          invoiceNumber: true,
          issuedAt: true,
          total: true,
          amountPaid: true,
          vehicleId: true,
          vehicle: { select: { plateNumber: true, vehicleModel: true } },
        },
        orderBy: { issuedAt: 'asc' },
      }),
    ]);

    const openingBalance = this.round2(
      priorInvoices.reduce((sum, inv) => sum + (Number(inv.total) - inv.amountPaid), 0),
    );
    const periodInvoiced = this.round2(
      periodInvoices.reduce((sum, inv) => sum + Number(inv.total), 0),
    );
    const periodPaidAsOfNow = this.round2(
      periodInvoices.reduce((sum, inv) => sum + inv.amountPaid, 0),
    );
    const closingBalance = this.round2(openingBalance + periodInvoiced - periodPaidAsOfNow);

    return {
      customer,
      organization,
      from,
      to,
      generatedAt: new Date(),
      vehicleIds: vehicleIds ?? [],
      openingBalance,
      closingBalance,
      paymentTimingUnavailable: true,
      lines: periodInvoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        issuedAt: inv.issuedAt,
        invoiced: Number(inv.total),
        paidToDate: inv.amountPaid,
        balance: this.round2(Number(inv.total) - inv.amountPaid),
        vehicleId: inv.vehicleId,
        vehiclePlateNumber: inv.vehicle?.plateNumber ?? null,
        vehicleModel: inv.vehicle?.vehicleModel ?? null,
      })),
    };
  }

  async getIssuedInvoiceEditDetail(organizationId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId, status: InvoiceStatus.ISSUED },
      include: {
        items: {
          include: {
            product: { select: { name: true, sku: true, barcode: true } },
            location: { select: { name: true } },
            taxes: true,
          },
        },
        customer: true,
        taxes: true,
        location: true,
      },
    });
    if (!invoice) throw new NotFoundException('Issued invoice not found');
    return invoice;
  }

  async editIssuedInvoice(
    organizationId: string,
    invoiceId: string,
    dto: EditIssuedInvoiceDto,
    userId: string,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId, status: InvoiceStatus.ISSUED },
      include: {
        items: { include: { product: { select: { name: true } } } },
      },
    });
    if (!invoice) throw new NotFoundException('Issued invoice not found');
    if (!invoice.userId) {
      throw new BadRequestException('Invoice has no associated user');
    }

    if (invoice.paymentStatus !== PaymentStatus.UNPAID) {
      throw new BadRequestException(
        'Cannot edit items on an invoice that has payments recorded. Void and reissue instead.',
      );
    }

    const enabledModules = await this.orgModulesService.getEnabledModules(organizationId);
    if (enabledModules.includes(ModuleKey.WAREHOUSE_OPS)) {
      throw new BadRequestException(
        'Item edits on issued invoices are not supported for organizations using warehouse fulfillment. Void and reissue instead.',
      );
    }

    // Computed once, outside the transaction — this is the ONLY
    // oldQtyByKey. FIX: a second `const oldQtyByKey = new Map()` used to
    // be declared again inside the transaction below, shadowing this one
    // with an empty map. That made every stock delta compute against 0,
    // so every edit re-decreased the FULL new quantity for every line
    // instead of just the delta — silently corrupting stock on every
    // issued-invoice edit. Do not redeclare this inside the transaction.
    const oldQtyByKey = new Map<string, number>();
    for (const item of invoice.items) {
      if (!item.productId || !item.locationId) continue;
      const key = `${item.productId}__${item.locationId}`;
      oldQtyByKey.set(key, (oldQtyByKey.get(key) ?? 0) + item.quantity);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
        await this.pricing.priceLines(organizationId, dto.items, tx);
      const newTotal = this.round2(subtotal - discountAmount + taxAmount);

      // Odometer handling, consistent with createDraft/updateDraft.
      // No dto.vehicleId exists on this DTO (the vehicle isn't
      // reassignable during an issued-invoice edit), so the vehicle is
      // always the invoice's existing one.
      if (invoice.vehicleId && dto.odometer != null) {
        await this.applyOdometerReading(tx, organizationId, invoice.vehicleId, dto.odometer);
      }

      const newQtyByKey = new Map<string, number>();
      for (const l of lines) {
        if (!l.productId || !l.locationId) continue;
        const key = `${l.productId}__${l.locationId}`;
        newQtyByKey.set(key, (newQtyByKey.get(key) ?? 0) + l.quantity);
      }

      const allKeys = new Set([...oldQtyByKey.keys(), ...newQtyByKey.keys()]);
      for (const key of allKeys) {
        const [productId, locationId] = key.split('__');
        const oldQty = oldQtyByKey.get(key) ?? 0;
        const newQty = newQtyByKey.get(key) ?? 0;
        const delta = newQty - oldQty;
        if (delta === 0) continue;

        if (delta > 0) {
          await this.stockService.decrease(
            organizationId, productId, locationId, delta, invoice.userId!,
            { type: EventType.SALE, invoiceId: invoice.id }, tx,
          );
        } else {
          await this.stockService.increase(
            organizationId, productId, locationId, Math.abs(delta), invoice.userId!,
            { type: EventType.SALE, invoiceId: invoice.id }, tx,
          );
        }
      }

      const existingItemIds = (
        await tx.invoiceItem.findMany({ where: { invoiceId: invoice.id }, select: { id: true } })
      ).map((i) => i.id);
      if (existingItemIds.length) {
        await tx.invoiceItemTax.deleteMany({ where: { invoiceItemId: { in: existingItemIds } } });
      }
      await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
      await tx.invoiceTax.deleteMany({ where: { invoiceId: invoice.id } });

      const result = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          dueDate: dto.dueDate !== undefined
            ? (dto.dueDate ? new Date(dto.dueDate) : null)
            : invoice.dueDate,
          odometer: dto.odometer !== undefined ? dto.odometer : invoice.odometer,
          subtotal,
          taxAmount,
          discount: discountAmount,
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              description: l.description,
              locationId: l.locationId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              unitCost: l.unitCost,
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
        include: invoiceDetailInclude,
      });

      const productIds = dto.items.filter((i) => i.productId).map((i) => i.productId!);
      const products = productIds.length
        ? await tx.product.findMany({ where: { id: { in: productIds }, organizationId }, select: { id: true, name: true } })
        : [];
      const productNames = new Map(products.map((p) => [p.id, p.name]));
      const changes = this.buildEditDiff(invoice.items, lines, productNames);

      await tx.invoiceActivityEvent.create({
        data: {
          invoiceId: invoice.id,
          organizationId,
          userId,
          eventType: InvoiceActivityEventType.EDITED,
          reason: dto.reason.trim(),
          oldTotal: invoice.total,
          newTotal,
          changes,
        },
      });

      return result;
    });

    return this.mapInvoiceForPrint(updated);
  }

  private buildEditDiff(
    oldItems: {
      productId: string | null;
      description: string | null;
      quantity: number;
      unitPrice: any;
      discountAmount: any; // Decimal from DB — coerced with Number() below, same convention as unitPrice
      product?: { name: string } | null;
    }[],
    newItems: {
      productId: string | null;
      description: string | null;
      quantity: number;
      unitPrice: number;
      discountAmount: number; // already a plain number from PricedLine
    }[],
    productNames: Map<string, string>,
  ): { label: string; before: string; after: string }[] {
    const keyOf = (i: { productId: string | null; description: string | null }) =>
      i.productId ? `p:${i.productId}` : `s:${i.description}`;
    const labelOf = (i: { productId: string | null; description: string | null; product?: { name: string } | null }) =>
      i.productId ? (i.product?.name ?? productNames.get(i.productId) ?? 'Unknown product') : (i.description ?? 'Service');

    // Formats a line's qty/price/discount into one comparable string.
    // Discount is only appended when non-zero, so a line with no discount
    // on either side still reads exactly as before (`× 2 @ 100000`) rather
    // than always showing a noisy `(disc 0)` suffix.
    const describe = (i: { quantity: number; unitPrice: any; discountAmount: any }) => {
      const discount = Number(i.discountAmount ?? 0);
      const base = `× ${i.quantity} @ ${Number(i.unitPrice)}`;
      return discount > 0 ? `${base} (disc ${discount})` : base;
    };

    const oldByKey = new Map(oldItems.map((i) => [keyOf(i), i]));
    const newByKey = new Map(newItems.map((i) => [keyOf(i), i]));
    const changes: { label: string; before: string; after: string }[] = [];

    for (const key of new Set([...oldByKey.keys(), ...newByKey.keys()])) {
      const before = oldByKey.get(key);
      const after = newByKey.get(key);
      const label = labelOf((after ?? before)!);

      if (!before) {
        changes.push({ label, before: '—', after: `added ${describe(after!)}` });
      } else if (!after) {
        changes.push({ label, before: describe(before), after: 'removed' });
      } else if (
        before.quantity !== after.quantity ||
        Number(before.unitPrice) !== Number(after.unitPrice) ||
        // A line whose qty and price are unchanged but whose discount
        // changed (added, removed, or its amount changed) now shows up in
        // the diff instead of being silently skipped.
        Number(before.discountAmount ?? 0) !== Number(after.discountAmount ?? 0)
      ) {
        changes.push({
          label,
          before: describe(before),
          after: describe(after),
        });
      }
    }
    return changes;
  }

  async getEditHistory(organizationId: string, invoiceId: string) {
    return this.prisma.invoiceActivityEvent.findMany({
      where: { invoiceId, organizationId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  async getOverdueCount(organizationId: string): Promise<number> {
    const now = new Date();
    const todayUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    return this.prisma.invoice.count({
      where: {
        organizationId,
        status: InvoiceStatus.ISSUED,
        paymentStatus: { not: 'PAID' },
        dueDate: { lt: todayUtcMidnight },
      },
    });
  }

  // The quotation reopen now runs INSIDE the transaction, after
  // tx.invoice.update flips the invoice to VOID, and passes `tx`.
  // Previously it ran unconditionally before the transaction even opened
  // — if the transaction later threw (e.g. the WAREHOUSE_OPS
  // session-has-items guard below), the quotation had already been
  // reopened to ACCEPTED even though the invoice was never actually
  // voided.
  async voidInvoice(
    organizationId: string,
    invoiceId: string,
    reason: string,
    userId: string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to void an invoice');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId, status: InvoiceStatus.ISSUED },
      include: { items: true },
    });
    if (!invoice) throw new NotFoundException('Issued invoice not found');

    if (invoice.paymentStatus !== PaymentStatus.UNPAID) {
      throw new BadRequestException(
        'Cannot void an invoice with payments recorded. Refund and reconcile first.',
      );
    }

    const enabledModules = await this.orgModulesService.getEnabledModules(organizationId);
    const hasWarehouseOps = enabledModules.includes(ModuleKey.WAREHOUSE_OPS);

    return this.prisma.$transaction(async (tx) => {
      if (!hasWarehouseOps) {
        for (const item of invoice.items) {
          if (!item.productId || !item.locationId) continue;
          await this.stockService.increase(
            organizationId, item.productId, item.locationId, item.quantity, userId,
            { type: EventType.ADJUSTMENT, invoiceId: invoice.id }, tx,
          );
        }
      } else {
        const session = await tx.session.findFirst({
          where: { invoiceId: invoice.id, organizationId },
          include: { _count: { select: { items: true } } },
        });
        if (session && session._count.items > 0) {
          throw new BadRequestException(
            'Cannot void — fulfillment has already started on this invoice\'s session. Resolve the session first.',
          );
        }
        if (session) {
          await tx.session.delete({ where: { id: session.id } });
        }
      }

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.VOID },
        include: invoiceDetailInclude,
      });

      if (invoice.quotationId) {
        await this.quotationService.reopenIfConverted(
          organizationId,
          invoice.quotationId,
          userId,
          reason.trim(),
          tx,
        );
      }

      await tx.invoiceActivityEvent.create({
        data: {
          invoiceId: invoice.id,
          organizationId,
          userId,
          eventType: InvoiceActivityEventType.VOIDED,
          reason: reason.trim(),
        },
      });

      return this.mapInvoiceForPrint(updated);
    });
  }

  async createDraftFromQuotation(organizationId: string, userId: string, quotationId: string) {
    const quotation = await this.prisma.salesQuotation.findFirst({
      where: { id: quotationId, organizationId },
      // `status` added to the invoices select — the guard below now filters
      // out VOID invoices instead of blocking on "any invoice ever existed",
      // so a quotation can be re-invoiced after its prior invoice was voided
      // (matching what reopenIfConverted already flips the quotation's
      // status back to ACCEPTED for).
      include: { items: true, invoices: { select: { id: true, status: true } } },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');

    const invoiceableStatuses = ['SENT', 'ACCEPTED', 'CONVERTED'];
    if (!invoiceableStatuses.includes(quotation.status)) {
      throw new BadRequestException('Only a sent, accepted, or converted quotation can be invoiced');
    }
    // Was `quotation.invoices.length > 0`, which counted VOID invoices
    // too and permanently blocked re-invoicing even after
    // reopenIfConverted() explicitly reopened the quotation for exactly
    // that purpose. Now only a live (non-VOID) invoice blocks conversion.
    const activeInvoices = quotation.invoices.filter((inv) => inv.status !== 'VOID');
    if (activeInvoices.length > 0) {
      throw new BadRequestException('This quotation has already been invoiced');
    }

    const items = quotation.items.map((i) => ({
      productId: i.productId ?? undefined,
      description: i.description ?? undefined,
      locationId: i.locationId ?? undefined,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      discountType: i.discountType ?? undefined,
      discountValue: i.discountValue != null ? Number(i.discountValue) : undefined,
      taxRateIds: [] as string[],
    }));

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
          await this.pricing.priceLines(organizationId, items, tx);
        const invoice = await tx.invoice.create({
          data: {
            organizationId,
            userId,
            locationId: quotation.locationId,
            format: 'A4',
            customerName: quotation.customerName,
            customerId: quotation.customerId,
            quotationId: quotation.id,
            invoiceDate: new Date(),
            status: 'DRAFT',
            subtotal,
            discount: discountAmount,
            taxAmount,
            total: this.round2(subtotal - discountAmount + taxAmount),
            items: { create: lines.map((l) => ({
              productId: l.productId, description: l.description, locationId: l.locationId,
              quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost,
              lineTotal: l.lineTotal,
              discountType: l.discountType, discountValue: l.discountValue,
              discountAmount: l.discountAmount, netAmount: l.netAmount,
              taxAmount: l.taxAmount, total: l.total,
              taxes: { create: l.taxes },
            })) },
            taxes: { create: taxLines },
          },
          include: { items: true, customer: true, taxes: true },
        });
        await this.quotationService.markConvertedToInvoice(
          organizationId, quotation.id, userId, invoice.id, tx,
        );
        return invoice;
      });
    } catch (err) {
      // Backstop for the race the app-level guard above can't fully
      // close: two concurrent requests can both read activeInvoices.length
      // === 0 before either transaction commits. The partial unique index
      // on Invoice.quotationId is the real protection; this just turns the
      // resulting raw Postgres unique violation into a clean error. Only
      // one unique constraint can plausibly fire inside this transaction
      // (invoiceNumber is still null at draft time, and multiple nulls are
      // allowed in a unique index), so a bare code check is unambiguous here.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('This quotation has already been invoiced');
      }
      throw err;
    }
  }

async createDraftFromSalesOrder(organizationId: string, userId: string, salesOrderId: string) {
  const order = await this.prisma.salesOrder.findFirst({
    where: { id: salesOrderId, organizationId },
    include: { items: true, invoices: { select: { id: true } } },
  });
  if (!order) throw new NotFoundException('Sales order not found');

  const enabledModules = await this.orgModulesService.getEnabledModules(organizationId);
  const hasWarehouseOps = enabledModules.includes(ModuleKey.WAREHOUSE_OPS);

  // Under WAREHOUSE_OPS, delivery exclusively owns physical stock
  // movement, and this order can only ever be invoiced once (see the
  // salesOrderId uniqueness guard below) — so a partially-delivered
  // order isn't invoiceable yet, or the remaining quantity could never
  // be billed once it eventually ships. Only CONFIRMED (nothing to
  // invoice) and FULLY_DELIVERED (everything shipped, safe to invoice
  // once, in full) are meaningfully different here; PARTIALLY_DELIVERED
  // is excluded on purpose, not merged into a shared allow-list.
  //
  // Non-WAREHOUSE_OPS has no competing delivery workflow, so all three
  // statuses remain invoiceable at full order quantity, as before.
  if (hasWarehouseOps) {
    if (order.status !== 'FULLY_DELIVERED') {
      throw new BadRequestException(
        order.status === 'CONFIRMED' || order.status === 'PARTIALLY_DELIVERED'
          ? 'This order must be fully delivered before it can be invoiced — create delivery orders for the remaining items first.'
          : 'Only a fully delivered order can be invoiced directly',
      );
    }
  } else {
    if (
      order.status !== 'CONFIRMED' &&
      order.status !== 'PARTIALLY_DELIVERED' &&
      order.status !== 'FULLY_DELIVERED'
    ) {
      throw new BadRequestException('Only a confirmed order can be invoiced directly');
    }
  }

  if (order.invoices.length > 0) {
    throw new BadRequestException('This sales order has already been invoiced');
  }

  const items = order.items.map((i) => ({
    productId: i.productId ?? undefined,
    description: i.description ?? undefined,
    locationId: i.locationId ?? undefined,
    quantity: Number(i.quantity),
    unitPrice: Number(i.unitPrice),
    discountType: i.discountType ?? undefined,
    discountValue: i.discountValue != null ? Number(i.discountValue) : undefined,
    taxRateIds: [] as string[],
  }));

  try {
    return await this.prisma.$transaction(async (tx) => {
      const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
        await this.pricing.priceLines(organizationId, items, tx);
      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          userId,
          locationId: order.locationId,
          format: 'A4',
          customerName: order.customerName,
          customerId: order.customerId,
          salesOrderId: order.id,
          invoiceDate: new Date(),
          status: 'DRAFT',
          subtotal,
          discount: discountAmount,
          taxAmount,
          total: this.round2(subtotal - discountAmount + taxAmount),
          items: { create: lines.map((l) => ({
            productId: l.productId, description: l.description, locationId: l.locationId,
            quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost,
            lineTotal: l.lineTotal,
            discountType: l.discountType, discountValue: l.discountValue,
            discountAmount: l.discountAmount, netAmount: l.netAmount,
            taxAmount: l.taxAmount, total: l.total,
            taxes: { create: l.taxes },
          })) },
          taxes: { create: taxLines },
        },
        include: { items: true, customer: true, taxes: true },
      });
      return invoice;
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      (err.meta?.target as string[] | undefined)?.includes('salesOrderId')
    ) {
      throw new BadRequestException('This sales order has already been invoiced');
    }
    throw err;
  }
}

private async applyOdometerReading(
    tx: Prisma.TransactionClient,
    organizationId: string,
    vehicleId: string,
    odometer: number,
  ): Promise<void> {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: vehicleId, organizationId },
      select: { odometer: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (vehicle.odometer != null && odometer < vehicle.odometer) {
      throw new BadRequestException(
        `Odometer (${odometer} km) cannot be lower than the vehicle's current reading (${vehicle.odometer} km)`,
      );
    }
    await tx.vehicle.update({
      where: { id: vehicleId },
      data: { odometer },
    });
  }
}