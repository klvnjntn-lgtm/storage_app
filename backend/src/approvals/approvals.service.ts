import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalDocumentType, ApprovalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

type Db = Prisma.TransactionClient | PrismaService;

type Requirement = {
  required: boolean;
  value: number;
  limit: number | null;
  reason: string;
  label: string;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Two-person rule for the two places money most often leaks: a purchase
// order above a set amount, and an invoice discounted beyond a set
// percentage. Admins are the approvers, so their own documents never need
// a request. Everyone else asks, an admin decides, and the approval covers
// the document only while it stays at or below the value approved — raise
// a PO total after approval and it needs approving again.
@Injectable()
export class ApprovalsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async getSettings(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { poApprovalThreshold: true, discountApprovalPercent: true },
    });
    return {
      poApprovalThreshold:
        org.poApprovalThreshold != null
          ? Number(org.poApprovalThreshold)
          : null,
      discountApprovalPercent:
        org.discountApprovalPercent != null
          ? Number(org.discountApprovalPercent)
          : null,
    };
  }

  async updateSettings(
    organizationId: string,
    dto: {
      poApprovalThreshold?: number | null;
      discountApprovalPercent?: number | null;
    },
  ) {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(dto.poApprovalThreshold !== undefined && {
          poApprovalThreshold: dto.poApprovalThreshold,
        }),
        ...(dto.discountApprovalPercent !== undefined && {
          discountApprovalPercent: dto.discountApprovalPercent,
        }),
      },
    });
    return this.getSettings(organizationId);
  }

  // Whether this document, as it is right now, needs an approval.
  async requirement(
    organizationId: string,
    documentType: ApprovalDocumentType,
    documentId: string,
    db: Db = this.prisma,
  ): Promise<Requirement> {
    const settings = await this.getSettings(organizationId);
    if (documentType === ApprovalDocumentType.PURCHASE_ORDER) {
      const po = await db.purchaseOrder.findFirst({
        where: { id: documentId, organizationId },
        select: { total: true, poNumber: true },
      });
      if (!po) throw new NotFoundException('Purchase order not found');
      const total = Number(po.total);
      const limit = settings.poApprovalThreshold;
      return {
        required: limit !== null && total > limit,
        value: total,
        limit,
        reason: `Purchase order total ${total.toLocaleString('id-ID')} is over the approval limit of ${(limit ?? 0).toLocaleString('id-ID')}`,
        label: po.poNumber ? `PO ${po.poNumber}` : 'Draft purchase order',
      };
    }
    const invoice = await db.invoice.findFirst({
      where: { id: documentId, organizationId },
      select: {
        discount: true,
        invoiceNumber: true,
        items: { select: { lineTotal: true, discountAmount: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const gross = invoice.items.reduce((s, i) => s + Number(i.lineTotal), 0);
    const discount =
      Number(invoice.discount) +
      invoice.items.reduce((s, i) => s + Number(i.discountAmount), 0);
    const pct = gross > 0 ? round2((discount / gross) * 100) : 0;
    const limit = settings.discountApprovalPercent;
    return {
      required: limit !== null && pct > limit,
      value: pct,
      limit,
      reason: `Discount of ${pct}% is over the approval limit of ${limit ?? 0}%`,
      label: invoice.invoiceNumber
        ? `Invoice ${invoice.invoiceNumber}`
        : 'Draft invoice',
    };
  }

  // Called by PurchaseOrderService.send and InvoiceService.issue before they
  // do anything.
  async assertApproved(
    organizationId: string,
    documentType: ApprovalDocumentType,
    documentId: string,
    role: string | undefined,
    db: Db = this.prisma,
  ) {
    if (role === 'ADMIN') return;
    const req = await this.requirement(
      organizationId,
      documentType,
      documentId,
      db,
    );
    if (!req.required) return;
    const approved = await db.approvalRequest.findFirst({
      where: {
        organizationId,
        documentType,
        documentId,
        status: ApprovalStatus.APPROVED,
        value: { gte: req.value },
      },
    });
    if (approved) return;
    const pending = await db.approvalRequest.findFirst({
      where: {
        organizationId,
        documentType,
        documentId,
        status: ApprovalStatus.PENDING,
      },
      select: { id: true },
    });
    throw new ForbiddenException({
      statusCode: 403,
      error: 'ApprovalRequired',
      documentType,
      documentId,
      pendingRequestId: pending?.id ?? null,
      message: `${req.reason}. An admin needs to approve it first.`,
    });
  }

  async request(
    organizationId: string,
    userId: string,
    documentType: ApprovalDocumentType,
    documentId: string,
    note?: string,
  ) {
    const req = await this.requirement(
      organizationId,
      documentType,
      documentId,
    );
    if (!req.required)
      throw new BadRequestException('This document does not need approval');

    const existing = await this.prisma.approvalRequest.findFirst({
      where: {
        organizationId,
        documentType,
        documentId,
        status: ApprovalStatus.PENDING,
      },
    });
    // A pending request for a smaller value is replaced, so the admin
    // decides on what the document is now.
    if (existing && Number(existing.value) >= req.value) return existing;
    if (existing) {
      await this.prisma.approvalRequest.update({
        where: { id: existing.id },
        data: { status: ApprovalStatus.CANCELLED },
      });
    }

    const created = await this.prisma.approvalRequest.create({
      data: {
        organizationId,
        documentType,
        documentId,
        value: req.value,
        reason: req.reason,
        note: note?.trim() || null,
        requestedById: userId,
      },
    });
    const admins = await this.prisma.user.findMany({
      where: { organizationId, role: 'ADMIN', active: true, removedAt: null },
      select: { id: true },
    });
    await this.notifications.createMany(
      organizationId,
      admins.map((a) => a.id),
      'APPROVAL_REQUESTED',
      `Approval needed: ${req.label}`,
      { body: req.reason, link: '/approvals' },
    );
    return created;
  }

  async decide(
    organizationId: string,
    adminId: string,
    id: string,
    approve: boolean,
    note?: string,
  ) {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { id, organizationId },
    });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== ApprovalStatus.PENDING)
      throw new BadRequestException('This request has already been decided');
    // updateMany on PENDING so two admins deciding at once can't both win.
    const claim = await this.prisma.approvalRequest.updateMany({
      where: { id, status: ApprovalStatus.PENDING },
      data: {
        status: approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
        decidedById: adminId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
    });
    if (claim.count === 0)
      throw new BadRequestException('This request has already been decided');

    const link =
      request.documentType === ApprovalDocumentType.PURCHASE_ORDER
        ? `/purchasing/purchase-orders/${request.documentId}`
        : `/sales/invoices/${request.documentId}`;
    await this.notifications.create(
      organizationId,
      request.requestedById,
      'APPROVAL_DECIDED',
      approve
        ? 'Your approval request was approved'
        : 'Your approval request was rejected',
      { body: note?.trim() || request.reason, link },
    );
    return this.prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
  }

  async cancel(organizationId: string, userId: string, id: string) {
    const res = await this.prisma.approvalRequest.updateMany({
      where: {
        id,
        organizationId,
        requestedById: userId,
        status: ApprovalStatus.PENDING,
      },
      data: { status: ApprovalStatus.CANCELLED },
    });
    if (res.count === 0)
      throw new NotFoundException('No pending request of yours with that id');
    return { ok: true };
  }

  // Requests with enough of their document to decide without opening it.
  async list(
    organizationId: string,
    opts: { status?: ApprovalStatus; requestedById?: string } = {},
  ) {
    const rows = await this.prisma.approvalRequest.findMany({
      where: {
        organizationId,
        ...(opts.status && { status: opts.status }),
        ...(opts.requestedById && { requestedById: opts.requestedById }),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const poIds = rows
      .filter((r) => r.documentType === ApprovalDocumentType.PURCHASE_ORDER)
      .map((r) => r.documentId);
    const invIds = rows
      .filter((r) => r.documentType === ApprovalDocumentType.INVOICE)
      .map((r) => r.documentId);
    const userIds = [
      ...new Set(
        rows.flatMap((r) =>
          [r.requestedById, r.decidedById].filter((x): x is string => !!x),
        ),
      ),
    ];
    const [pos, invoices, users] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: { id: { in: poIds }, organizationId },
        select: {
          id: true,
          poNumber: true,
          total: true,
          supplier: { select: { name: true } },
        },
      }),
      this.prisma.invoice.findMany({
        where: { id: { in: invIds }, organizationId },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          customerName: true,
        },
      }),
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, displayName: true },
      }),
    ]);
    const poBy = new Map(pos.map((p) => [p.id, p]));
    const invBy = new Map(invoices.map((i) => [i.id, i]));
    const userBy = new Map(users.map((u) => [u.id, u.displayName || u.email]));
    return rows.map((r) => {
      const po = poBy.get(r.documentId);
      const inv = invBy.get(r.documentId);
      return {
        ...r,
        requestedBy: userBy.get(r.requestedById) ?? null,
        decidedBy: r.decidedById ? (userBy.get(r.decidedById) ?? null) : null,
        document:
          r.documentType === ApprovalDocumentType.PURCHASE_ORDER
            ? po && {
                number: po.poNumber,
                total: Number(po.total),
                party: po.supplier?.name ?? null,
              }
            : inv && {
                number: inv.invoiceNumber,
                total: Number(inv.total),
                party: inv.customerName,
              },
      };
    });
  }
}
