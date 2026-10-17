import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BillingPaymentStatus,
  BillingPurpose,
  ModuleKey,
  Prisma,
} from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlanLimitsService } from './plan-limits.service';
import { createPaymentGateway, PaymentGateway } from './payment-gateway';
import {
  addPeriod,
  BillingPeriod,
  GRACE_DAYS,
  MODULE_PRICES,
  modulePrice,
  TRIAL_DAYS,
  TRIAL_MODULES,
} from './plans';

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;

const MODULE_NAMES: Record<ModuleKey, string> = {
  INVOICE_POS: 'Invoice & POS',
  WAREHOUSE_OPS: 'Inventory',
  WORKSHOP_RMS: 'Workshop',
  DELIVERY_DMS: 'Delivery',
};

// Applies a paid BillingPayment's effect inside the caller's transaction.
// The messaging module registers the WA_TOPUP one (see MessagingService)
// so billing doesn't have to depend on it.
export type BillingApplier = (
  tx: Tx,
  payment: Prisma.BillingPaymentGetPayload<object>,
) => Promise<void>;

// Self-serve billing: per-module subscriptions (plans.ts), WhatsApp
// top-ups, the trial, and settling payments from the gateway.
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly gateway: PaymentGateway | null = createPaymentGateway();
  private readonly appliers = new Map<BillingPurpose, BillingApplier>();

  constructor(
    private prisma: PrismaService,
    private limits: PlanLimitsService,
    private notifications: NotificationsService,
  ) {
    this.appliers.set(BillingPurpose.SUBSCRIPTION, (tx, payment) =>
      this.applySubscription(tx, payment),
    );
  }

  registerApplier(purpose: BillingPurpose, applier: BillingApplier) {
    this.appliers.set(purpose, applier);
  }

  gatewayName() {
    return this.gateway?.name ?? null;
  }

  // ---- overview ----------------------------------------------------------

  async getOverview(organizationId: string) {
    const [{ org, plan, limits }, usage, payments, modules] = await Promise.all(
      [
        this.limits.getPlanState(organizationId),
        this.limits.usage(organizationId),
        this.prisma.billingPayment.findMany({
          where: { organizationId, purpose: BillingPurpose.SUBSCRIPTION },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.organizationModule.findMany({ where: { organizationId } }),
      ],
    );
    const now = new Date();
    const byModule = new Map(modules.map((m) => [m.module, m]));
    return {
      plan: org.plan,
      effectivePlan: plan,
      trialEndsAt: org.trialEndsAt,
      graceDays: GRACE_DAYS,
      limits,
      usage,
      gateway: this.gatewayName(),
      modules: MODULE_PRICES.map((p) => {
        const row = byModule.get(p.module);
        return {
          ...p,
          active: !!row?.enabled && (!row.expiresAt || row.expiresAt > now),
          // Active because it's paid for (or granted for good), not just trial.
          paid: isPaid(row),
          paidUntil: row?.paidUntil ?? null,
          expiresAt: row?.expiresAt ?? null,
        };
      }),
      payments,
    };
  }

  // Just enough for the trial/renewal banner every member sees.
  async getStatus(organizationId: string) {
    const { org, plan } = await this.limits.getPlanState(organizationId);
    const soonest = await this.prisma.organizationModule.findFirst({
      // Still running (in its paid period or grace) — a module that has
      // fully lapsed, or one granted forever, needs no renewal reminder.
      where: {
        organizationId,
        enabled: true,
        paidUntil: { not: null },
        expiresAt: { gt: new Date() },
      },
      orderBy: { paidUntil: 'asc' },
      select: { paidUntil: true, module: true },
    });
    return {
      plan: org.plan,
      effectivePlan: plan,
      trialEndsAt: org.trialEndsAt,
      // The first subscribed module to run out, for the renewal banner.
      nextRenewal: soonest
        ? { module: soonest.module, paidUntil: soonest.paidUntil }
        : null,
    };
  }

  // ---- checkout ----------------------------------------------------------

  async createSubscriptionCheckout(
    organizationId: string,
    userId: string,
    modules: ModuleKey[],
    period: BillingPeriod,
  ) {
    const wanted = [...new Set(modules)];
    if (wanted.length === 0)
      throw new BadRequestException('Choose at least one module');
    for (const m of wanted) {
      if (!MODULE_PRICES.some((p) => p.module === m))
        throw new BadRequestException(`${m} is not sold`);
    }
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { plan: true, name: true },
    });
    // A hand-managed org moving to self-serve billing is a decision for the
    // platform owner, not something one click should do.
    if (org.plan === 'custom') {
      throw new ForbiddenException(
        'Your subscription is managed by WareSys support. Contact them to change it.',
      );
    }
    // A module the platform owner granted with no expiry is already free
    // for good — paying for it would buy nothing.
    const owned = await this.prisma.organizationModule.findMany({
      where: {
        organizationId,
        module: { in: wanted },
        enabled: true,
        expiresAt: null,
      },
      select: { module: true },
    });
    if (owned.length > 0) {
      throw new BadRequestException(
        `${owned.map((o) => MODULE_NAMES[o.module]).join(', ')} is already included in your account — remove it from this checkout`,
      );
    }
    // Workshop runs on top of Invoice & POS: it must already be paid for
    // (or granted for good) or be bought in the same checkout. A trial
    // doesn't count — it would end and leave the paid module unusable.
    for (const p of MODULE_PRICES) {
      if (
        !p.requires ||
        !wanted.includes(p.module) ||
        wanted.includes(p.requires)
      )
        continue;
      const dep = await this.prisma.organizationModule.findUnique({
        where: {
          organizationId_module: { organizationId, module: p.requires },
        },
      });
      if (!isPaid(dep)) {
        throw new BadRequestException(
          `${MODULE_NAMES[p.module]} needs ${MODULE_NAMES[p.requires]} — add it to this checkout`,
        );
      }
    }

    const amount = wanted.reduce((sum, m) => sum + modulePrice(m, period), 0);
    return this.createCheckout(organizationId, userId, {
      purpose: BillingPurpose.SUBSCRIPTION,
      amount,
      modules: wanted,
      period,
      description: `WareSys ${wanted.map((m) => MODULE_NAMES[m]).join(' + ')} — 1 ${period === 'YEAR' ? 'year' : 'month'} (${org.name})`,
      returnPath: '/settings/billing',
    });
  }

  // Shared by subscriptions and WhatsApp top-ups.
  async createCheckout(
    organizationId: string,
    userId: string,
    params: {
      purpose: BillingPurpose;
      amount: number;
      description: string;
      returnPath: string;
      modules?: ModuleKey[];
      period?: BillingPeriod;
      credit?: number;
    },
  ) {
    if (!this.gateway) {
      throw new ServiceUnavailableException(
        'Online payment is not configured on this server.',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const externalId = `ws-${params.purpose === BillingPurpose.SUBSCRIPTION ? 'sub' : 'wa'}-${randomBytes(9).toString('hex')}`;
    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    const session = await this.gateway.createCheckout({
      externalId,
      amount: params.amount,
      description: params.description,
      payerEmail: user?.email,
      successRedirectUrl: `${appUrl}${params.returnPath}?payment=${externalId}`,
      failureRedirectUrl: `${appUrl}${params.returnPath}?payment=${externalId}&failed=1`,
    });

    return this.prisma.billingPayment.create({
      data: {
        organizationId,
        purpose: params.purpose,
        amount: params.amount,
        modules: params.modules ?? [],
        period: params.period,
        credit: params.credit,
        gateway: this.gateway.name,
        externalId,
        gatewayInvoiceId: session.gatewayInvoiceId,
        checkoutUrl: session.checkoutUrl,
        expiresAt: session.expiresAt,
        createdById: userId,
      },
    });
  }

  async getPayment(organizationId: string, externalId: string) {
    const payment = await this.prisma.billingPayment.findFirst({
      where: { organizationId, externalId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  // ---- settlement --------------------------------------------------------

  // Webhook from Xendit. The callback token proves the request came from
  // Xendit; the status is still re-read from Xendit's API before anything
  // is applied, so a replayed or forged body can't mark a payment paid.
  async handleXenditWebhook(
    callbackToken: string | undefined,
    body: { external_id?: string },
  ) {
    const expected = process.env.XENDIT_CALLBACK_TOKEN;
    if (!expected || !callbackToken || !safeEqual(callbackToken, expected)) {
      throw new UnauthorizedException('Invalid callback token');
    }
    if (!body.external_id) return { ok: true };
    const payment = await this.prisma.billingPayment.findUnique({
      where: { externalId: body.external_id },
    });
    if (
      !payment ||
      !payment.gatewayInvoiceId ||
      !this.gateway ||
      this.gateway.name !== 'xendit'
    ) {
      return { ok: true };
    }
    const status = await this.gateway.fetchStatus(payment.gatewayInvoiceId);
    if (status === 'PAID') await this.markPaid(payment.id);
    else if (status === 'EXPIRED') await this.markExpired(payment.id);
    return { ok: true };
  }

  // Dev/test stand-in for the gateway's checkout page (FakeGateway). Only
  // ever reachable for payments the fake gateway created.
  async fakePay(organizationId: string, externalId: string) {
    const payment = await this.getPayment(organizationId, externalId);
    if (payment.gateway !== 'fake' || process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Only test payments can be completed here');
    }
    return this.markPaid(payment.id);
  }

  // Idempotent: the row is locked and appliedAt checked, so a webhook
  // delivered twice (or racing the redirect) applies the payment once.
  async markPaid(paymentId: string, paidAt = new Date()) {
    const applied = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BillingPayment" WHERE id = ${paymentId} FOR UPDATE`;
      const payment = await tx.billingPayment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      if (payment.appliedAt) return null;
      const applier = this.appliers.get(payment.purpose);
      if (!applier)
        throw new Error(`No billing applier registered for ${payment.purpose}`);
      await applier(tx, payment);
      return tx.billingPayment.update({
        where: { id: paymentId },
        data: {
          status: BillingPaymentStatus.PAID,
          paidAt,
          appliedAt: new Date(),
        },
      });
    });
    if (!applied)
      return this.prisma.billingPayment.findUniqueOrThrow({
        where: { id: paymentId },
      });

    const admins = await this.adminIds(applied.organizationId);
    await this.notifications.createMany(
      applied.organizationId,
      admins,
      'BILLING_PAYMENT_RECEIVED',
      applied.purpose === BillingPurpose.SUBSCRIPTION
        ? 'Subscription payment received'
        : 'WhatsApp balance topped up',
      {
        link:
          applied.purpose === BillingPurpose.SUBSCRIPTION
            ? '/settings/billing'
            : '/settings/whatsapp',
      },
    );
    return applied;
  }

  private async markExpired(paymentId: string) {
    await this.prisma.billingPayment.updateMany({
      where: { id: paymentId, status: BillingPaymentStatus.PENDING },
      data: { status: BillingPaymentStatus.EXPIRED },
    });
  }

  // Each module bought runs one more period from its own paid-until, or —
  // bought during the trial — from the trial's end, so paying early doesn't
  // forfeit the trial days left; otherwise from today. The module stays on
  // GRACE_DAYS past that, so a late renewal doesn't cut anyone off; a
  // module the platform owner granted with no expiry stays that way.
  private async applySubscription(
    tx: Tx,
    payment: {
      organizationId: string;
      modules: ModuleKey[];
      period: BillingPeriod | null;
    },
  ) {
    if (!payment.period || payment.modules.length === 0) {
      throw new Error('Subscription payment is missing its modules or period');
    }
    const now = new Date();
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: payment.organizationId },
      select: { plan: true, trialEndsAt: true, paidUntil: true },
    });
    const trialEnd =
      org.plan === 'trial' && org.trialEndsAt && org.trialEndsAt > now
        ? org.trialEndsAt
        : now;
    let latest: Date | null = null;
    for (const module of payment.modules) {
      const row = await tx.organizationModule.findUnique({
        where: {
          organizationId_module: {
            organizationId: payment.organizationId,
            module,
          },
        },
      });
      const from =
        row?.paidUntil && row.paidUntil > trialEnd ? row.paidUntil : trialEnd;
      const paidUntil = addPeriod(from, payment.period);
      const grantedForever = !!row?.enabled && row.expiresAt === null;
      const expiresAt = grantedForever
        ? null
        : new Date(paidUntil.getTime() + GRACE_DAYS * DAY_MS);
      await tx.organizationModule.upsert({
        where: {
          organizationId_module: {
            organizationId: payment.organizationId,
            module,
          },
        },
        update: { enabled: true, paidUntil, expiresAt },
        create: {
          organizationId: payment.organizationId,
          module,
          enabled: true,
          paidUntil,
          expiresAt,
        },
      });
      if (!latest || paidUntil > latest) latest = paidUntil;
    }
    // Organization.paidUntil mirrors the furthest-out module, for the
    // platform console's payment column and effectivePlan().
    await tx.organization.update({
      where: { id: payment.organizationId },
      data: {
        plan: 'subscription',
        paidUntil:
          org.paidUntil && latest && org.paidUntil > latest
            ? org.paidUntil
            : latest,
      },
    });
  }

  // ---- trial -------------------------------------------------------------

  // Called by AuthService.register for self-serve signups: every module
  // for TRIAL_DAYS, switched off by its expiry (ModuleGuard).
  async startTrial(organizationId: string) {
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * DAY_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: { plan: 'trial', trialEndsAt },
      });
      for (const module of TRIAL_MODULES) {
        const existing = await tx.organizationModule.findUnique({
          where: { organizationId_module: { organizationId, module } },
        });
        if (
          existing?.enabled &&
          (existing.expiresAt === null || existing.expiresAt >= trialEndsAt)
        )
          continue;
        await tx.organizationModule.upsert({
          where: { organizationId_module: { organizationId, module } },
          update: { enabled: true, expiresAt: trialEndsAt },
          create: {
            organizationId,
            module,
            enabled: true,
            expiresAt: trialEndsAt,
          },
        });
      }
    });
  }

  // Daily reminder to admins three days and one day before a trial ends or
  // a subscribed module's paid period runs out. Nothing changes here —
  // modules lapse on their own expiry.
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async remindExpiring() {
    const now = Date.now();
    for (const daysLeft of [3, 1]) {
      const window = {
        gt: new Date(now + (daysLeft - 1) * DAY_MS),
        lte: new Date(now + daysLeft * DAY_MS),
      };
      const [trials, modules] = await Promise.all([
        this.prisma.organization.findMany({
          where: { plan: 'trial', trialEndsAt: window },
          select: { id: true },
        }),
        this.prisma.organizationModule.findMany({
          // A module granted for good never needs renewing.
          where: { enabled: true, paidUntil: window, expiresAt: { not: null } },
          select: { organizationId: true, module: true },
        }),
      ]);
      const when = `${daysLeft} day${daysLeft > 1 ? 's' : ''}`;
      for (const org of trials) {
        await this.notifications.createMany(
          org.id,
          await this.adminIds(org.id),
          'PLAN_EXPIRING',
          `Your free trial ends in ${when}`,
          {
            body: 'Subscribe to the modules you use to keep them running.',
            link: '/settings/billing',
          },
        );
      }
      const byOrg = new Map<string, ModuleKey[]>();
      for (const m of modules)
        byOrg.set(m.organizationId, [
          ...(byOrg.get(m.organizationId) ?? []),
          m.module,
        ]);
      for (const [orgId, mods] of byOrg) {
        await this.notifications.createMany(
          orgId,
          await this.adminIds(orgId),
          'PLAN_EXPIRING',
          `${mods.map((m) => MODULE_NAMES[m]).join(', ')} ${mods.length > 1 ? 'renew' : 'renews'} in ${when}`,
          {
            body: await this.renewalBody(orgId, mods),
            link: '/settings/billing',
          },
        );
      }
    }
  }

  // When a module about to run out is one that another, still-paid module
  // depends on (MODULE_PRICES.requires), the reminder says the dependent
  // stops too — otherwise a paid Workshop just goes dark.
  private async renewalBody(organizationId: string, expiring: ModuleKey[]) {
    for (const p of MODULE_PRICES) {
      if (
        !p.requires ||
        !expiring.includes(p.requires) ||
        expiring.includes(p.module)
      )
        continue;
      const dependent = await this.prisma.organizationModule.findUnique({
        where: { organizationId_module: { organizationId, module: p.module } },
      });
      if (isPaid(dependent))
        return `Renew to keep using it without interruption — ${MODULE_NAMES[p.module]} also stops working without ${MODULE_NAMES[p.requires]}.`;
    }
    return 'Renew to keep using it without interruption.';
  }

  private async adminIds(organizationId: string) {
    const admins = await this.prisma.user.findMany({
      where: { organizationId, role: 'ADMIN', active: true, removedAt: null },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }
}

// Paid for and still running (its paid period or the grace days after
// it), or granted with no expiry. A trial module has no paidUntil.
function isPaid(row: { enabled: boolean; expiresAt: Date | null; paidUntil: Date | null } | null | undefined) {
  if (!row?.enabled) return false;
  return (
    row.expiresAt === null || (!!row.paidUntil && row.expiresAt > new Date())
  );
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
