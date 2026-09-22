import { BadRequestException, Injectable, ForbiddenException, NotFoundException, } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { SessionsService } from '../sessions/sessions.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';
import { PrintTokenService } from '../common/print/print-token.service';
import { BankAccountResolverService } from '../bank-accounts/bank-account-resolver.service';
import { CreateDraftInvoiceDto, UpdateDraftInvoiceDto } from './dto/invoice.dto';
import {
  DeliveryOrderStatus,
  DocumentType,
  EventType,
  FulfillmentStatus,
  InvoiceActivityEventType,
  InvoiceStatus,
  JournalSourceType,
  ModuleKey,
  Prisma,
  SessionType,
} from '@prisma/client';
import { PaymentStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import puppeteer from 'puppeteer';
import { EditIssuedInvoiceDto } from './dto/edit-invoice.dto';
import { SalesQuotationService } from '../sales-quotation/sales-quotation.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { JournalService } from '../accounting/journal.service';

const MM_TO_PX = 96 / 25.4;

const PDF_VIEWPORT_PX: Record<string, { width: number; height: number }> = {
  THERMAL_58: { width: Math.round(58 * MM_TO_PX), height: Math.round(297 * MM_TO_PX) },
  RECEIPT: { width: Math.round(80 * MM_TO_PX), height: Math.round(297 * MM_TO_PX) },
  A5: { width: Math.round(210 * MM_TO_PX), height: Math.round(297 * MM_TO_PX) },
  A4: { width: Math.round(210 * MM_TO_PX), height: Math.round(297 * MM_TO_PX) },
};

// ---- InvoicePrintView type ----
export type InvoicePrintView = {
  id: string;
  format: string;
  salesOrderId: string | null;
  deliveryOrders: { id: string; doNumber: string | null; status: string }[];

  invoiceNumber: string | null;
  status: string;
  fulfillmentStatus: string;
  vehicleId: string | null;
  paymentStatus: string;
  vehiclePlateNumber: string | null;
  vehicleModel: string | null;
  vehicleVin: string | null;
  vehicleOdometer: number | null;
  businessAddress: string | null;
  businessPhone: string | null;
  customerPoNumber: string | null;

  employeeId: string | null;      // NEW
  employeeName: string | null;    // NEW

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
  creditedAmount: number;
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
    itemDiscount: number;
    itemTaxAmount: number;
    itemTotal: number;
    lineTotal: number;
    locationName: string;
    fulfilledQuantity: number;
  }[];

  payments: {
    id: string;
    amount: number;
    method: string;
    note: string | null;
    createdAt: Date;
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
      address: true,
      phone: true,
    },
  },
  location: { select: { name: true, address: true, phone: true } },
  customer: true,
  vehicle: true,
  employee: { select: { id: true, name: true, position: true } }, // NEW
  items: {
    include: {
      product: { select: { name: true, sku: true } },
      location: { select: { name: true } },
    },
  },
  taxes: { select: { name: true, percentage: true, amount: true } },
  deliveryOrders: { select: { id: true, doNumber: true, status: true } },
  payments: { orderBy: { createdAt: 'desc' } }, // FIX — lets the invoice detail page list/void individual payments
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
  private bankAccounts: BankAccountResolverService,
  private postingRules: PostingRulesService,
  private journal: JournalService,
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
    const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.vehicleId && dto.odometer != null) {
          await this.applyOdometerReading(tx, organizationId, dto.vehicleId, dto.odometer);
        }

        const bank = await this.bankAccounts.resolve(organizationId, dto.bankAccountId, tx);

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
            employeeId: dto.employeeId ?? null, // NEW
            customerPoNumber: dto.customerPoNumber ?? null,
            paymentTerms: dto.paymentTerms ?? null,
            notes: dto.notes ?? null,
            invoiceDate,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
            status: InvoiceStatus.DRAFT,
            bankAccountId: bank.bankAccountId,
            bankName: bank.bankName,
            bankAccountNumber: bank.bankAccountNumber,
            bankAccountName: bank.bankAccountName,
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
      try {
        return await this.prisma.$transaction(async (tx) => {
          const resolvedVehicleId = dto.vehicleId ?? invoice.vehicleId;
          if (resolvedVehicleId && dto.odometer != null) {
            await this.applyOdometerReading(tx, organizationId, resolvedVehicleId, dto.odometer);
          }

          const bank = dto.bankAccountId !== undefined
            ? await this.bankAccounts.resolve(organizationId, dto.bankAccountId, tx)
            : null;

          return tx.invoice.update({
            where: { id: invoice.id },
            data: {
              customerName: dto.customerName ?? invoice.customerName,
              customerId: dto.customerId ?? invoice.customerId,
              vehicleId: dto.vehicleId ?? invoice.vehicleId,
              employeeId: dto.employeeId !== undefined ? dto.employeeId : invoice.employeeId, // NEW
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
              ...(bank && {
                bankAccountId: bank.bankAccountId,
                bankName: bank.bankName,
                bankAccountNumber: bank.bankAccountNumber,
                bankAccountName: bank.bankAccountName,
              }),
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

        const bank = dto.bankAccountId !== undefined
          ? await this.bankAccounts.resolve(organizationId, dto.bankAccountId, tx)
          : null;

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
            employeeId: dto.employeeId !== undefined ? dto.employeeId : invoice.employeeId, // NEW
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
async issue(
  organizationId: string,
  invoiceId: string,
  issuedByUserId: string,
): Promise<InvoicePrintView & { sessionId: string | null }> {
  const invoice = await this.getDraftOrThrow(organizationId, invoiceId);
  if (invoice.items.length === 0) {
    throw new BadRequestException('Cannot print an empty invoice');
  }

  const enabledModules = await this.orgModulesService.getEnabledModules(organizationId);
  const hasWarehouseOps = enabledModules.includes(ModuleKey.WAREHOUSE_OPS);

  // A sales-order-sourced invoice whose goods already move through delivery
  // orders must not ALSO decrement stock / post COGS at issue time.
  const soHasDeliveries = invoice.salesOrderId
    ? (await this.prisma.deliveryOrder.count({
        where: {
          organizationId,
          salesOrderId: invoice.salesOrderId,
          status: { not: DeliveryOrderStatus.CANCELLED },
        },
      })) > 0
    : false;
  const ownedByDeliveryWorkflow = (hasWarehouseOps || soHasDeliveries) && !!invoice.salesOrderId;
  const decreasesStockHere = !hasWarehouseOps && !ownedByDeliveryWorkflow;

  if (decreasesStockHere) {
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
      const costedLines: {
        productId: string;
        quantity: number;
        unitCost: number | null;
        locationId: string | null;
      }[] = [];

      if (decreasesStockHere) {
        const claimed = await tx.invoice.updateMany({
          where: { id: invoice.id, organizationId, fulfillmentPath: null },
          data: { fulfillmentPath: 'DIRECT_ISSUE' },
        });
        if (claimed.count === 0) {
          throw new BadRequestException(
            'Cannot fulfill invoice directly — it is already assigned to another fulfillment path.',
          );
        }

        for (const item of invoice.items) {
          if (!item.productId) continue;
          const { fulfilledQuantity } = await this.stockService.fulfill(
            organizationId,
            item.productId,
            item.locationId as string,
            Number(item.quantity),
            issuedByUserId,
            { type: EventType.SALE, invoiceId: invoice.id },
            tx,
          );
          if (fulfilledQuantity > 0) {
            await tx.invoiceItem.update({
              where: { id: item.id },
              data: { fulfilledQuantity: { increment: fulfilledQuantity } },
            });
            // Actual fulfilled qty, not ordered: oversold units haven't shipped.
            costedLines.push({
              productId: item.productId,
              quantity: fulfilledQuantity,
              unitCost: item.unitCost != null ? Number(item.unitCost) : null,
              locationId: item.locationId,
            });
          }
        }
        await this.recomputeFulfillmentStatus(organizationId, invoice.id, tx);
      }

      const invoiceNumber = await this.nextInvoiceNumber(tx, organizationId);
      const invoiceDate = invoice.invoiceDate ?? new Date();

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: { invoiceDate, invoiceNumber },
        include: invoiceDetailInclude,
      });

      // Ledger: revenue/AR/tax now (after invoiceNumber is set, since the memo
      // reads it). COGS only for what actually left stock in this call.
      await this.postingRules.postInvoiceIssued(organizationId, invoice.id, tx);
      if (costedLines.length > 0) {
        await this.postingRules.postCogs(
          organizationId,
          {
            sourceId: `${invoice.id}:cogs:issue`,
            date: new Date(),
            memo: `COGS for invoice ${invoiceNumber}`,
            lines: costedLines,
          },
          tx,
        );
      }

      await tx.invoiceActivityEvent.create({
        data: {
          invoiceId: invoice.id,
          organizationId,
          userId: issuedByUserId,
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
  async recomputeFulfillmentStatus(
    organizationId: string,
    invoiceId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { items: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const physicalItems = invoice.items.filter((i) => i.productId);
    const totalQuantity = physicalItems.reduce((sum, i) => sum + Number(i.quantity), 0);
    const totalFulfilled = physicalItems.reduce((sum, i) => sum + Number(i.fulfilledQuantity), 0);

    const newStatus =
      totalQuantity === 0 || totalFulfilled >= totalQuantity
        ? FulfillmentStatus.FULFILLED
        : totalFulfilled > 0
        ? FulfillmentStatus.PARTIALLY_FULFILLED
        : FulfillmentStatus.UNFULFILLED;

    if (newStatus === invoice.fulfillmentStatus) return invoice;
    return tx.invoice.update({ where: { id: invoiceId }, data: { fulfillmentStatus: newStatus } });
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

        const viewport = PDF_VIEWPORT_PX[format] ?? PDF_VIEWPORT_PX.A4;
        await page.setViewport(viewport);

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
      fulfillmentStatus: invoice.fulfillmentStatus,
      format: invoice.format,
      salesOrderId: invoice.salesOrderId,
      deliveryOrders: invoice.deliveryOrders.map((d) => ({ id: d.id, doNumber: d.doNumber, status: d.status })),

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

      employeeId: invoice.employeeId ?? null,             // NEW
      employeeName: invoice.employee?.name ?? null,        // NEW

      businessName: invoice.organization.name,
      businessLegalName: invoice.organization.legalName,
      businessNpwp: invoice.organization.npwp,
      businessLogoUrl: invoice.organization.logoUrl,
      bankName: invoice.bankName,
      bankAccountNumber: invoice.bankAccountNumber,
      bankAccountName: invoice.bankAccountName,

      locationName: invoice.location?.name ?? '',
      locationAddress: invoice.location?.address ?? null,
      locationPhone: invoice.location?.phone ?? null,
      discountType: invoice.discountType,
      discountValue: invoice.discountValue != null ? toNumber(invoice.discountValue) : null,

      customerName: invoice.customer?.name ?? invoice.customerName,
      customerAddress: invoice.customer?.address ?? null,
      billingAddress: invoice.customer?.billingAddress ?? invoice.customer?.address ?? null,
      customerPhone: invoice.customer?.phone ?? null,
      customerNpwp: invoice.customer?.npwp ?? null,

      subtotal: toNumber(invoice.subtotal),
      discount: toNumber(invoice.discount),
      taxAmount: toNumber(invoice.taxAmount),
      total: toNumber(invoice.total),
      amountPaid: Number(invoice.amountPaid),
      creditedAmount: Number(invoice.creditedAmount),
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
        itemTotal: toNumber(item.netAmount),
        lineTotal: toNumber(item.lineTotal),
        locationName: item.location?.name ?? '',
        fulfilledQuantity: Number(item.fulfilledQuantity),
      })),

      payments: invoice.payments.map((p) => ({
        id: p.id,
        amount: toNumber(p.amount),
        method: p.method,
        note: p.note,
        createdAt: p.createdAt,
      })),
    };
  }

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

  private async nextInvoiceNumber(tx: Prisma.TransactionClient, organizationId: string) {
    const fromImportedSequence = await this.numbering.nextForOrganization(
      tx,
      organizationId,
      DocumentType.INVOICE,
    );
    if (fromImportedSequence) return fromImportedSequence;

    return this.numbering.nextSequential(tx, organizationId, 'INVOICE', 'INV');
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
        employee: { select: { id: true, name: true, position: true } }, // NEW — so the new-invoice edit page can preselect the picker
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

  const orgRaw = await this.prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      name: true,
      legalName: true,
      npwp: true,
      logoUrl: true,
      address: true,
      phone: true,
      bankAccounts: {
        where: { isDefault: true, archivedAt: null },
        take: 1,
        select: { bankName: true, accountNumber: true, accountName: true },
      },
    },
  });
  const defaultBank = orgRaw.bankAccounts[0];
  const organization = {
    name: orgRaw.name,
    legalName: orgRaw.legalName,
    npwp: orgRaw.npwp,
    logoUrl: orgRaw.logoUrl,
    address: orgRaw.address,
    phone: orgRaw.phone,
    bankName: defaultBank?.bankName ?? null,
    bankAccountNumber: defaultBank?.accountNumber ?? null,
    bankAccountName: defaultBank?.accountName ?? null,
  };

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
      select: { total: true, amountPaid: true, creditedAmount: true },
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
        creditedAmount: true,
        vehicleId: true,
        vehicle: { select: { plateNumber: true, vehicleModel: true } },
      },
      orderBy: { issuedAt: 'asc' },
    }),
  ]);

  // amountPaid is Decimal now; normalise once.
  const paid = (inv: { amountPaid: Decimal }) => Number(inv.amountPaid);
  // FIX — same reconciliation gap as getARAging: without this, a returned
  // invoice keeps showing a balance for units the customer no longer owes
  // for on their statement.
  const credited = (inv: { creditedAmount: Decimal }) => Number(inv.creditedAmount);

  const openingBalance = this.round2(
    priorInvoices.reduce((sum, inv) => sum + (Number(inv.total) - paid(inv) - credited(inv)), 0),
  );
  const periodInvoiced = this.round2(
    periodInvoices.reduce((sum, inv) => sum + Number(inv.total), 0),
  );
  const periodPaidAsOfNow = this.round2(
    periodInvoices.reduce((sum, inv) => sum + paid(inv), 0),
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
      paidToDate: paid(inv),
      balance: this.round2(Number(inv.total) - paid(inv) - credited(inv)),
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
        employee: { select: { id: true, name: true, position: true } }, // NEW
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

  if (invoice.paymentStatus !== PaymentStatus.UNPAID) {
    throw new BadRequestException(
      'Cannot edit items on an invoice that has payments recorded. Void and reissue instead.',
    );
  }

  const enabledModules = await this.orgModulesService.getEnabledModules(organizationId);
  const hasWarehouseOps = enabledModules.includes(ModuleKey.WAREHOUSE_OPS);

  const keyOf = (i: { productId: string | null; description: string | null }) =>
    i.productId ? `p:${i.productId}` : `s:${i.description}`;

  const oldItemByKey = new Map(invoice.items.map((i) => [keyOf(i), i]));

  const updated = await this.prisma.$transaction(async (tx) => {
    const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
      await this.pricing.priceLines(organizationId, dto.items, tx, {
        requireLocationForProducts: !hasWarehouseOps,
      });
    const newTotal = this.round2(subtotal - discountAmount + taxAmount);

    if (invoice.vehicleId && dto.odometer != null) {
      await this.applyOdometerReading(tx, organizationId, invoice.vehicleId, dto.odometer);
    }

    const bank = dto.bankAccountId !== undefined
      ? await this.bankAccounts.resolve(organizationId, dto.bankAccountId, tx)
      : null;

    const session = hasWarehouseOps
      ? await tx.session.findFirst({ where: { invoiceId: invoice.id, organizationId } })
      : null;

    const demandChanges: { label: string; before: number; after: number }[] = [];
    const carriedFulfilledByLineIndex = new Map<number, number>();
    const unitCostByLineIndex = new Map<number, number | null>();

    for (let idx = 0; idx < lines.length; idx++) {
      const l = lines[idx];
      if (!l.productId) continue;

      const key = keyOf(l);
      const oldItem = oldItemByKey.get(key);
      // Preserve the cost basis already locked in when this line's units
      // were fulfilled — re-pricing to today's product.costPrice would
      // silently rewrite historical COGS for units that already shipped.
      const oldUnitCost = oldItem?.unitCost != null ? Number(oldItem.unitCost) : null;
      unitCostByLineIndex.set(idx, oldUnitCost ?? l.unitCost);
      const oldFulfilled = oldItem ? Number(oldItem.fulfilledQuantity) : 0;
      const oldQty = oldItem ? Number(oldItem.quantity) : 0;

      if (l.quantity < oldFulfilled) {
        throw new BadRequestException(
          `Cannot reduce "${l.description ?? key}" to ${l.quantity} — ${oldFulfilled} unit(s) are already fulfilled. Process a return instead.`,
        );
      }

      if (hasWarehouseOps && l.quantity !== oldQty) {
        demandChanges.push({ label: l.description ?? key, before: oldQty, after: l.quantity });
      }

      let fulfilledForThisLine = oldFulfilled;

      if (!hasWarehouseOps) {
        const addedDemand = l.quantity - oldQty;
        if (addedDemand > 0) {
          const { fulfilledQuantity } = await this.stockService.fulfill(
            organizationId, l.productId, l.locationId!, addedDemand, userId,
            { type: EventType.SALE, invoiceId: invoice.id }, tx,
          );
          fulfilledForThisLine += fulfilledQuantity;
        }
      }

      carriedFulfilledByLineIndex.set(idx, fulfilledForThisLine);
    }

    const newKeys = new Set(lines.filter((l) => l.productId).map((l) => keyOf(l)));
    for (const item of invoice.items) {
      if (!item.productId) continue;
      if (newKeys.has(keyOf(item))) continue;

      if (hasWarehouseOps) {
        // A line with fulfilled units can't just be dropped — the same
        // rule as the quantity-reduction check above (l.quantity <
        // oldFulfilled). Deleting it outright would silently sever the
        // DeliveryOrderItem.invoiceItemId link (SetNull on delete) for
        // stock that's already shipped, with no error and no journal
        // reversal.
        const fulfilled = Number(item.fulfilledQuantity);
        if (fulfilled > 0) {
          throw new BadRequestException(
            `Cannot remove "${item.product?.name ?? item.description ?? keyOf(item)}" — ${fulfilled} unit(s) are already fulfilled. Process a return instead.`,
          );
        }
        demandChanges.push({
          label: item.product?.name ?? item.description ?? keyOf(item),
          before: Number(item.quantity),
          after: 0,
        });
        continue;
      }

      if (!item.locationId) continue;

      const fulfilled = Number(item.fulfilledQuantity);
      if (fulfilled > 0) {
        await this.stockService.increase(
          organizationId, item.productId, item.locationId, fulfilled, userId,
          { type: EventType.ADJUSTMENT, invoiceId: invoice.id }, tx,
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
        employeeId: dto.employeeId !== undefined ? dto.employeeId : invoice.employeeId,
        ...(bank && {
          bankAccountId: bank.bankAccountId,
          bankName: bank.bankName,
          bankAccountNumber: bank.bankAccountNumber,
          bankAccountName: bank.bankAccountName,
        }),
        subtotal,
        taxAmount,
        discount: discountAmount,
        total: newTotal, // FIX — was never written, leaving invoice.total stale after every edit
        items: {
          create: lines.map((l, idx) => ({
            productId: l.productId,
            description: l.description,
            locationId: l.locationId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            unitCost: unitCostByLineIndex.get(idx) ?? l.unitCost,
            unit: l.unit,
            lineTotal: l.lineTotal,
            discountType: l.discountType,
            discountValue: l.discountValue,
            discountAmount: l.discountAmount,
            netAmount: l.netAmount,
            taxAmount: l.taxAmount,
            total: l.total,
            fulfilledQuantity: carriedFulfilledByLineIndex.get(idx) ?? 0,
            taxes: { create: l.taxes },
          })),
        },
        taxes: { create: taxLines },
      },
      include: invoiceDetailInclude,
    });

    await this.recomputeFulfillmentStatus(organizationId, invoice.id, tx);

    // NEW — repost. Only if this invoice was ever posted; invoices issued
    // before ledger posting existed have no entry and stay out of the ledger.
    const priorRevenue = await this.journal.findPostedBySource(
      organizationId, JournalSourceType.INVOICE, invoice.id, tx,
    );

    if (priorRevenue) {
      const voidReason = `Invoice edited: ${dto.reason.trim()}`;
      await this.journal.voidEntry(organizationId, priorRevenue.id, userId, voidReason, tx);
      await this.postingRules.postInvoiceIssued(organizationId, invoice.id, tx);

      // Warehouse-ops orgs post COGS at pick/ship, so edits never touch it.
      if (!hasWarehouseOps) {
        const cogsSourceId = `${invoice.id}:cogs:issue`;
        const priorCogs = await this.journal.findPostedBySource(
          organizationId, JournalSourceType.INVOICE, cogsSourceId, tx,
        );
        if (priorCogs) {
          await this.journal.voidEntry(organizationId, priorCogs.id, userId, voidReason, tx);
        }

        const costedLines = result.items
          .filter((i) => i.productId && Number(i.fulfilledQuantity) > 0)
          .map((i) => ({
            productId: i.productId!,
            quantity: Number(i.fulfilledQuantity),
            unitCost: i.unitCost != null ? Number(i.unitCost) : null,
            locationId: i.locationId,
          }));

        if (costedLines.length > 0) {
          await this.postingRules.postCogs(
            organizationId,
            {
              sourceId: cogsSourceId,
              date: new Date(),
              memo: `COGS for invoice ${invoice.invoiceNumber ?? invoice.id} (edited)`,
              lines: costedLines,
            },
            tx,
          );
        }
      }
    }

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

    if (session && demandChanges.length > 0) {
      const summary = demandChanges
        .map((c) => `${c.label}: ${c.before} → ${c.after}${c.after === 0 ? ' (removed)' : ''}`)
        .join('; ');
      await tx.sessionNote.create({
        data: {
          sessionId: session.id,
          note: `Invoice edited — demand changed: ${summary}`,
          userId,
        },
      });
    }

    return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: invoiceDetailInclude });
  });

  return this.mapInvoiceForPrint(updated);
}
  private buildEditDiff(
    oldItems: {
      productId: string | null;
      description: string | null;
      quantity: number;
      unitPrice: any;
      discountAmount: any;
      product?: { name: string } | null;
    }[],
    newItems: {
      productId: string | null;
      description: string | null;
      quantity: number;
      unitPrice: number;
      discountAmount: number;
    }[],
    productNames: Map<string, string>,
  ): { label: string; before: string; after: string }[] {
    const keyOf = (i: { productId: string | null; description: string | null }) =>
      i.productId ? `p:${i.productId}` : `s:${i.description}`;
    const labelOf = (i: { productId: string | null; description: string | null; product?: { name: string } | null }) =>
      i.productId ? (i.product?.name ?? productNames.get(i.productId) ?? 'Unknown product') : (i.description ?? 'Service');

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
      'Cannot void an invoice with payments recorded. Void the payment(s) first.',
    );
  }

  return this.prisma.$transaction(async (tx) => {
    // ---- Block on anything physically shipped ------------------------
    // A SalesOrder-sourced DeliveryOrder never sets deliveryOrder.invoiceId
    // (see DeliveryOrderService.create()) — it only carries
    // DeliveryOrderItem.salesOrderItemId, which lines up with
    // InvoiceItem.salesOrderItemId for whichever invoice was drafted from
    // that SO line. Filtering on invoiceId alone let those shipped DOs slip
    // past this guard, leaving their COGS permanently unreversed once the
    // invoice was voided.
    const invoiceSalesOrderItemIds = invoice.items
      .map((item) => item.salesOrderItemId)
      .filter((id): id is string => !!id);

    const shippedCount = await tx.deliveryOrder.count({
      where: {
        organizationId,
        status: { in: [DeliveryOrderStatus.SHIPPED, DeliveryOrderStatus.PARTIALLY_RETURNED] },
        OR: [
          { invoiceId: invoice.id },
          ...(invoiceSalesOrderItemIds.length > 0
            ? [{ items: { some: { salesOrderItemId: { in: invoiceSalesOrderItemIds } } } }]
            : []),
        ],
      },
    });
    if (shippedCount > 0) {
      throw new BadRequestException(
        `Cannot void — this invoice has ${shippedCount} shipped delivery order(s). Process a return on each before voiding.`,
      );
    }

    // ---- Block on anything physically picked --------------------------
    // A SessionItem row and its stock decrement are written in the same
    // transaction (SessionsService.addItem()'s PICK case) — there's no
    // "reserved but not yet picked" state in this schema, so item count
    // > 0 for a FULFILLMENT session means stock already moved. If
    // addItem() is ever refactored to decouple reserving a line from
    // committing the pick, this check needs to move to whatever field
    // tracks the commit, not the line count.
    const session = await tx.session.findFirst({
      where: { invoiceId: invoice.id, organizationId },
      include: { _count: { select: { items: true } } },
    });
    if (session && session._count.items > 0) {
      throw new BadRequestException(
        'Cannot void — fulfillment has already started on this invoice\'s session. Resolve the session first.',
      );
    }

    // ---- Nothing shipped/picked: safe to cancel remaining reservations --
    if (session) {
      await tx.session.update({ where: { id: session.id }, data: { status: 'CANCELLED' } });
    }

    // Same invoiceId-only blind spot as the shipped guard above: a
    // SalesOrder-sourced PACKED DO carries no deliveryOrder.invoiceId, so it
    // needs the same salesOrderItemId-based match to be found and cancelled.
    const invoiceItemIdBySalesOrderItemId = new Map(
      invoice.items
        .filter((item): item is typeof item & { salesOrderItemId: string } => !!item.salesOrderItemId)
        .map((item) => [item.salesOrderItemId, item.id]),
    );

    const packedDeliveryOrders = await tx.deliveryOrder.findMany({
      where: {
        organizationId,
        status: DeliveryOrderStatus.PACKED,
        OR: [
          { invoiceId: invoice.id },
          ...(invoiceSalesOrderItemIds.length > 0
            ? [{ items: { some: { salesOrderItemId: { in: invoiceSalesOrderItemIds } } } }]
            : []),
        ],
      },
      include: { items: true },
    });
    for (const d of packedDeliveryOrders) {
      for (const item of d.items) {
        const invoiceItemId =
          item.invoiceItemId ??
          (item.salesOrderItemId ? invoiceItemIdBySalesOrderItemId.get(item.salesOrderItemId) : undefined);
        if (invoiceItemId) {
          await tx.invoiceItem.update({
            where: { id: invoiceItemId },
            data: { reservedQuantity: { decrement: Number(item.quantity) } },
          });
        }
      }
      await tx.deliveryOrder.update({ where: { id: d.id }, data: { status: DeliveryOrderStatus.CANCELLED } });
    }

    // ---- Reverse stock only for the path that decremented it directly --
    // fulfillmentPath === 'DIRECT_ISSUE' precisely identifies "issue()
    // itself decremented stock for this invoice" — more precise than
    // re-deriving hasWarehouseOps/ownedByDeliveryWorkflow here, since
    // those two booleans were only ever meant to decide behavior at
    // issue() time, not to be recomputed later.
    if (invoice.fulfillmentPath === 'DIRECT_ISSUE') {
      for (const item of invoice.items) {
        if (!item.productId || !item.locationId) continue;
        const fulfilled = Number(item.fulfilledQuantity);
        if (fulfilled <= 0) continue;
        await this.stockService.increase(
          organizationId, item.productId, item.locationId, fulfilled, userId,
          { type: EventType.ADJUSTMENT, invoiceId: invoice.id }, tx,
        );
      }
    }

    // ---- Reverse the invoice's own ledger entries ----------------------
    // Anything shipped/picked was already refused above, so these two
    // sourceIds are the only COGS-bearing entries a voidable invoice can
    // have at this point.
    await this.journal.voidAllForSource(
      organizationId,
      JournalSourceType.INVOICE,
      this.postingRules.invoiceJournalSourceIds(invoice.id),
      userId,
      `Invoice voided: ${reason.trim()}`,
      tx,
    );

    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.VOID },
      include: invoiceDetailInclude,
    });

    if (invoice.quotationId) {
      await this.quotationService.reopenIfConverted(
        organizationId, invoice.quotationId, userId, reason.trim(), tx,
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
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the quotation row for the duration of this transaction so a
        // concurrent conversion (to a sales order via
        // SalesOrderService.createFromQuotation, which takes the same
        // lock, or to another invoice) against the same quotation can't
        // both pass the "not yet converted / not yet invoiced" checks
        // below. There is no DB unique constraint backing the P2002 catch
        // further down — this lock is what actually closes the race.
        await tx.$queryRaw`SELECT id FROM "SalesQuotation" WHERE id = ${quotationId} FOR UPDATE`;

        const quotation = await tx.salesQuotation.findFirst({
          where: { id: quotationId, organizationId },
          include: { items: true, invoices: { select: { id: true, status: true } } },
        });
        if (!quotation) throw new NotFoundException('Quotation not found');

        const invoiceableStatuses = ['SENT', 'ACCEPTED', 'CONVERTED'];
        if (!invoiceableStatuses.includes(quotation.status)) {
          throw new BadRequestException('Only a sent, accepted, or converted quotation can be invoiced');
        }
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
            bankAccountId: quotation.bankAccountId,
            bankName: quotation.bankName,
            bankAccountNumber: quotation.bankAccountNumber,
            bankAccountName: quotation.bankAccountName,
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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('This quotation has already been invoiced');
      }
      throw err;
    }
  }

  async createDraftFromSalesOrder(organizationId: string, userId: string, salesOrderId: string) {
    const enabledModules = await this.orgModulesService.getEnabledModules(organizationId);
    const hasWarehouseOps = enabledModules.includes(ModuleKey.WAREHOUSE_OPS);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the sales order row for the duration of this transaction so
        // two concurrent createDraftFromSalesOrder() calls against the
        // same order can't both pass the "not yet invoiced" check below.
        // There is no DB unique constraint backing the P2002 catch further
        // down — this lock is what actually closes the race.
        await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE id = ${salesOrderId} FOR UPDATE`;

        const order = await tx.salesOrder.findFirst({
          where: { id: salesOrderId, organizationId },
          include: { items: true, invoices: { select: { id: true } } },
        });
        if (!order) throw new NotFoundException('Sales order not found');

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

        const { items: lines, subtotal, discountAmount, taxAmount, taxLines } =
          await this.pricing.priceLines(organizationId, items, tx);
        const bank = await this.bankAccounts.resolve(organizationId, undefined, tx);
        const invoice = await tx.invoice.create({
          data: {
            organizationId,
            userId,
            locationId: order.locationId,
            format: 'A4',
            customerName: order.customerName,
            customerId: order.customerId,
            salesOrderId: order.id,
            bankAccountId: bank.bankAccountId,
            bankName: bank.bankName,
            bankAccountNumber: bank.bankAccountNumber,
            bankAccountName: bank.bankAccountName,
            invoiceDate: new Date(),
            status: 'DRAFT',
            subtotal,
            discount: discountAmount,
            taxAmount,
            total: this.round2(subtotal - discountAmount + taxAmount),
            // lines[idx] corresponds 1:1 with order.items[idx] — priceLines()
            // maps its `items` input to `items` output in the same order —
            // so salesOrderItemId can be carried forward positionally. This
            // is what lets DeliveryOrderService.resolveInvoiceItemForReturn()
            // find the invoice item for a sales-order-sourced return, and
            // what lets voidInvoice() detect already-shipped lines before
            // allowing a void.
            items: { create: lines.map((l, idx) => ({
              productId: l.productId, description: l.description, locationId: l.locationId,
              quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost,
              lineTotal: l.lineTotal,
              discountType: l.discountType, discountValue: l.discountValue,
              discountAmount: l.discountAmount, netAmount: l.netAmount,
              taxAmount: l.taxAmount, total: l.total,
              salesOrderItemId: order.items[idx].id,
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