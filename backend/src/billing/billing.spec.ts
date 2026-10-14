import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ModuleKey } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { BillingModule } from './billing.module';
import { BillingService } from './billing.service';
import { PlanLimitsService } from './plan-limits.service';
import {
  addPeriod,
  effectivePlan,
  GRACE_DAYS,
  modulePrice,
  TRIAL_MODULES,
} from './plans';

const DAY = 86_400_000;

describe('plans', () => {
  const now = new Date('2026-10-15T00:00:00Z');

  it('keeps custom and unknown plans unlimited, and ends trials as free', () => {
    expect(effectivePlan({ plan: 'custom', trialEndsAt: null }, now)).toBe(
      'custom',
    );
    expect(effectivePlan({ plan: 'pro-legacy', trialEndsAt: null }, now)).toBe(
      'custom',
    );
    expect(
      effectivePlan(
        { plan: 'trial', trialEndsAt: new Date(now.getTime() + DAY) },
        now,
      ),
    ).toBe('trial');
    expect(
      effectivePlan(
        { plan: 'trial', trialEndsAt: new Date(now.getTime() - 1) },
        now,
      ),
    ).toBe('free');
    expect(
      effectivePlan({ plan: 'subscription', trialEndsAt: null }, now),
    ).toBe('subscription');
  });

  it('prices each module by month or year', () => {
    expect(modulePrice(ModuleKey.INVOICE_POS, 'MONTH')).toBe(300_000);
    expect(modulePrice(ModuleKey.INVOICE_POS, 'YEAR')).toBe(3_000_000);
    expect(modulePrice(ModuleKey.WORKSHOP_RMS, 'MONTH')).toBe(360_000);
    expect(modulePrice(ModuleKey.WORKSHOP_RMS, 'YEAR')).toBe(3_600_000);
    expect(modulePrice(ModuleKey.DELIVERY_DMS, 'MONTH')).toBe(700_000);
    expect(modulePrice(ModuleKey.DELIVERY_DMS, 'YEAR')).toBe(7_000_000);
    expect(modulePrice(ModuleKey.WAREHOUSE_OPS, 'MONTH')).toBe(400_000);
    expect(modulePrice(ModuleKey.WAREHOUSE_OPS, 'YEAR')).toBe(4_000_000);
  });

  it('adds calendar months and years', () => {
    expect(
      addPeriod(new Date('2026-01-15T00:00:00Z'), 'MONTH').toISOString(),
    ).toBe('2026-02-15T00:00:00.000Z');
    expect(
      addPeriod(new Date('2026-01-15T00:00:00Z'), 'YEAR').toISOString(),
    ).toBe('2027-01-15T00:00:00.000Z');
  });
});

// Runs against the isolated test DB (see test/setup-test-env.ts).
describe('Billing (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let billing: BillingService;
  let limits: PlanLimitsService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, BillingModule],
    }).compile();
    prisma = module.get(PrismaService);
    billing = module.get(BillingService);
    limits = module.get(PlanLimitsService);
  });

  afterAll(async () => {
    await module?.close();
  });

  async function newOrg() {
    const org = await prisma.organization.create({
      data: { name: `Billing ${randomUUID()}` },
    });
    const admin = await prisma.user.create({
      data: {
        email: `bill-${randomUUID()}@example.com`,
        password: 'x',
        role: 'ADMIN',
        organizationId: org.id,
      },
    });
    return { orgId: org.id, adminId: admin.id };
  }

  const moduleRow = (organizationId: string, module: ModuleKey) =>
    prisma.organizationModule.findUnique({
      where: { organizationId_module: { organizationId, module } },
    });

  it('leaves orgs on the custom plan without any limit but seats', async () => {
    const { orgId, adminId } = await newOrg();
    await prisma.location.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        id: `${orgId}_l${i}`,
        name: `L${i}`,
        organizationId: orgId,
      })),
    });
    await expect(
      limits.assertCanAdd(orgId, 'locations'),
    ).resolves.toBeUndefined();
    await expect(limits.assertCanAdd(orgId, 'seats')).rejects.toMatchObject({
      response: { error: 'PlanLimitReached', resource: 'seats' },
    });
    await expect(
      billing.createSubscriptionCheckout(
        orgId,
        adminId,
        [ModuleKey.INVOICE_POS],
        'MONTH',
      ),
    ).rejects.toThrow(/managed by WareSys support/);
  });

  it('starts a trial with every module and the trial limits', async () => {
    const { orgId } = await newOrg();
    await billing.startTrial(orgId);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
    });
    expect(org.plan).toBe('trial');
    const modules = await prisma.organizationModule.findMany({
      where: { organizationId: orgId, enabled: true },
    });
    expect(modules.map((m) => m.module).sort()).toEqual(
      [...TRIAL_MODULES].sort(),
    );
    expect(
      modules.every(
        (m) => m.expiresAt?.getTime() === org.trialEndsAt?.getTime(),
      ),
    ).toBe(true);

    await prisma.location.createMany({
      data: Array.from({ length: 2 }, (_, i) => ({
        id: `${orgId}_t${i}`,
        name: `T${i}`,
        organizationId: orgId,
      })),
    });
    await expect(limits.assertCanAdd(orgId, 'locations')).rejects.toMatchObject(
      {
        response: { error: 'PlanLimitReached', plan: 'trial' },
      },
    );
  });

  it('charges the sum of the modules and extends each from its own paid-until, once', async () => {
    const { orgId, adminId } = await newOrg();
    await billing.startTrial(orgId);

    const payment = await billing.createSubscriptionCheckout(
      orgId,
      adminId,
      [ModuleKey.INVOICE_POS, ModuleKey.WORKSHOP_RMS],
      'YEAR',
    );
    expect(Number(payment.amount)).toBe(6_600_000);

    await billing.markPaid(payment.id);
    await billing.markPaid(payment.id); // a duplicate webhook changes nothing
    const pos = (await moduleRow(orgId, ModuleKey.INVOICE_POS))!;
    const days = (pos.paidUntil!.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(367);
    expect(pos.expiresAt!.getTime() - pos.paidUntil!.getTime()).toBe(
      GRACE_DAYS * DAY,
    );
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } }))
        .plan,
    ).toBe('subscription');
    await expect(
      limits.assertCanAdd(orgId, 'seats', 50),
    ).resolves.toBeUndefined();

    // Renewing early stacks on the current paid-until; other modules untouched.
    const renewal = await billing.createSubscriptionCheckout(
      orgId,
      adminId,
      [ModuleKey.INVOICE_POS],
      'MONTH',
    );
    expect(Number(renewal.amount)).toBe(300_000);
    await billing.markPaid(renewal.id);
    const after = (await moduleRow(orgId, ModuleKey.INVOICE_POS))!;
    expect(after.paidUntil!.toISOString()).toBe(
      addPeriod(pos.paidUntil!, 'MONTH').toISOString(),
    );
    expect(
      (await moduleRow(orgId, ModuleKey.WORKSHOP_RMS))!.paidUntil!.getTime(),
    ).toBe(pos.paidUntil!.getTime());
  });

  it('does not let a trial Invoice & POS stand in for a paid one', async () => {
    const { orgId, adminId } = await newOrg();
    await billing.startTrial(orgId);
    await expect(
      billing.createSubscriptionCheckout(orgId, adminId, [ModuleKey.WORKSHOP_RMS], 'MONTH'),
    ).rejects.toThrow(/needs Invoice & POS/);
  });

  it('only sells Workshop with Invoice & POS active or in the same checkout', async () => {
    const { orgId, adminId } = await newOrg();
    await prisma.organization.update({
      where: { id: orgId },
      data: { plan: 'subscription' },
    });
    await expect(
      billing.createSubscriptionCheckout(
        orgId,
        adminId,
        [ModuleKey.WORKSHOP_RMS],
        'MONTH',
      ),
    ).rejects.toThrow(/needs Invoice & POS/);
    await expect(
      billing.createSubscriptionCheckout(
        orgId,
        adminId,
        [ModuleKey.WORKSHOP_RMS, ModuleKey.INVOICE_POS],
        'MONTH',
      ),
    ).resolves.toMatchObject({
      modules: expect.arrayContaining([ModuleKey.WORKSHOP_RMS]),
    });
  });

  it('keeps a module the platform owner granted forever without an expiry', async () => {
    const { orgId, adminId } = await newOrg();
    await prisma.organization.update({
      where: { id: orgId },
      data: { plan: 'subscription' },
    });
    await prisma.organizationModule.create({
      data: {
        organizationId: orgId,
        module: ModuleKey.DELIVERY_DMS,
        enabled: true,
      },
    });
    const payment = await billing.createSubscriptionCheckout(
      orgId,
      adminId,
      [ModuleKey.DELIVERY_DMS],
      'MONTH',
    );
    await billing.markPaid(payment.id);
    const row = (await moduleRow(orgId, ModuleKey.DELIVERY_DMS))!;
    expect(row.expiresAt).toBeNull();
    expect(row.paidUntil).not.toBeNull();
  });

  it('rejects webhooks without the callback token', async () => {
    const previous = process.env.XENDIT_CALLBACK_TOKEN;
    process.env.XENDIT_CALLBACK_TOKEN = 'secret-token';
    try {
      await expect(
        billing.handleXenditWebhook('wrong', { external_id: 'x' }),
      ).rejects.toThrow('Invalid callback token');
      await expect(
        billing.handleXenditWebhook(undefined, { external_id: 'x' }),
      ).rejects.toThrow('Invalid callback token');
      await expect(
        billing.handleXenditWebhook('secret-token', { external_id: 'unknown' }),
      ).resolves.toEqual({ ok: true });
    } finally {
      process.env.XENDIT_CALLBACK_TOKEN = previous;
    }
  });
});
