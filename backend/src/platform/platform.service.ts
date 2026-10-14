// src/platform/platform.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleKey, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { AuditContext, writeAudit } from './platform-audit';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { effectivePlan } from '../billing/plans';
import { adjustWaBalance } from '../messaging/wa-wallet';

const ORG_FIELDS = {
  id: true,
  name: true,
  plan: true,
  seatLimit: true,
  createdAt: true,
  suspendedAt: true,
  suspendedReason: true,
  paidUntil: true,
  trialEndsAt: true,
  billingNote: true,
  onboardingCompletedAt: true,
  waBalance: true,
  modules: { select: { module: true, enabled: true, expiresAt: true } },
} satisfies Prisma.OrganizationSelect;

const BILLING_FIELDS = [
  'plan',
  'seatLimit',
  'paidUntil',
  'trialEndsAt',
  'billingNote',
] as const;

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: OrganizationModulesService,
  ) {}

  // Usage per tenant (products, invoices in the last 30 days, media
  // storage) is metered with one groupBy each, not a query per org.
  async listOrganizations() {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [orgs, seats, logins, products, invoices, media] = await Promise.all([
      this.prisma.organization.findMany({
        select: ORG_FIELDS,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.groupBy({
        by: ['organizationId'],
        where: { active: true, removedAt: null },
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ['organizationId'],
        _max: { lastActiveAt: true },
      }),
      this.prisma.product.groupBy({
        by: ['organizationId'],
        where: { active: true },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['organizationId'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.mediaAsset.groupBy({
        by: ['organizationId'],
        _sum: { sizeBytes: true },
      }),
    ]);
    const countBy = (rows: { organizationId: string; _count: { _all: number } }[]) =>
      new Map(rows.map((r) => [r.organizationId, r._count._all]));
    const productCount = countBy(products);
    const invoiceCount = countBy(invoices);
    const mediaBytes = new Map(media.map((m) => [m.organizationId, m._sum.sizeBytes ?? 0]));
    const seatsUsed = new Map(
      seats.map((s) => [s.organizationId, s._count._all]),
    );
    const lastActive = new Map(
      logins.map((l) => [l.organizationId, l._max.lastActiveAt]),
    );
    return orgs.map((o) => ({
      ...o,
      effectivePlan: effectivePlan(o),
      seatsUsed: seatsUsed.get(o.id) ?? 0,
      lastActiveAt: lastActive.get(o.id) ?? null,
      usage: {
        products: productCount.get(o.id) ?? 0,
        invoices30d: invoiceCount.get(o.id) ?? 0,
        mediaBytes: mediaBytes.get(o.id) ?? 0,
      },
    }));
  }

  async getOrganization(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: {
        ...ORG_FIELDS,
        users: {
          where: { removedAt: null },
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true,
            active: true,
            createdAt: true,
            lastActiveAt: true,
          },
          orderBy: [{ role: 'asc' }, { email: 'asc' }],
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const recentAudit = await this.prisma.platformAuditLog.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      ...org,
      seatsUsed: org.users.filter((u) => u.active).length,
      recentAudit,
    };
  }

  async updateOrganization(
    ctx: AuditContext,
    id: string,
    dto: UpdateOrganizationDto,
  ) {
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.plan !== undefined) data.plan = dto.plan;
    if (dto.seatLimit !== undefined) data.seatLimit = dto.seatLimit;
    if (dto.paidUntil !== undefined)
      data.paidUntil = dto.paidUntil === null ? null : new Date(dto.paidUntil);
    if (dto.trialEndsAt !== undefined)
      data.trialEndsAt =
        dto.trialEndsAt === null ? null : new Date(dto.trialEndsAt);
    if (dto.billingNote !== undefined)
      data.billingNote = dto.billingNote?.trim() || null;
    if (Object.keys(data).length === 0)
      throw new BadRequestException('Nothing to change');

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUnique({
        where: { id },
        select: {
          plan: true,
          seatLimit: true,
          paidUntil: true,
          trialEndsAt: true,
          billingNote: true,
        },
      });
      if (!before) throw new NotFoundException('Organization not found');
      const after = await tx.organization.update({
        where: { id },
        data,
        select: {
          plan: true,
          seatLimit: true,
          paidUntil: true,
          trialEndsAt: true,
          billingNote: true,
        },
      });
      const changed = BILLING_FIELDS.filter((k) => dto[k] !== undefined);
      await writeAudit(tx, ctx, 'organization.update', {
        organizationId: id,
        before: pick(before, changed),
        after: pick(after, changed),
      });
      return after;
    });
  }

  async adjustWaBalance(ctx: AuditContext, id: string, amount: number, note: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUnique({ where: { id }, select: { waBalance: true } });
      if (!before) throw new NotFoundException('Organization not found');
      const entry = await adjustWaBalance(tx, id, amount, note.trim(), ctx.actor.id);
      await writeAudit(tx, ctx, 'organization.waBalance', {
        organizationId: id,
        before: { waBalance: Number(before.waBalance) },
        after: { waBalance: Number(entry.balanceAfter), note: note.trim() },
      });
      return { waBalance: Number(entry.balanceAfter) };
    });
  }

  async suspend(ctx: AuditContext, id: string, reason: string) {
    // Suspending your own org would lock you out of the console too.
    if (id === ctx.actor.organizationId) {
      throw new BadRequestException('You cannot suspend your own organization');
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUnique({
        where: { id },
        select: { suspendedAt: true, suspendedReason: true },
      });
      if (!before) throw new NotFoundException('Organization not found');
      const after = await tx.organization.update({
        where: { id },
        // Keep the original suspension time when only the reason changes.
        data: {
          suspendedAt: before.suspendedAt ?? new Date(),
          suspendedReason: reason.trim(),
        },
        select: { suspendedAt: true, suspendedReason: true },
      });
      await writeAudit(tx, ctx, 'organization.suspend', {
        organizationId: id,
        before,
        after,
      });
      return after;
    });
  }

  async reactivate(ctx: AuditContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUnique({
        where: { id },
        select: { suspendedAt: true, suspendedReason: true },
      });
      if (!before) throw new NotFoundException('Organization not found');
      const after = await tx.organization.update({
        where: { id },
        data: { suspendedAt: null, suspendedReason: null },
        select: { suspendedAt: true, suspendedReason: true },
      });
      await writeAudit(tx, ctx, 'organization.reactivate', {
        organizationId: id,
        before,
        after,
      });
      return after;
    });
  }

  // Reuses OrganizationModulesService for the dependency/expiry rules, so
  // the audit row is written right after rather than in one transaction.
  async setModule(
    ctx: AuditContext,
    id: string,
    module: ModuleKey,
    enabled: boolean,
    expiresAt?: string,
  ) {
    const before = await this.prisma.organizationModule.findUnique({
      where: { organizationId_module: { organizationId: id, module } },
      select: { enabled: true, expiresAt: true },
    });
    const row = enabled
      ? await this.modules.enableModule(
          id,
          module,
          expiresAt ? new Date(expiresAt) : undefined,
        )
      : await this.modules.disableModule(id, module);
    const after = { enabled: row.enabled, expiresAt: row.expiresAt };
    await writeAudit(
      this.prisma,
      ctx,
      enabled ? 'module.enable' : 'module.disable',
      {
        organizationId: id,
        before: before ? { module, ...before } : null,
        after: { module, ...after },
      },
    );
    return { module, ...after };
  }

  auditLog(query: {
    organizationId?: string;
    before?: string;
    limit?: number;
  }) {
    return this.prisma.platformAuditLog.findMany({
      where: {
        organizationId: query.organizationId,
        createdAt: query.before ? { lt: new Date(query.before) } : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit ?? 50, 200),
    });
  }
}

function pick<T extends object>(obj: T, keys: readonly string[]) {
  return Object.fromEntries(
    keys.map((k) => [k, (obj as Record<string, unknown>)[k]]),
  );
}
