import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantOwnershipService } from '../shared/documents/tenant-ownership.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { PrintTokenService } from '../common/print/print-token.service';
import { ProductService } from '../product/product.service';
import { Prisma, PurchaseOrderStatus, PurchaseOrderActivityEventType } from '@prisma/client';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderDto, NewProductDto } from './dto/purchase-order.dto';
import puppeteer from 'puppeteer';

export type PurchaseOrderPrintView = {
  id: string;
  poNumber: string | null;
  status: string;

  businessName: string;
  businessLegalName: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessLogoUrl: string | null;

  locationName: string;
  locationAddress: string | null;

  supplierName: string | null;
  supplierAddress: string | null;
  supplierPhone: string | null;
  supplierNpwp: string | null;

  orderDate: Date;
  expectedDate: Date | null;
  notes: string | null;

  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;

  taxName: string | null;
  taxPercentage: number | null;

  items: {
    id: string;
    productName: string;
    sku: string | null;
    quantity: number;
    unitCost: number;
    lineTotal: number;
  }[];
};

type ResolvedPoItem = { productId: string; quantity: number; unitCost: number };
type CreatedProductSummary = { productId: string; name: string; sku: string };

@Injectable()
export class PurchaseOrderService {
  constructor(
    private prisma: PrismaService,
    private tenantOwnership: TenantOwnershipService,
    private numbering: DocumentNumberingService,
    private printTokenService: PrintTokenService,
    private productService: ProductService,
  ) {}

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  private priceLines(items: ResolvedPoItem[]) {
    let subtotal = 0;
    const lines = items.map((i) => {
      if (i.quantity <= 0) throw new BadRequestException('Quantity must be positive');
      if (i.unitCost < 0) throw new BadRequestException('Unit cost cannot be negative');
      const lineTotal = this.round2(i.quantity * i.unitCost);
      subtotal = this.round2(subtotal + lineTotal);
      return { productId: i.productId, quantity: i.quantity, unitCost: i.unitCost, lineTotal };
    });
    return { lines, subtotal };
  }

  private async computeTotals(
    organizationId: string,
    subtotal: number,
    discountAmount = 0,
    taxRateId: string | null | undefined,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    if (discountAmount < 0) throw new BadRequestException('Discount cannot be negative');
    if (discountAmount > subtotal) throw new BadRequestException('Discount cannot exceed subtotal');

    let taxAmount = 0;
    if (taxRateId) {
      const taxRate = await tx.organizationTaxRate.findFirst({
        where: { id: taxRateId, organizationId, archivedAt: null },
      });
      if (!taxRate) throw new NotFoundException('Tax rate not found');
      taxAmount = this.round2((subtotal - discountAmount) * (Number(taxRate.percentage) / 100));
    }

    const total = this.round2(subtotal - discountAmount + taxAmount);
    return { discountAmount, taxRateId: taxRateId ?? null, taxAmount, total };
  }

  private async resolvePoItems(
    organizationId: string,
    items: { productId?: string; newProduct?: NewProductDto; quantity: number; unitCost: number }[],
    tx: Prisma.TransactionClient,
  ): Promise<{ lines: ResolvedPoItem[]; createdProducts: CreatedProductSummary[] }> {
    const existingIds = items.filter((i) => i.productId).map((i) => i.productId!);
    if (existingIds.length) {
      const found = await tx.product.findMany({
        where: { id: { in: existingIds }, organizationId },
        select: { id: true },
      });
      const foundSet = new Set(found.map((p) => p.id));
      const missing = [...new Set(existingIds)].filter((id) => !foundSet.has(id));
      if (missing.length) {
        throw new NotFoundException(`Product(s) not found: ${missing.join(', ')}`);
      }
    }

    const lines: ResolvedPoItem[] = [];
    const createdProducts: CreatedProductSummary[] = [];

    for (const item of items) {
      if (item.productId && item.newProduct) {
        throw new BadRequestException('An item cannot have both productId and newProduct');
      }
      if (!item.productId && !item.newProduct) {
        throw new BadRequestException('Each item must reference an existing product or include newProduct details');
      }

      if (item.productId) {
        lines.push({ productId: item.productId, quantity: item.quantity, unitCost: item.unitCost });
        continue;
      }

      const product = await this.productService.create(organizationId, item.newProduct!, tx);
      if (!product.sku) {
        // ProductService.create() enforces SKU is required, but the schema
        // still types it nullable — guard here until that's tightened.
        throw new BadRequestException(`Product "${product.name}" was created without a SKU`);
      }
      createdProducts.push({ productId: product.id, name: product.name, sku: product.sku });
      lines.push({ productId: product.id, quantity: item.quantity, unitCost: item.unitCost });
    }

    return { lines, createdProducts };
  }

  // ---- activity log ---------------------------------------------------

  private async logActivity(
    tx: Prisma.TransactionClient,
    params: {
      purchaseOrderId: string;
      poNumber: string | null;
      organizationId: string;
      userId: string;
      eventType: PurchaseOrderActivityEventType;
      reason?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    return tx.purchaseOrderActivityEvent.create({
      data: {
        purchaseOrderId: params.purchaseOrderId,
        poNumber: params.poNumber,
        organizationId: params.organizationId,
        userId: params.userId,
        eventType: params.eventType,
        reason: params.reason,
        metadata: params.metadata,
      },
    });
  }

  async getActivityHistory(organizationId: string, purchaseOrderId: string) {
    return this.prisma.purchaseOrderActivityEvent.findMany({
      where: { purchaseOrderId, organizationId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  // ---- create / update ---------------------------------------------------
  private async validateSupplier(
    organizationId: string,
    supplierId: string | null | undefined,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    if (!supplierId) return;
    const supplier = await tx.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!supplier) throw new NotFoundException('Supplier not found');
  }
  async create(organizationId: string, userId: string, dto: CreatePurchaseOrderDto) {
    await this.tenantOwnership.validate(organizationId, { locationId: dto.locationId });
    if (!dto.items?.length) throw new BadRequestException('Purchase order must have at least one item');

    return this.prisma.$transaction(async (tx) => {
      await this.validateSupplier(organizationId, dto.supplierId, tx);
      const { lines: resolvedItems, createdProducts } = await this.resolvePoItems(organizationId, dto.items, tx);
      const { lines, subtotal } = this.priceLines(resolvedItems);
      const { discountAmount, taxRateId, taxAmount, total } = await this.computeTotals(
        organizationId, subtotal, dto.discountAmount, dto.taxRateId, tx,
      );

      const po = await tx.purchaseOrder.create({
        data: {
          organizationId,
          userId,
          locationId: dto.locationId,
          supplierId: dto.supplierId,
          status: PurchaseOrderStatus.DRAFT,
          subtotal,
          discountAmount,
          taxRateId,
          taxAmount,
          total,
          notes: dto.notes,
          items: { create: lines },
        },
        include: { items: true },
      });

      await this.logActivity(tx, {
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        organizationId,
        userId,
        eventType: PurchaseOrderActivityEventType.CREATED,
        metadata: createdProducts.length ? { createdProducts } : undefined,
      });

      return po;
    });
  }

  async update(organizationId: string, id: string, userId: string, dto: UpdatePurchaseOrderDto) {
    const po = await this.getDraftOrThrow(organizationId, id);
    await this.tenantOwnership.validate(organizationId, { locationId: dto.locationId });

    return this.prisma.$transaction(async (tx) => {
      await this.validateSupplier(organizationId, dto.supplierId, tx);

      if (!dto.items) {
        const { discountAmount, taxRateId, taxAmount, total } = await this.computeTotals(
          organizationId,
          Number(po.subtotal),
          dto.discountAmount ?? Number(po.discountAmount),
          dto.taxRateId !== undefined ? dto.taxRateId : po.taxRateId,
          tx,
        );
        const updated = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            locationId: dto.locationId,
            supplierId: dto.supplierId,
            discountAmount,
            taxRateId,
            taxAmount,
            total,
          },
          include: { items: true },
        });

        await this.logActivity(tx, {
          purchaseOrderId: po.id,
          poNumber: po.poNumber,
          organizationId,
          userId,
          eventType: PurchaseOrderActivityEventType.EDITED,
        });

        return updated;
      }

      const { lines: resolvedItems, createdProducts } = await this.resolvePoItems(organizationId, dto.items, tx);
      const { lines, subtotal } = this.priceLines(resolvedItems);
      const { discountAmount, taxRateId, taxAmount, total } = await this.computeTotals(
        organizationId,
        subtotal,
        dto.discountAmount ?? Number(po.discountAmount),
        dto.taxRateId !== undefined ? dto.taxRateId : po.taxRateId,
        tx,
      );

      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
      const updated = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          locationId: dto.locationId ?? po.locationId,
          supplierId: dto.supplierId ?? po.supplierId,
          subtotal,
          discountAmount,
          taxRateId,
          taxAmount,
          total,
          items: { create: lines },
        },
        include: { items: true },
      });

      await this.logActivity(tx, {
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        organizationId,
        userId,
        eventType: PurchaseOrderActivityEventType.EDITED,
        metadata: createdProducts.length ? { createdProducts } : undefined,
      });

      return updated;
    });
  }

  async send(organizationId: string, id: string, userId: string) {
    const po = await this.getDraftOrThrow(organizationId, id);
    if (po.items.length === 0) throw new BadRequestException('Cannot send an empty purchase order');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const year = new Date().getFullYear();
        // TODO: still counts by createdAt, same known gap noted previously —
        // unrelated to this change, left as-is.
        const count = await tx.purchaseOrder.count({
          where: { organizationId, poNumber: { not: null }, createdAt: { gte: new Date(`${year}-01-01`) } },
        });
        const poNumber = await this.numbering.next({ prefix: 'PO', count, year });
        const updated = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: PurchaseOrderStatus.SENT, poNumber },
          include: { items: true },
        });

        await this.logActivity(tx, {
          purchaseOrderId: po.id,
          poNumber: updated.poNumber,
          organizationId,
          userId,
          eventType: PurchaseOrderActivityEventType.SENT,
        });

        return updated;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(
          'PO number assignment conflicted with a concurrent send — please retry',
        );
      }
      throw err;
    }
  }

  async cancel(organizationId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({ where: { id, organizationId } });
      if (!po) throw new NotFoundException('Purchase order not found');
      if (po.status !== PurchaseOrderStatus.DRAFT && po.status !== PurchaseOrderStatus.SENT) {
        throw new BadRequestException(`Cannot cancel a purchase order in ${po.status} status`);
      }
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: PurchaseOrderStatus.CANCELLED },
      });

      await this.logActivity(tx, {
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        organizationId,
        userId,
        eventType: PurchaseOrderActivityEventType.CANCELLED,
      });

      return updated;
    });
  }

  // ---- read (unchanged) ---------------------------------------------------

  async list(
    organizationId: string,
    filters: {
      status?: PurchaseOrderStatus;
      from?: string;
      to?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 20;

    const where: Prisma.PurchaseOrderWhereInput = { organizationId, status: filters.status };

    if (filters.from && filters.to) {
      const gte = new Date(filters.from);
      const lte = new Date(filters.to);
      lte.setHours(23, 59, 59, 999);
      where.createdAt = { gte, lte };
    }

    if (filters.search?.trim()) {
      const term = filters.search.trim();
      where.OR = [
        { poNumber: { contains: term, mode: 'insensitive' } },
        { supplier: { name: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          items: true,
          supplier: { select: { name: true } },
          location: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async getOne(organizationId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: { items: { include: { product: true } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  // ---- print / PDF (unchanged) ---------------------------------------------------

  async renderPdf(organizationId: string, id: string): Promise<Buffer> {
    const po = await this.getPrintViewOrThrow(organizationId, id);

    const printToken = this.printTokenService.sign({
      documentType: 'purchase-order',
      documentId: id,
      organizationId,
    });
    const printUrl = `${process.env.FRONTEND_URL}/print/purchase-orders/${id}?token=${printToken}`;

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

  verifyPrintToken(token: string, purchaseOrderId: string) {
    return this.printTokenService.verifyDocumentToken(token, 'purchase-order', purchaseOrderId);
  }

  async getPrintView(organizationId: string, id: string): Promise<PurchaseOrderPrintView> {
    const po = await this.getPrintViewOrThrow(organizationId, id);
    return this.mapForPrint(po);
  }

  private async getPrintViewOrThrow(organizationId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: {
        organization: { select: { name: true, legalName: true, address: true, phone: true, logoUrl: true } },
        location: { select: { name: true, address: true } },
        supplier: { select: { name: true, address: true, phone: true, npwp: true } },
        taxRate: { select: { name: true, percentage: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  private mapForPrint(po: any): PurchaseOrderPrintView {
    return {
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,

      businessName: po.organization.name,
      businessLegalName: po.organization.legalName,
      businessAddress: po.organization.address,
      businessPhone: po.organization.phone,
      businessLogoUrl: po.organization.logoUrl,

      locationName: po.location?.name ?? '',
      locationAddress: po.location?.address ?? null,

      supplierName: po.supplier?.name ?? null,
      supplierAddress: po.supplier?.address ?? null,
      supplierPhone: po.supplier?.phone ?? null,
      supplierNpwp: po.supplier?.npwp ?? null,

      orderDate: po.createdAt,
      expectedDate: po.expectedDate ?? null,
      notes: po.notes ?? null,

      subtotal: Number(po.subtotal),
      discountAmount: Number(po.discountAmount),
      taxAmount: Number(po.taxAmount),
      total: Number(po.total),

      taxName: po.taxRate?.name ?? null,
      taxPercentage: po.taxRate ? Number(po.taxRate.percentage) : null,

      // .product should always be present now, but keep the fallback —
      // legacy rows created before this change can still have
      // productId: null, and this must not throw for those.
      items: po.items.map((item: any) => ({
        id: item.id,
        productName: item.product?.name ?? 'Legacy custom item',
        sku: item.product?.sku ?? null,
        quantity: item.quantity,
        unitCost: Number(item.unitCost),
        lineTotal: Number(item.lineTotal),
      })),
    };
  }

  private async getDraftOrThrow(organizationId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, organizationId }, include: { items: true } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.DRAFT) throw new BadRequestException('Purchase order is no longer editable');
    return po;
  }
}