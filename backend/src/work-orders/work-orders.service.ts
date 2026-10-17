import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceFormat, InvoiceStatus, Prisma, WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';
import { InvoiceService } from '../invoice/invoice.service';
import {
  CreateWorkOrderDto,
  UpdateWorkOrderDto,
  WorkOrderLineInput,
} from './dto/work-order.dto';

const DETAIL_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  vehicle: { select: { id: true, plateNumber: true, vehicleModel: true, odometer: true } },
  mechanic: { select: { id: true, name: true } },
  items: {
    orderBy: { sortOrder: 'asc' },
    include: { product: { select: { id: true, name: true, sku: true, sellingPrice: true } } },
  },
  // Voided invoices stay listed so the history is visible, but only a
  // non-void one counts as "invoiced" (see invoicedId below).
  invoices: {
    orderBy: { createdAt: 'desc' },
    select: { id: true, invoiceNumber: true, status: true, total: true, createdAt: true },
  },
} satisfies Prisma.WorkOrderInclude;

type WorkOrderDetail = Prisma.WorkOrderGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function withInvoiced(wo: WorkOrderDetail) {
  const live = wo.invoices.find((inv) => inv.status !== InvoiceStatus.VOID);
  return { ...wo, invoicedId: live?.id ?? null };
}

// Job cards for the workshop: a vehicle checks in, a mechanic works
// through QUEUED → IN_PROGRESS (→ WAITING_PARTS) → DONE, and the job
// becomes a draft invoice. Only available while the org has turned
// workOrdersEnabled on — otherwise workshops invoice vehicles directly.
@Injectable()
export class WorkOrdersService {
  constructor(
    private prisma: PrismaService,
    private numbering: DocumentNumberingService,
    private pricing: LineItemPricingService,
    private invoices: InvoiceService,
  ) {}

  async isEnabled(organizationId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { workOrdersEnabled: true },
    });
    return org?.workOrdersEnabled ?? false;
  }

  private async assertEnabled(organizationId: string) {
    if (!(await this.isEnabled(organizationId))) {
      throw new ForbiddenException('Work orders are turned off — an admin can turn them on in Settings');
    }
  }

  async mechanics(organizationId: string) {
    await this.assertEnabled(organizationId);
    return this.prisma.employee.findMany({
      where: { organizationId, archivedAt: null, isActive: true },
      select: { id: true, name: true, position: true },
      orderBy: { name: 'asc' },
    });
  }

  async list(organizationId: string, filters: { status?: string; q?: string; vehicleId?: string }) {
    await this.assertEnabled(organizationId);
    const status =
      filters.status && (Object.values(WorkOrderStatus) as string[]).includes(filters.status)
        ? (filters.status as WorkOrderStatus)
        : undefined;
    const q = filters.q?.trim();
    const rows = await this.prisma.workOrder.findMany({
      where: {
        organizationId,
        ...(status && { status }),
        ...(filters.vehicleId && { vehicleId: filters.vehicleId }),
        ...(q && {
          OR: [
            { number: { contains: q, mode: 'insensitive' } },
            { vehicle: { plateNumber: { contains: q, mode: 'insensitive' } } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: DETAIL_INCLUDE,
    });
    return rows.map(withInvoiced);
  }

  async getOne(organizationId: string, id: string) {
    await this.assertEnabled(organizationId);
    const wo = await this.prisma.workOrder.findFirst({ where: { id, organizationId }, include: DETAIL_INCLUDE });
    if (!wo) throw new NotFoundException('Work order not found');
    return withInvoiced(wo);
  }

  async create(organizationId: string, userId: string, dto: CreateWorkOrderDto) {
    await this.assertEnabled(organizationId);
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: dto.vehicleId, organizationId },
      select: { id: true, customerId: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (dto.mechanicId) await this.assertMechanic(organizationId, dto.mechanicId);
    const items = dto.items ?? [];
    const estimatedTotal = await this.estimate(organizationId, items, vehicle.customerId, userId);

    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.odometer != null) await this.applyOdometer(tx, organizationId, vehicle.id, dto.odometer);
      const number = await this.numbering.nextSequential(tx, organizationId, 'WORK_ORDER', 'WO');
      return tx.workOrder.create({
        data: {
          organizationId,
          number,
          customerId: vehicle.customerId,
          vehicleId: vehicle.id,
          mechanicId: dto.mechanicId ?? null,
          odometer: dto.odometer ?? null,
          complaint: dto.complaint?.trim() || null,
          notes: dto.notes?.trim() || null,
          estimatedTotal,
          createdById: userId,
          items: { create: items.map(toItemData) },
        },
        select: { id: true },
      });
    });
    return this.getOne(organizationId, created.id);
  }

  async update(organizationId: string, userId: string, id: string, dto: UpdateWorkOrderDto) {
    const wo = await this.getEditable(organizationId, id);
    if (dto.mechanicId) await this.assertMechanic(organizationId, dto.mechanicId);
    const estimatedTotal =
      dto.items !== undefined ? await this.estimate(organizationId, dto.items, wo.customerId, userId) : undefined;

    await this.prisma.$transaction(async (tx) => {
      // Same lock InvoiceService.createDraft() takes: an edit racing an
      // invoice must not change the lines after the invoice copied them.
      await tx.$queryRaw`SELECT id FROM "WorkOrder" WHERE id = ${id} FOR UPDATE`;
      const invoiced = await tx.invoice.count({
        where: { workOrderId: id, status: { not: InvoiceStatus.VOID } },
      });
      if (invoiced > 0) {
        throw new BadRequestException('This work order has been invoiced — void the invoice to change it');
      }
      if (dto.odometer != null && dto.odometer !== wo.odometer) {
        await this.applyOdometer(tx, organizationId, wo.vehicleId, dto.odometer);
      }
      if (dto.items !== undefined) {
        await tx.workOrderItem.deleteMany({ where: { workOrderId: id } });
      }
      await tx.workOrder.update({
        where: { id },
        data: {
          ...(dto.mechanicId !== undefined && { mechanicId: dto.mechanicId }),
          ...(dto.odometer !== undefined && { odometer: dto.odometer }),
          ...(dto.complaint !== undefined && { complaint: dto.complaint?.trim() || null }),
          ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
          ...(dto.items !== undefined && {
            estimatedTotal,
            items: { create: dto.items.map(toItemData) },
          }),
        },
      });
    });
    return this.getOne(organizationId, id);
  }

  async setStatus(organizationId: string, id: string, status: WorkOrderStatus) {
    const wo = await this.getEditable(organizationId, id, { allowCancelled: true });
    if (wo.status === status) return this.getOne(organizationId, id);
    const now = new Date();
    await this.prisma.workOrder.update({
      where: { id },
      data: {
        status,
        // First time work starts, and each time it's finished (a job
        // reopened from DONE gets a fresh completedAt when done again).
        ...(status === WorkOrderStatus.IN_PROGRESS && !wo.startedAt && { startedAt: now }),
        ...(status === WorkOrderStatus.DONE ? { completedAt: now } : { completedAt: null }),
      },
    });
    return this.getOne(organizationId, id);
  }

  // Makes a draft invoice from the job's lines. Product lines are priced
  // afresh by the invoice (today's price, the customer's level); labour
  // lines keep the price on the job card. The invoice side locks the work
  // order and refuses a second live invoice — see InvoiceService.createDraft().
  async createInvoice(organizationId: string, userId: string, id: string, format?: InvoiceFormat) {
    const wo = await this.getOne(organizationId, id);
    if (wo.items.length === 0) throw new BadRequestException('Add at least one part or labour line first');

    const firstPart = wo.items.find((i) => i.productId && i.locationId);
    const invoice = await this.invoices.createDraft(
      organizationId,
      userId,
      {
        format: format ?? InvoiceFormat.A4,
        customerId: wo.customerId,
        customerName: wo.customer.name,
        vehicleId: wo.vehicleId,
        // The car may have been back since and have a higher reading on
        // file; the invoice can't lower it, so the older reading is left
        // on the job card only.
        odometer:
          wo.odometer != null && (wo.vehicle.odometer == null || wo.odometer >= wo.vehicle.odometer)
            ? wo.odometer
            : undefined,
        employeeId: wo.mechanicId ?? undefined,
        locationId: firstPart?.locationId ?? undefined,
        notes: wo.complaint ? `${wo.number}: ${wo.complaint}` : wo.number,
        items: wo.items.map((i) => ({
          productId: i.productId ?? undefined,
          description: i.description ?? undefined,
          locationId: i.locationId ?? undefined,
          quantity: Number(i.quantity),
          unitPrice: i.unitPrice != null ? Number(i.unitPrice) : undefined,
        })),
      },
      { workOrderId: id },
    );
    return { invoiceId: invoice.id };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async getEditable(organizationId: string, id: string, opts: { allowCancelled?: boolean } = {}) {
    await this.assertEnabled(organizationId);
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, organizationId },
      include: { invoices: { where: { status: { not: InvoiceStatus.VOID } }, select: { id: true } } },
    });
    if (!wo) throw new NotFoundException('Work order not found');
    if (wo.invoices.length > 0) {
      throw new BadRequestException('This work order has been invoiced — void the invoice to change it');
    }
    if (wo.status === WorkOrderStatus.CANCELLED && !opts.allowCancelled) {
      throw new BadRequestException('This work order is cancelled — reopen it first');
    }
    return wo;
  }

  private async assertMechanic(organizationId: string, employeeId: string) {
    const found = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!found) throw new BadRequestException('Mechanic not found');
  }

  // Prices the lines exactly as the invoice would today, which also
  // validates them (products and locations in this org, labour price set).
  private async estimate(
    organizationId: string,
    items: WorkOrderLineInput[],
    customerId: string,
    userId: string,
  ): Promise<number> {
    if (items.length === 0) return 0;
    const { subtotal, discountAmount, taxAmount } = await this.pricing.priceLines(organizationId, items, undefined, {
      customerId,
      userId,
    });
    return Math.round((subtotal - discountAmount + taxAmount) * 100) / 100;
  }

  // Same rule as InvoiceService.applyOdometerReading: readings only go up.
  private async applyOdometer(
    tx: Prisma.TransactionClient,
    organizationId: string,
    vehicleId: string,
    odometer: number,
  ) {
    const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, organizationId }, select: { odometer: true } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (vehicle.odometer != null && odometer < vehicle.odometer) {
      throw new BadRequestException(
        `Odometer (${odometer} km) cannot be lower than the vehicle's current reading (${vehicle.odometer} km)`,
      );
    }
    await tx.vehicle.update({ where: { id: vehicleId }, data: { odometer } });
  }
}

function toItemData(line: WorkOrderLineInput, index: number) {
  return {
    productId: line.productId ?? null,
    description: line.productId ? null : line.description!.trim(),
    locationId: line.productId ? (line.locationId ?? null) : null,
    quantity: line.quantity,
    unitPrice: line.unitPrice ?? null,
    sortOrder: index,
  };
}
