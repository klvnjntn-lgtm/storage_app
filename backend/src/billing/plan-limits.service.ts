import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  resolveTimezone,
  todayBusinessDate,
  wallTimeOnBusinessDay,
} from '../accounting/business-date';
import { effectivePlan, PlanKey, PlanLimits, PLAN_LIMITS } from './plans';

type Db = Prisma.TransactionClient | PrismaService;

export type LimitedResource = keyof PlanLimits;

export type PlanUsage = Record<LimitedResource, number>;

const RESOURCE_LABEL: Record<LimitedResource, string> = {
  seats: 'users',
  locations: 'locations',
  products: 'products',
  invoicesPerMonth: 'invoices this month',
};

// Enforces the plan limits in plans.ts. Callers ask before creating the
// thing being limited (assertCanAdd), inside their own transaction where
// they have one, so the count includes rows they just wrote.
//
// Orgs on the "custom" plan only ever have their seats checked, against
// Organization.seatLimit as before billing existed — every other limit is
// skipped without a count query, so existing tenants pay nothing for this.
@Injectable()
export class PlanLimitsService {
  constructor(private prisma: PrismaService) {}

  async getPlanState(organizationId: string, db: Db = this.prisma) {
    const org = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        plan: true,
        trialEndsAt: true,
        paidUntil: true,
        seatLimit: true,
        timezone: true,
      },
    });
    const plan = effectivePlan(org);
    return { org, plan, limits: this.limitsFor(plan, org.seatLimit) };
  }

  limitsFor(plan: PlanKey, seatLimit: number): PlanLimits {
    if (plan === 'custom') {
      return {
        seats: seatLimit,
        locations: null,
        products: null,
        invoicesPerMonth: null,
      };
    }
    return PLAN_LIMITS[plan];
  }

  async seatLimit(
    organizationId: string,
    db: Db = this.prisma,
  ): Promise<number | null> {
    return (await this.getPlanState(organizationId, db)).limits.seats;
  }

  async usage(
    organizationId: string,
    db: Db = this.prisma,
  ): Promise<PlanUsage> {
    const org = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const [seats, locations, products, invoicesPerMonth] = await Promise.all([
      this.count(organizationId, 'seats', db),
      this.count(organizationId, 'locations', db),
      this.count(organizationId, 'products', db),
      this.count(organizationId, 'invoicesPerMonth', db, resolveTimezone(org)),
    ]);
    return { seats, locations, products, invoicesPerMonth };
  }

  // Throws a 403 the frontend recognises (error: 'PlanLimitReached') when
  // adding `adding` more of `resource` would go past the plan's limit.
  async assertCanAdd(
    organizationId: string,
    resource: LimitedResource,
    adding = 1,
    db: Db = this.prisma,
  ) {
    const { org, plan, limits } = await this.getPlanState(organizationId, db);
    const limit = limits[resource];
    if (limit === null) return;
    const used = await this.count(
      organizationId,
      resource,
      db,
      resolveTimezone(org),
    );
    if (used + adding > limit) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'PlanLimitReached',
        resource,
        limit,
        used,
        plan,
        message:
          resource === 'seats'
            ? `Seat limit reached (${limit}). Upgrade your plan to add more users.`
            : `${plan === 'trial' ? 'The free trial' : 'Without a subscription, WareSys'} allows ${limit} ${RESOURCE_LABEL[resource]}. Subscribe to a module to remove the limit.`,
      });
    }
  }

  private async count(
    organizationId: string,
    resource: LimitedResource,
    db: Db,
    tz?: string,
  ): Promise<number> {
    switch (resource) {
      case 'seats':
        return db.user.count({
          where: { organizationId, active: true, removedAt: null },
        });
      case 'locations':
        return db.location.count({
          where: { organizationId, archivedAt: null },
        });
      case 'products':
        return db.product.count({ where: { organizationId, active: true } });
      case 'invoicesPerMonth':
        return db.invoice.count({
          where: {
            organizationId,
            createdAt: { gte: this.startOfMonth(tz ?? 'Asia/Jakarta') },
          },
        });
    }
  }

  // First instant of the current calendar month in the org's timezone.
  private startOfMonth(tz: string): Date {
    const today = todayBusinessDate(tz);
    const first = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    return wallTimeOnBusinessDay(first, '00:00', tz);
  }
}
