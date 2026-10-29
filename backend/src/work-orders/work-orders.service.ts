import { randomBytes } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceFormat, InvoiceStatus, ModuleKey, Prisma, ReminderStatus, WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';
import { InvoiceService } from '../invoice/invoice.service';
import { SalesQuotationService } from '../sales-quotation/sales-quotation.service';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { resolveBranchId } from '../branches/resolve-branch';
import { normalizePlate } from '../lib/plate';
import { escapeLike } from '../common/text/escape-like';
import {
  CreateRecommendationDto,
  CreateWorkOrderDto,
  CreateWorkOrderFromQuotationDto,
  UpdateWorkOrderDto,
  AddWorkOrderLineDto,
  WorkOrderLineInput,
} from './dto/work-order.dto';

const DETAIL_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, companyName: true, npwp: true, address: true } },
  vehicle: {
    select: { id: true, plateNumber: true, vehicleModel: true, odometer: true, carBrand: true, carModel: true, carYear: true },
  },
  mechanic: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
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
  // Work recommended on this job for a later visit (vehicle reminders).
  recommendations: {
    where: { status: { not: ReminderStatus.DELETED } },
    orderBy: { dueDate: 'asc' },
    select: { id: true, note: true, dueDate: true, dueOdometer: true, status: true, followUpWorkOrderId: true },
  },
  // The reminder this job was started from, if any.
  followedUp: { select: { id: true, note: true, sourceWorkOrder: { select: { id: true, number: true } } } },
  // The earlier job this one redoes, and jobs that came back to redo this one.
  comebackOf: { select: { id: true, number: true, completedAt: true, mechanic: { select: { id: true, name: true } } } },
  comebacks: { select: { id: true, number: true, comebackReason: true, createdAt: true } },
  // The quotation it was made from, and any additional ones for parts found mid-job.
  quotations: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, quotationNumber: true, status: true, parentQuotationId: true },
  },
} satisfies Prisma.WorkOrderInclude;

type WorkOrderDetail = Prisma.WorkOrderGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function withInvoiced(wo: WorkOrderDetail) {
  const live = wo.invoices.find((inv) => inv.status !== InvoiceStatus.VOID);
  return { ...wo, invoicedId: live?.id ?? null };
}

// What the workshop board shows: jobs being worked on first, then waiting for parts, then queued.
const BOARD_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.WAITING_PARTS,
  WorkOrderStatus.QUEUED,
];

// Job cards for the workshop: a quotation (or a car checked straight in)
// becomes a job, a mechanic works through QUEUED → IN_PROGRESS
// (→ WAITING_PARTS) → DONE, and the job becomes a draft invoice. The
// customer's go-ahead is given on the quotation (see SalesQuotationService
// approval link). Only available while the org has turned
// workOrdersEnabled on — otherwise workshops invoice vehicles directly.
@Injectable()
export class WorkOrdersService {
  constructor(
    private prisma: PrismaService,
    private numbering: DocumentNumberingService,
    private pricing: LineItemPricingService,
    private invoices: InvoiceService,
    private quotations: SalesQuotationService,
    private modules: OrganizationModulesService,
  ) {}

  async isEnabled(organizationId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { workOrdersEnabled: true },
    });
    return org?.workOrdersEnabled ?? false;
  }

  async config(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { workOrdersEnabled: true, posPricingEnabled: true },
    });
    return { enabled: org?.workOrdersEnabled ?? false, posPricingEnabled: org?.posPricingEnabled ?? false };
  }

  private async assertEnabled(organizationId: string) {
    if (!(await this.isEnabled(organizationId))) {
      throw new ForbiddenException('Work orders are turned off — an admin can turn them on in Settings');
    }
  }

  // branchId: a branch member's picker — their branch's and unassigned staff.
  // The job's mechanic picker (front desk): only the mechanics listed on the Mechanic account.
  async mechanics(organizationId: string, branchId?: string) {
    await this.assertEnabled(organizationId);
    return this.prisma.employee.findMany({
      where: {
        organizationId,
        isMechanic: true,
        archivedAt: null,
        isActive: true,
        ...(branchId && { OR: [{ branchId }, { branchId: null }] }),
      },
      select: { id: true, name: true, position: true },
      orderBy: { name: 'asc' },
    });
  }

  async list(
    organizationId: string,
    filters: { status?: string; q?: string; vehicleId?: string; branchId?: string; mechanicId?: string },
  ) {
    await this.assertEnabled(organizationId);
    const status =
      filters.status && (Object.values(WorkOrderStatus) as string[]).includes(filters.status)
        ? (filters.status as WorkOrderStatus)
        : undefined;
    const q = filters.q?.trim();
    const plate = q ? normalizePlate(q) : '';
    const rows = await this.prisma.workOrder.findMany({
      where: {
        organizationId,
        ...(status && { status }),
        ...(filters.vehicleId && { vehicleId: filters.vehicleId }),
        ...(filters.branchId && { branchId: filters.branchId }),
        ...(filters.mechanicId && { mechanicId: filters.mechanicId }),
        ...(q && {
          OR: [
            { number: { contains: escapeLike(q), mode: 'insensitive' } },
            // Spacing-insensitive, like /vehicles/search: "B1234XY" finds "B 1234 XY".
            ...(plate ? [{ vehicle: { plateNormalized: { contains: escapeLike(plate) } } }] : []),
            { customer: { name: { contains: escapeLike(q), mode: 'insensitive' } } },
            { mechanic: { name: { contains: escapeLike(q), mode: 'insensitive' } } },
            { complaint: { contains: escapeLike(q), mode: 'insensitive' } },
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

  // The job plus the workshop's letterhead, for the printed SPK.
  async printView(organizationId: string, id: string) {
    const [workOrder, org] = await Promise.all([
      this.getOne(organizationId, id),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, legalName: true, npwp: true, address: true, phone: true, logoUrl: true },
      }),
    ]);
    return {
      workOrder,
      pricing: await this.priceForPrint(organizationId, workOrder),
      business: {
        name: org?.name ?? '',
        legalName: org?.legalName ?? null,
        npwp: org?.npwp ?? null,
        address: org?.address ?? null,
        phone: org?.phone ?? null,
        logoUrl: org?.logoUrl ?? null,
      },
    };
  }

  // Today's price per line, for the printed estimate. Part prices on the
  // card were approved when it was saved, so they're kept as-is here (no
  // admin check against whoever prints). null if a line can no longer be
  // priced (e.g. a product since archived) — the print then shows quantities.
  private async priceForPrint(organizationId: string, wo: Awaited<ReturnType<WorkOrdersService['getOne']>>) {
    if (wo.items.length === 0) return null;
    const forcedUnitPriceByIndex = new Map<number, number>();
    wo.items.forEach((i, idx) => {
      if (i.productId && i.unitPrice != null) forcedUnitPriceByIndex.set(idx, Number(i.unitPrice));
    });
    try {
      const priced = await this.pricing.priceLines(
        organizationId,
        wo.items.map((i) => ({
          productId: i.productId ?? undefined,
          description: i.description ?? undefined,
          locationId: i.locationId ?? undefined,
          quantity: Number(i.quantity),
          unitPrice: i.unitPrice != null ? Number(i.unitPrice) : undefined,
        })),
        undefined,
        { customerId: wo.customerId, forcedUnitPriceByIndex },
      );
      return {
        lines: priced.items.map((l) => ({ unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
        subtotal: priced.subtotal,
        discountAmount: priced.discountAmount,
        taxAmount: priced.taxAmount,
        total: Math.round((priced.subtotal - priced.discountAmount + priced.taxAmount) * 100) / 100,
      };
    } catch {
      return null;
    }
  }

  async create(organizationId: string, userId: string, dto: CreateWorkOrderDto) {
    await this.assertEnabled(organizationId);
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: dto.vehicleId, organizationId },
      select: { id: true, customerId: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (dto.mechanicId) await this.assertMechanic(organizationId, dto.mechanicId);
    if (dto.comebackOfId) {
      const original = await this.prisma.workOrder.findFirst({
        where: { id: dto.comebackOfId, organizationId, vehicleId: vehicle.id },
        select: { id: true },
      });
      if (!original) throw new BadRequestException('The job this comes back to must be an earlier job on this vehicle');
    }
    const items = await this.dropIgnoredPartPrices(organizationId, dto.items ?? []);
    const estimatedTotal = await this.estimate(organizationId, items, vehicle.customerId, userId);

    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.odometer != null) await this.applyOdometer(tx, organizationId, vehicle.id, dto.odometer);
      const number = await this.numbering.nextSequential(tx, organizationId, 'WORK_ORDER', 'WO');
      const branchId = await resolveBranchId(tx, organizationId, {
        branchId: dto.branchId,
        locationId: items.find((i) => i.productId && i.locationId)?.locationId,
      });
      const job = await tx.workOrder.create({
        data: {
          organizationId,
          number,
          // The go-ahead is given before a job exists: on its quotation, or
          // by checking the car straight in.
          status: WorkOrderStatus.QUEUED,
          approvedAt: new Date(),
          approvedById: userId,
          customerId: vehicle.customerId,
          vehicleId: vehicle.id,
          mechanicId: dto.mechanicId ?? null,
          branchId,
          comebackOfId: dto.comebackOfId ?? null,
          comebackReason: dto.comebackOfId ? dto.comebackReason?.trim() || null : null,
          odometer: dto.odometer ?? null,
          complaint: dto.complaint?.trim() || null,
          notes: dto.notes?.trim() || null,
          ...formalFields(dto),
          estimatedTotal,
          createdById: userId,
          items: { create: items.map(toItemData) },
        },
        select: { id: true },
      });
      if (dto.fromReminderId) {
        // Only this vehicle's own pending reminder; claimed atomically so it
        // can't start two jobs.
        const claimed = await tx.vehicleReminder.updateMany({
          where: {
            id: dto.fromReminderId,
            organizationId,
            vehicleId: vehicle.id,
            status: ReminderStatus.PENDING,
          },
          data: { status: ReminderStatus.COMPLETED, completedAt: new Date(), followUpWorkOrderId: job.id },
        });
        if (claimed.count === 0) throw new BadRequestException('That reminder is not pending for this vehicle');
      }
      return job;
    });
    return this.getOne(organizationId, created.id);
  }

  // Appends one line (from the parts catalogue) through update(), so it gets the same checks — not
  // after invoicing, prices and holds recomputed.
  async addLine(organizationId: string, userId: string, id: string, line: AddWorkOrderLineDto) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, organizationId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!wo) throw new NotFoundException('Work order not found');
    let locationId = line.locationId;
    if (line.productId && !locationId) {
      const best = await this.prisma.stock.findFirst({
        where: { organizationId, productId: line.productId },
        orderBy: { quantity: 'desc' },
        select: { locationId: true },
      });
      locationId =
        best?.locationId ??
        (await this.prisma.location.findFirst({ where: { organizationId, archivedAt: null }, select: { id: true } }))?.id;
    }
    const existing = wo.items.map((i) => ({
      ...(i.productId ? { productId: i.productId, locationId: i.locationId ?? undefined } : { description: i.description ?? '' }),
      ...(i.productId && i.description ? { description: i.description } : {}),
      quantity: Number(i.quantity),
      ...(i.unitPrice != null ? { unitPrice: Number(i.unitPrice) } : {}),
    }));
    return this.update(organizationId, userId, id, {
      items: [
        ...existing,
        {
          ...(line.productId ? { productId: line.productId, locationId } : { description: line.description }),
          quantity: line.quantity,
          ...(line.unitPrice != null ? { unitPrice: line.unitPrice } : {}),
        },
      ],
    } as UpdateWorkOrderDto);
  }

  async update(organizationId: string, userId: string, id: string, dto: UpdateWorkOrderDto) {
    const wo = await this.getEditable(organizationId, id);
    if (dto.mechanicId) await this.assertMechanic(organizationId, dto.mechanicId);
    const items = dto.items !== undefined ? await this.dropIgnoredPartPrices(organizationId, dto.items) : undefined;
    const estimatedTotal =
      items !== undefined ? await this.estimate(organizationId, items, wo.customerId, userId) : undefined;

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
      if (items !== undefined) {
        await tx.workOrderItem.deleteMany({ where: { workOrderId: id } });
      }
      await tx.workOrder.update({
        where: { id },
        data: {
          ...(dto.mechanicId !== undefined && { mechanicId: dto.mechanicId }),
          ...(dto.odometer !== undefined && { odometer: dto.odometer }),
          ...(dto.complaint !== undefined && { complaint: dto.complaint?.trim() || null }),
          ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
          ...formalFields(dto),
          ...(dto.branchId && { branchId: await resolveBranchId(tx, organizationId, { branchId: dto.branchId }) }),
          ...(items !== undefined && {
            estimatedTotal,
            items: { create: items.map(toItemData) },
          }),
        },
      });
    });
    return this.getOne(organizationId, id);
  }

  async setStatus(organizationId: string, id: string, requested: WorkOrderStatus) {
    const wo = await this.getEditable(organizationId, id, { allowCancelled: true });
    // Estimates are quotations now; a legacy ESTIMATE job only waits for
    // src/scripts/estimates-to-quotations.ts to turn it into one.
    if (requested === WorkOrderStatus.ESTIMATE || wo.status === WorkOrderStatus.ESTIMATE) {
      throw new BadRequestException('Estimates are sales quotations now — quote the job there');
    }
    const status = requested;
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

  // ── From a quotation ─────────────────────────────────────────────────

  // The quoted job, whether or not the customer has answered the link yet. An additional quotation (parts
  // found mid-job) adds its lines to its original's work order instead of starting another.
  async createFromQuotation(
    organizationId: string,
    userId: string,
    quotationId: string,
    dto: CreateWorkOrderFromQuotationDto = {},
  ) {
    await this.assertEnabled(organizationId);
    let quotation = await this.prisma.salesQuotation.findFirst({
      where: { id: quotationId, organizationId },
      // Lines in the order they were saved, as the quotation prints them.
      include: { items: true, parentQuotation: { select: { workOrderId: true } } },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.items.length === 0) throw new BadRequestException('Add at least one part or service first');
    if (!quotation.customerId || !quotation.vehicleId) {
      throw new BadRequestException('Pick the customer and their vehicle on the quotation first');
    }
    const targetId = quotation.parentQuotationId ? quotation.parentQuotation?.workOrderId : null;
    if (quotation.parentQuotationId && !targetId) {
      throw new BadRequestException('Convert the original quotation to a work order first');
    }
    // A draft is sent first, so the job refers to a numbered quotation.
    if (quotation.status === 'DRAFT') {
      await this.quotations.send(organizationId, quotationId, userId);
      quotation = { ...quotation, ...(await this.prisma.salesQuotation.findUniqueOrThrow({ where: { id: quotationId } })) };
    }
    const lines = quotationLines(quotation.items);
    const previousStatus = await this.quotations.claimForWorkOrder(organizationId, quotationId);
    try {
      let workOrderId: string;
      if (targetId) {
        const wo = await this.prisma.workOrder.findUniqueOrThrow({
          where: { id: targetId },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        });
        await this.update(organizationId, userId, targetId, {
          items: [...wo.items.map(fromItem), ...lines],
        } as UpdateWorkOrderDto);
        workOrderId = targetId;
      } else {
        const vehicle = await this.prisma.vehicle.findUniqueOrThrow({
          where: { id: quotation.vehicleId! },
          select: { odometer: true },
        });
        // Readings only go up: one older than the car's latest stays on the quotation, and the job
        // says so rather than starting with a blank odometer and no reason.
        const staleOdometer =
          quotation.odometer != null && vehicle.odometer != null && quotation.odometer < vehicle.odometer;
        const created = await this.create(organizationId, userId, {
          vehicleId: quotation.vehicleId!,
          mechanicId: dto.mechanicId,
          branchId: quotation.branchId ?? undefined,
          odometer: quotation.odometer != null && !staleOdometer ? quotation.odometer : undefined,
          complaint: quotation.complaint ?? undefined,
          customerPoNumber: quotation.customerPoNumber ?? undefined,
          items: lines,
        } as CreateWorkOrderDto);
        await this.prisma.workOrder.update({
          where: { id: created.id },
          data: {
            approvalNote: [
              `From quotation ${quotation.quotationNumber}`,
              quotation.responseNote,
              staleOdometer &&
                `Quoted at ${quotation.odometer!.toLocaleString('id-ID')} km, below the car's current ` +
                  `${vehicle.odometer!.toLocaleString('id-ID')} km — enter today's reading`,
            ]
              .filter(Boolean)
              .join(' — '),
          },
        });
        workOrderId = created.id;
      }
      await this.quotations.recordWorkOrder(organizationId, quotationId, userId, workOrderId);
      return this.getOne(organizationId, workOrderId);
    } catch (err) {
      await this.quotations.releaseWorkOrderClaim(quotationId, previousStatus);
      throw err;
    }
  }

  // ── Mechanics ──────────────────────────────────────────────────────────

  // The mechanics listed on the Mechanic account: employees marked isMechanic, created from the names
  // written there (no "Mekanik" / "Mechanic" position to type). Archived ones too when asked, for the list.
  async listMechanics(organizationId: string, includeArchived = false) {
    return this.prisma.employee.findMany({
      where: { organizationId, isMechanic: true, ...(includeArchived ? {} : { archivedAt: null }) },
      select: { id: true, name: true, branchId: true, archivedAt: true },
      orderBy: { name: 'asc' },
    });
  }

  // A name on the Mechanic account becomes a Payroll employee (salary set there later).
  async addMechanic(organizationId: string, name: string, branchId?: string | null) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Enter the mechanic’s name');
    const existing = await this.prisma.employee.findFirst({
      where: { organizationId, isMechanic: true, name: { equals: trimmed, mode: 'insensitive' } },
    });
    // Re-adding someone archived brings them back, history and all.
    if (existing) {
      if (!existing.archivedAt) throw new BadRequestException(`${existing.name} is already a mechanic`);
      return this.prisma.employee.update({
        where: { id: existing.id },
        data: { archivedAt: null, isActive: true },
        select: { id: true, name: true, branchId: true, archivedAt: true },
      });
    }
    return this.prisma.employee.create({
      data: { organizationId, name: trimmed, position: 'Mechanic', baseSalary: 0, isMechanic: true, branchId: branchId ?? null },
      select: { id: true, name: true, branchId: true, archivedAt: true },
    });
  }

  async renameMechanic(organizationId: string, id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Enter the mechanic’s name');
    await this.getMechanicRecord(organizationId, id);
    return this.prisma.employee.update({
      where: { id },
      data: { name: trimmed },
      select: { id: true, name: true, branchId: true, archivedAt: true },
    });
  }

  // Off the list and the pickers; their past jobs and pay keep pointing at them.
  async removeMechanic(organizationId: string, id: string) {
    await this.getMechanicRecord(organizationId, id);
    return this.prisma.employee.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false },
      select: { id: true, name: true, branchId: true, archivedAt: true },
    });
  }

  private async getMechanicRecord(organizationId: string, id: string) {
    const mechanic = await this.prisma.employee.findFirst({ where: { id, organizationId, isMechanic: true } });
    if (!mechanic) throw new NotFoundException('Mechanic not found');
    return mechanic;
  }

  // ── Workshop board (the Mechanic account's screen) ─────────────────────

  // Read-only: the jobs on the floor, with what to fit — no prices, customers' contacts or staff names other
  // than the mechanic.
  async board(organizationId: string) {
    await this.assertEnabled(organizationId);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true, logoUrl: true },
    });
    const jobs = await this.prisma.workOrder.findMany({
      where: { organizationId: org.id, status: { in: BOARD_STATUSES } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        number: true,
        status: true,
        complaint: true,
        notes: true,
        createdAt: true,
        startedAt: true,
        vehicle: { select: { plateNumber: true, vehicleModel: true } },
        mechanic: { select: { name: true } },
        branch: { select: { name: true } },
        items: {
          orderBy: { sortOrder: 'asc' },
          select: { productId: true, description: true, quantity: true, product: { select: { name: true } } },
        },
      },
    });
    jobs.sort((a, b) => BOARD_STATUSES.indexOf(a.status) - BOARD_STATUSES.indexOf(b.status));
    return {
      business: { name: org.name, logoUrl: org.logoUrl },
      generatedAt: new Date(),
      jobs: jobs.map((j) => ({
        id: j.id,
        number: j.number,
        status: j.status,
        plateNumber: j.vehicle.plateNumber,
        vehicleModel: j.vehicle.vehicleModel,
        complaint: j.complaint,
        notes: j.notes,
        mechanic: j.mechanic?.name ?? null,
        branch: j.branch?.name ?? null,
        createdAt: j.createdAt,
        startedAt: j.startedAt,
        lines: j.items.map((i) => ({
          name: i.product?.name ?? i.description ?? '',
          isPart: !!i.productId,
          quantity: Number(i.quantity),
        })),
      })),
    };
  }

  // Work spotted on this job for a later visit, kept as a reminder on the
  // vehicle. Allowed at any stage — it's usually noted when the job ends.
  async addRecommendation(organizationId: string, id: string, dto: CreateRecommendationDto) {
    const wo = await this.getOne(organizationId, id);
    const dueDate = new Date(dto.dueDate);
    if (Number.isNaN(dueDate.getTime())) throw new BadRequestException('Invalid due date');
    await this.prisma.vehicleReminder.create({
      data: {
        organizationId,
        vehicleId: wo.vehicleId,
        note: dto.note.trim(),
        dueDate,
        dueOdometer: dto.dueOdometer ?? null,
        sourceWorkOrderId: wo.id,
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
    // A part price on the card was allowed when the job was saved; it only
    // carries over while POS pricing is still on (see dropIgnoredPartPrices).
    const { posPricingEnabled } = await this.config(organizationId);
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
        mechanicId: wo.mechanicId ?? undefined,
        locationId: firstPart?.locationId ?? undefined,
        notes: wo.complaint ? `${wo.number}: ${wo.complaint}` : wo.number,
        branchId: wo.branchId ?? undefined,
        customerPoNumber: wo.customerPoNumber ?? undefined,
        paymentTerms: wo.paymentTerms ?? undefined,
        items: wo.items.map((i) => ({
          productId: i.productId ?? undefined,
          description: i.description ?? undefined,
          locationId: i.locationId ?? undefined,
          quantity: Number(i.quantity),
          unitPrice:
            i.unitPrice != null && (!i.productId || posPricingEnabled) ? Number(i.unitPrice) : undefined,
        })),
      },
      { workOrderId: id, keepPartPrices: posPricingEnabled },
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
      where: { id: employeeId, organizationId, archivedAt: null, isMechanic: true },
      select: { id: true },
    });
    if (!found) throw new BadRequestException('Mechanic not found — add them to the mechanic account first');
  }

  // Without POS pricing the invoice ignores a typed part price and uses
  // the catalogue's, so don't keep one on the job card either.
  private async dropIgnoredPartPrices(organizationId: string, items: WorkOrderLineInput[]) {
    if ((await this.config(organizationId)).posPricingEnabled) return items;
    return items.map((i) => (i.productId ? { ...i, unitPrice: undefined } : i));
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

// Only the formal-estimate fields the request actually sent; '' clears one.
function formalFields(dto: { validUntil?: string | null; customerPoNumber?: string | null; paymentTerms?: string | null }) {
  return {
    ...(dto.validUntil !== undefined && { validUntil: dto.validUntil ? new Date(dto.validUntil) : null }),
    ...(dto.customerPoNumber !== undefined && { customerPoNumber: dto.customerPoNumber?.trim() || null }),
    ...(dto.paymentTerms !== undefined && { paymentTerms: dto.paymentTerms?.trim() || null }),
  };
}

// A quotation line as a job line, at the quoted price per unit (any line discount folded in). Part prices
// only stay on the job while POS pricing is on (see dropIgnoredPartPrices).
function quotationLines(
  items: { productId: string | null; locationId: string | null; description: string | null; quantity: Prisma.Decimal; netAmount: Prisma.Decimal }[],
): WorkOrderLineInput[] {
  return items.map((i) => {
    const quantity = Number(i.quantity);
    const unitPrice = quantity ? Math.round((Number(i.netAmount) / quantity) * 100) / 100 : 0;
    return (
      i.productId
        ? { productId: i.productId, locationId: i.locationId ?? undefined, quantity, unitPrice }
        : { description: i.description?.trim() || '-', quantity, unitPrice }
    ) as WorkOrderLineInput;
  });
}

// A saved job line, as update() takes it back.
function fromItem(i: {
  productId: string | null;
  locationId: string | null;
  description: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
}): WorkOrderLineInput {
  return {
    ...(i.productId ? { productId: i.productId, locationId: i.locationId ?? undefined } : { description: i.description ?? '' }),
    ...(i.productId && i.description ? { description: i.description } : {}),
    quantity: Number(i.quantity),
    ...(i.unitPrice != null ? { unitPrice: Number(i.unitPrice) } : {}),
  } as WorkOrderLineInput;
}
