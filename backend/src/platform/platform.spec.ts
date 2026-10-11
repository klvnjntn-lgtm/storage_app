import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ModuleKey } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { PlatformModule } from './platform.module';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AllowSuspendedOrg } from '../auth/decorators/allow-suspended-org.decorator';
import { MailerService } from '../auth/mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';

// Stands in for JwtAuthGuard: the user comes off a header. Everything
// after it — OrgGuard, RolesGuard, PlatformOwnerGuard — is the real thing.
const fakeJwt: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header = req.headers['x-test-user'];
    if (header) req.user = JSON.parse(header as string);
    return true;
  },
};

// Two plain org routes, to check what a suspended org can still reach.
@Controller('probe')
class ProbeController {
  @Get('data')
  data() {
    return { ok: true };
  }

  @AllowSuspendedOrg()
  @Get('me')
  me() {
    return { ok: true };
  }
}

const PASSWORD = 'correct-horse-battery';

describe('Platform console', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentCodes: string[] = [];
  const mailer = {
    sendPlatformUnlockCode: jest.fn(async (_to: string, code: string) => {
      sentCodes.push(code);
    }),
  };

  let ownerOrgId: string;
  let customerOrgId: string;
  let owner: { id: string; email: string };
  let otherAdmin: { id: string; email: string };
  let customerUser: { id: string; email: string };
  let driver: { id: string; email: string };
  const savedEnv = process.env.PLATFORM_OWNER_EMAILS;

  const as = (
    u: { id: string; email: string },
    orgId: string,
    role = 'ADMIN',
  ) =>
    JSON.stringify({ sub: u.id, email: u.email, role, organizationId: orgId });
  const asOwner = () => as(owner, ownerOrgId);

  async function makeUser(
    orgId: string,
    role: 'ADMIN' | 'USER' | 'DRIVER',
    extra = {},
  ) {
    return prisma.user.create({
      data: {
        email: `${role.toLowerCase()}-${randomUUID()}@example.com`,
        password: await bcrypt.hash(PASSWORD, 4),
        role,
        organizationId: orgId,
        currentSessionId: randomUUID(),
        ...extra,
      },
      select: { id: true, email: true },
    });
  }

  async function unlock() {
    await request(app.getHttpServer())
      .post('/platform/unlock/request')
      .set('x-test-user', asOwner())
      .send({ password: PASSWORD })
      .expect(200);
    await request(app.getHttpServer())
      .post('/platform/unlock/confirm')
      .set('x-test-user', asOwner())
      .send({ code: sentCodes[sentCodes.length - 1] })
      .expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, PlatformModule],
      controllers: [ProbeController],
      providers: [
        { provide: APP_GUARD, useValue: fakeJwt },
        { provide: APP_GUARD, useClass: OrgGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);

    ownerOrgId = (
      await prisma.organization.create({
        data: { name: `Owner ${randomUUID()}` },
      })
    ).id;
    customerOrgId = (
      await prisma.organization.create({
        data: { name: `Customer ${randomUUID()}` },
      })
    ).id;
    owner = await makeUser(ownerOrgId, 'ADMIN', { isPlatformOwner: true });
    otherAdmin = await makeUser(ownerOrgId, 'ADMIN');
    driver = await makeUser(ownerOrgId, 'DRIVER', { isPlatformOwner: true });
    customerUser = await makeUser(customerOrgId, 'USER');
    process.env.PLATFORM_OWNER_EMAILS = `someone-else@example.com, ${owner.email.toUpperCase()}, ${driver.email}`;
  });

  afterAll(async () => {
    process.env.PLATFORM_OWNER_EMAILS = savedEnv;
    const orgs = [ownerOrgId, customerOrgId];
    await prisma.platformAuditLog.deleteMany({
      where: { actorUserId: { in: [owner.id, otherAdmin.id, driver.id] } },
    });
    await prisma.organizationModule.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await app.close();
  });

  describe('who can get in', () => {
    it('hides the console (404) from an admin who is not a platform owner', async () => {
      await request(app.getHttpServer())
        .get('/platform/session')
        .set('x-test-user', as(otherAdmin, ownerOrgId))
        .expect(404);
    });

    it('hides it when the owner flag is set but the email is not allowlisted', async () => {
      await prisma.user.update({
        where: { id: otherAdmin.id },
        data: { isPlatformOwner: true },
      });
      try {
        await request(app.getHttpServer())
          .get('/platform/session')
          .set('x-test-user', as(otherAdmin, ownerOrgId))
          .expect(404);
      } finally {
        await prisma.user.update({
          where: { id: otherAdmin.id },
          data: { isPlatformOwner: false },
        });
      }
    });

    it('hides it from everyone when PLATFORM_OWNER_EMAILS is empty', async () => {
      const saved = process.env.PLATFORM_OWNER_EMAILS;
      process.env.PLATFORM_OWNER_EMAILS = '';
      try {
        await request(app.getHttpServer())
          .get('/platform/session')
          .set('x-test-user', asOwner())
          .expect(404);
      } finally {
        process.env.PLATFORM_OWNER_EMAILS = saved;
      }
    });

    it('keeps a driver out even with the flag and the allowlist', async () => {
      await request(app.getHttpServer())
        .get('/platform/session')
        .set('x-test-user', as(driver, ownerOrgId, 'DRIVER'))
        .expect(403);
    });

    it('ignores a token that claims ADMIN when the account is not', async () => {
      // RolesGuard trusts the token's role, PlatformOwnerGuard re-reads it.
      await request(app.getHttpServer())
        .get('/platform/session')
        .set('x-test-user', as(driver, ownerOrgId, 'ADMIN'))
        .expect(404);
    });

    it('rejects an anonymous request', async () => {
      await request(app.getHttpServer())
        .get('/platform/organizations')
        .expect(403);
    });

    it('lets the owner see the session but not the data until unlocked', async () => {
      const res = await request(app.getHttpServer())
        .get('/platform/session')
        .set('x-test-user', asOwner())
        .expect(200);
      expect(res.body.unlocked).toBe(false);

      const locked = await request(app.getHttpServer())
        .get('/platform/organizations')
        .set('x-test-user', asOwner())
        .expect(403);
      expect(locked.body.code).toBe('PLATFORM_LOCKED');
    });
  });

  describe('unlock', () => {
    afterEach(async () => {
      await prisma.user.update({
        where: { id: owner.id },
        data: {
          platformUnlockSessionId: null,
          platformUnlockedUntil: null,
          platformOtpHash: null,
        },
      });
    });

    it('refuses a wrong password, sends no code, and audits it', async () => {
      const sentBefore = sentCodes.length;
      await request(app.getHttpServer())
        .post('/platform/unlock/request')
        .set('x-test-user', asOwner())
        .send({ password: 'wrong' })
        .expect(400);
      expect(sentCodes.length).toBe(sentBefore);
      const audit = await prisma.platformAuditLog.findFirst({
        where: { actorUserId: owner.id, action: 'unlock.password_failed' },
      });
      expect(audit).not.toBeNull();
    });

    it('unlocks with password + emailed code, then opens the data', async () => {
      await unlock();
      await request(app.getHttpServer())
        .get('/platform/organizations')
        .set('x-test-user', asOwner())
        .expect(200);
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: owner.id },
      });
      expect(stored.platformOtpHash).toBeNull(); // code can't be reused
    });

    it('rejects a malformed code before touching the stored one', async () => {
      await request(app.getHttpServer())
        .post('/platform/unlock/confirm')
        .set('x-test-user', asOwner())
        .send({ code: '12345a' })
        .expect(400);
    });

    it('burns the code after 5 wrong tries, even if the right one comes next', async () => {
      await request(app.getHttpServer())
        .post('/platform/unlock/request')
        .set('x-test-user', asOwner())
        .send({ password: PASSWORD })
        .expect(200);
      const code = sentCodes[sentCodes.length - 1];
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/platform/unlock/confirm')
          .set('x-test-user', asOwner())
          .send({ code: wrong })
          .expect(400);
      }
      await request(app.getHttpServer())
        .post('/platform/unlock/confirm')
        .set('x-test-user', asOwner())
        .send({ code })
        .expect(400);
      await request(app.getHttpServer())
        .get('/platform/organizations')
        .set('x-test-user', asOwner())
        .expect(403);
    });

    it('ends with a new login session', async () => {
      await unlock();
      await prisma.user.update({
        where: { id: owner.id },
        data: { currentSessionId: randomUUID() },
      });
      await request(app.getHttpServer())
        .get('/platform/organizations')
        .set('x-test-user', asOwner())
        .expect(403);
    });

    it('ends when it expires', async () => {
      await unlock();
      await prisma.user.update({
        where: { id: owner.id },
        data: { platformUnlockedUntil: new Date(Date.now() - 1000) },
      });
      await request(app.getHttpServer())
        .get('/platform/organizations')
        .set('x-test-user', asOwner())
        .expect(403);
    });

    it('ends on lock', async () => {
      await unlock();
      await request(app.getHttpServer())
        .post('/platform/lock')
        .set('x-test-user', asOwner())
        .expect(200);
      await request(app.getHttpServer())
        .get('/platform/organizations')
        .set('x-test-user', asOwner())
        .expect(403);
    });
  });

  describe('managing organizations', () => {
    beforeAll(unlock);

    it('lists organizations with seat use', async () => {
      const res = await request(app.getHttpServer())
        .get('/platform/organizations')
        .set('x-test-user', asOwner())
        .expect(200);
      const customer = res.body.find(
        (o: { id: string }) => o.id === customerOrgId,
      );
      expect(customer).toMatchObject({ seatsUsed: 1, suspendedAt: null });
    });

    it('updates billing fields, ignores anything else, and audits before/after', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/platform/organizations/${customerOrgId}`)
        .set('x-test-user', asOwner())
        .send({
          plan: 'pro',
          seatLimit: 5,
          paidUntil: '2026-12-31T00:00:00.000Z',
          name: 'Hacked',
          suspendedAt: null,
        })
        .expect(200);
      expect(res.body).toMatchObject({ plan: 'pro', seatLimit: 5 });
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: customerOrgId },
      });
      expect(org.name).not.toBe('Hacked');

      const audit = await prisma.platformAuditLog.findFirstOrThrow({
        where: { organizationId: customerOrgId, action: 'organization.update' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.before).toMatchObject({
        plan: 'free',
        seatLimit: 1,
        paidUntil: null,
      });
      expect(audit.after).toMatchObject({ plan: 'pro', seatLimit: 5 });
      expect(audit.actorEmail).toBe(owner.email);
    });

    it('rejects invalid values', async () => {
      for (const body of [
        { seatLimit: 0 },
        { plan: 'Pro Plan!' },
        { paidUntil: 'soon' },
        {},
      ]) {
        await request(app.getHttpServer())
          .patch(`/platform/organizations/${customerOrgId}`)
          .set('x-test-user', asOwner())
          .send(body)
          .expect(400);
      }
    });

    it('rejects a non-UUID id', async () => {
      await request(app.getHttpServer())
        .get('/platform/organizations/not-a-uuid')
        .set('x-test-user', asOwner())
        .expect(400);
    });

    it('turns modules on and off', async () => {
      await request(app.getHttpServer())
        .put(
          `/platform/organizations/${customerOrgId}/modules/${ModuleKey.INVOICE_POS}`,
        )
        .set('x-test-user', asOwner())
        .send({ enabled: true })
        .expect(200);
      await request(app.getHttpServer())
        .put(
          `/platform/organizations/${customerOrgId}/modules/${ModuleKey.INVOICE_POS}`,
        )
        .set('x-test-user', asOwner())
        .send({ enabled: false })
        .expect(200);
      const row = await prisma.organizationModule.findUniqueOrThrow({
        where: {
          organizationId_module: {
            organizationId: customerOrgId,
            module: ModuleKey.INVOICE_POS,
          },
        },
      });
      expect(row.enabled).toBe(false);
      await request(app.getHttpServer())
        .put(`/platform/organizations/${customerOrgId}/modules/NOT_A_MODULE`)
        .set('x-test-user', asOwner())
        .send({ enabled: true })
        .expect(400);
    });

    it('suspends an org: its members are blocked everywhere but /me', async () => {
      const asCustomer = as(customerUser, customerOrgId, 'USER');
      await request(app.getHttpServer())
        .get('/probe/data')
        .set('x-test-user', asCustomer)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/platform/organizations/${customerOrgId}/suspend`)
        .set('x-test-user', asOwner())
        .send({ reason: 'Payment overdue' })
        .expect(200);

      const blocked = await request(app.getHttpServer())
        .get('/probe/data')
        .set('x-test-user', asCustomer)
        .expect(403);
      expect(blocked.body.code).toBe('ORG_SUSPENDED');
      await request(app.getHttpServer())
        .get('/probe/me')
        .set('x-test-user', asCustomer)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/platform/organizations/${customerOrgId}/reactivate`)
        .set('x-test-user', asOwner())
        .expect(200);
      await request(app.getHttpServer())
        .get('/probe/data')
        .set('x-test-user', asCustomer)
        .expect(200);
    });

    it('refuses to suspend the owner’s own organization', async () => {
      await request(app.getHttpServer())
        .post(`/platform/organizations/${ownerOrgId}/suspend`)
        .set('x-test-user', asOwner())
        .send({ reason: 'oops' })
        .expect(400);
    });

    it('needs a reason to suspend', async () => {
      await request(app.getHttpServer())
        .post(`/platform/organizations/${customerOrgId}/suspend`)
        .set('x-test-user', asOwner())
        .send({ reason: '' })
        .expect(400);
    });

    it('shows the audit trail for an org', async () => {
      const res = await request(app.getHttpServer())
        .get(`/platform/audit-log?organizationId=${customerOrgId}`)
        .set('x-test-user', asOwner())
        .expect(200);
      const actions = res.body.map((r: { action: string }) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'organization.update',
          'module.enable',
          'module.disable',
          'organization.suspend',
          'organization.reactivate',
        ]),
      );
    });
  });
});
