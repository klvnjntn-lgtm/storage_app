import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceFormat, InvoiceStatus, Prisma, ReminderStatus, WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';
import { InvoiceService } from '../invoice/invoice.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveBranchId } from '../branches/resolve-branch';
import { normalizePlate } from '../lib/plate';
import { escapeLike } from '../common/text/escape-like';
import {
  CreateRecommendationDto,
  CreateWorkOrderDto,
  UpdateWorkOrderDto,
  WorkOrderLineInput,
} from './dto/work-order.dto';

const DETAIL_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, companyName: true, npwp: true, address: true } },
  vehicle: { select: { id: true, plateNumber: true, vehicleModel: true, odometer: true } },
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
    select: { id: true, note: true, dueDate: true, status: true, followUpWorkOrderId: true },
  },
  // The reminder this job was started from, if any.
  followedUp: { select: { id: true, note: true, sourceWorkOrder: { select: { id: true, number: true } } } },
} satisfies Prisma.WorkOrderInclude;

type WorkOrderDetail = Prisma.WorkOrderGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function withInvoiced(wo: WorkOrderDetail) {
  const live = wo.invoices.find((inv) => inv.status !== InvoiceStatus.VOID);
  return { ...wo, invoicedId: live?.id ?? null };
}

// How long a customer approval link stays valid.
const APPROVAL_LINK_DAYS = 30;

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
    private notifications: NotificationsService,
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
    const plate = q ? normalizePlate(q) : '';
    const rows = await this.prisma.workOrder.findMany({
      where: {
        organizationId,
        ...(status && { status }),
        ...(filters.vehicleId && { vehicleId: filters.vehicleId }),
        ...(q && {
          OR: [
            { number: { contains: escapeLike(q), mode: 'insensitive' } },
            // Spacing-insensitive, like /vehicles/search: "B1234XY" finds "B 1234 XY".
            ...(plate ? [{ vehicle: { plateNormalized: { contains: escapeLike(plate) } } }] : []),
            { customer: { name: { contains: escapeLike(q), mode: 'insensitive' } } },
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
          // A job checked straight in is approved at check-in; an estimate
          // waits for approve(). approvedAt also tells a reopened job which
          // of the two to go back to (see setStatus).
          status: dto.asEstimate ? WorkOrderStatus.ESTIMATE : WorkOrderStatus.QUEUED,
          approvedAt: dto.asEstimate ? null : new Date(),
          approvedById: dto.asEstimate ? null : userId,
          customerId: vehicle.customerId,
          vehicleId: vehicle.id,
          mechanicId: dto.mechanicId ?? null,
          branchId,
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
    // An estimate only moves on by approve() (or is cancelled = declined),
    // and nothing moves back into ESTIMATE — except reopening a cancelled
    // job that was never approved, which returns to being an estimate.
    if (requested === WorkOrderStatus.ESTIMATE) {
      throw new BadRequestException('A job can’t be turned back into an estimate');
    }
    if (wo.status === WorkOrderStatus.ESTIMATE && requested !== WorkOrderStatus.CANCELLED) {
      throw new BadRequestException('Record the customer’s approval first');
    }
    const status =
      wo.status === WorkOrderStatus.CANCELLED && !wo.approvedAt ? WorkOrderStatus.ESTIMATE : requested;
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

  // The customer's go-ahead on an estimate: it becomes a normal queued job
  // (and from then on holds its parts' stock).
  async approve(organizationId: string, userId: string, id: string, note?: string) {
    await this.getEditable(organizationId, id);
    await this.decideEstimate(organizationId, id, true, { userId, note });
    return this.getOne(organizationId, id);
  }

  // Approve (→ QUEUED) or decline (→ CANCELLED) an estimate — by staff, or
  // by the customer through the link (no userId; `version` must match the
  // estimate they were shown, see respondToEstimate). Claimed on status so
  // two answers can't both win.
  private async decideEstimate(
    organizationId: string,
    id: string,
    approve: boolean,
    by: { userId?: string; note?: string },
  ) {
    const claimed = await this.prisma.workOrder.updateMany({
      where: { id, organizationId, status: WorkOrderStatus.ESTIMATE },
      data: approve
        ? {
            status: WorkOrderStatus.QUEUED,
            approvedAt: new Date(),
            approvedById: by.userId ?? null,
            approvalNote: by.note?.trim() || null,
          }
        : { status: WorkOrderStatus.CANCELLED, approvalNote: by.note?.trim() || null },
    });
    if (claimed.count === 0) throw new BadRequestException('Only an estimate can be approved or declined');
  }

  // ── Customer approval link ───────────────────────────────────────────

  // The secret for /estimate/<token>. Reused while valid, so a link already
  // sent to the customer keeps working when staff copy it again.
  async approvalLink(organizationId: string, id: string) {
    const wo = await this.getEditable(organizationId, id);
    if (wo.status !== WorkOrderStatus.ESTIMATE) throw new BadRequestException('Only an estimate can be sent for approval');
    if (wo.approvalToken && wo.approvalTokenExpiresAt && wo.approvalTokenExpiresAt > new Date()) {
      return { token: wo.approvalToken, expiresAt: wo.approvalTokenExpiresAt };
    }
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + APPROVAL_LINK_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.workOrder.update({
      where: { id },
      data: { approvalToken: token, approvalTokenExpiresAt: expiresAt },
    });
    return { token, expiresAt };
  }

  private async byApprovalToken(token: string) {
    const wo = await this.prisma.workOrder.findUnique({
      where: { approvalToken: token },
      select: { id: true, organizationId: true, approvalTokenExpiresAt: true },
    });
    if (!wo) throw new NotFoundException('This link is not valid');
    if (!wo.approvalTokenExpiresAt || wo.approvalTokenExpiresAt < new Date()) {
      throw new GoneException('This link has expired — ask the workshop for a new one');
    }
    if (!(await this.isEnabled(wo.organizationId))) throw new NotFoundException('This link is not valid');
    return wo;
  }

  // What the customer sees: no internal notes, mechanic or phone numbers.
  async publicEstimate(token: string) {
    const { id, organizationId, approvalTokenExpiresAt } = await this.byApprovalToken(token);
    const { workOrder: wo, pricing, business } = await this.printView(organizationId, id);
    return {
      business,
      number: wo.number,
      createdAt: wo.createdAt,
      status: wo.status,
      approvedAt: wo.approvedAt,
      customerName: wo.customer.name,
      customerCompany: wo.customer.companyName,
      customerNpwp: wo.customer.npwp,
      validUntil: wo.validUntil,
      customerPoNumber: wo.customerPoNumber,
      paymentTerms: wo.paymentTerms,
      vehicle: { plateNumber: wo.vehicle.plateNumber, vehicleModel: wo.vehicle.vehicleModel },
      complaint: wo.complaint,
      lines: wo.items.map((i, idx) => ({
        name: i.product?.name ?? i.description ?? '',
        isPart: !!i.productId,
        quantity: Number(i.quantity),
        unitPrice: pricing?.lines[idx]?.unitPrice ?? null,
        lineTotal: pricing?.lines[idx]?.lineTotal ?? null,
      })),
      subtotal: pricing?.subtotal ?? null,
      discountAmount: pricing?.discountAmount ?? 0,
      taxAmount: pricing?.taxAmount ?? 0,
      total: pricing?.total ?? Number(wo.estimatedTotal),
      expiresAt: approvalTokenExpiresAt,
      // A fingerprint of what the customer is shown, echoed back on
      // approve/decline: if staff changed the estimate since, it's refused.
      version: createHash('sha256')
        .update(
          JSON.stringify([
            wo.complaint,
            wo.items.map((i) => [i.productId, i.description, String(i.quantity), i.unitPrice?.toString() ?? null]),
            pricing?.total ?? null,
          ]),
        )
        .digest('hex')
        .slice(0, 16),
    };
  }

  async respondToEstimate(
    token: string,
    approve: boolean,
    dto: { name: string; reason?: string; version: string },
  ) {
    const { id, organizationId } = await this.byApprovalToken(token);
    const current = await this.publicEstimate(token);
    if (current.status === WorkOrderStatus.ESTIMATE && current.version !== dto.version) {
      throw new ConflictException('This estimate was updated — please reload to see the latest version');
    }
    if (approve && current.validUntil && endOfDay(current.validUntil) < new Date()) {
      throw new BadRequestException('This estimate is no longer valid — ask the workshop for an updated one');
    }
    const name = dto.name.trim();
    const note = approve
      ? `Approved online by ${name}`
      : `Declined online by ${name}${dto.reason?.trim() ? `: ${dto.reason.trim()}` : ''}`;
    await this.decideEstimate(organizationId, id, approve, { note });

    const wo = await this.prisma.workOrder.findUniqueOrThrow({
      where: { id },
      select: { number: true, vehicle: { select: { plateNumber: true } } },
    });
    await this.notifications.notifyOrgStaff(
      organizationId,
      approve ? 'WORK_ORDER_APPROVED' : 'WORK_ORDER_DECLINED',
      approve
        ? `Estimate ${wo.number} (${wo.vehicle.plateNumber}) was approved`
        : `Estimate ${wo.number} (${wo.vehicle.plateNumber}) was declined`,
      { body: note, link: `/workshop/work-orders/${id}` },
    );
    return this.publicEstimate(token);
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
      where: { id: employeeId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!found) throw new BadRequestException('Mechanic not found');
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

// A DATE column holds midnight UTC; the estimate is good through that day.
function endOfDay(date: Date) {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
}
