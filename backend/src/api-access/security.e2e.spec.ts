import 'dotenv/config';
import { createHmac, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { configureApp } from '../configure-app';
import { AppModule } from '../app.module';
import { LicenseService } from '../license/license.service';
import { MailerService } from '../auth/mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../auth/session-cookie';
import { base32Encode, totpCode, verifyTotp } from '../auth/totp';
import { open, seal } from '../auth/secret-box';
import { ApiKeysService } from './api-keys.service';
import { WebhooksService } from './webhooks.service';
import { assertPublicWebhookUrl, isPrivateAddress } from './webhook-url';

process.env.PRINT_TOKEN_SECRET ??= 'test-print-secret';
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B secret, SHA-1; the 8-digit vectors end in these 6.
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC test vectors', () => {
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts one step of clock drift and nothing else', () => {
    const now = 1111111109 * 1000;
    expect(verifyTotp(secret, '081804', now)).not.toBeNull();
    expect(
      verifyTotp(secret, totpCode(secret, Math.floor(now / 30000) - 1), now),
    ).not.toBeNull();
    expect(
      verifyTotp(secret, totpCode(secret, Math.floor(now / 30000) - 3), now),
    ).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('seals secrets so the stored value is not the secret', () => {
    const sealed = seal(secret);
    expect(sealed).not.toContain(secret);
    expect(open(sealed)).toBe(secret);
    expect(() => open(sealed.slice(0, -2) + 'AA')).toThrow();
  });
});

describe('webhook URL safety', () => {
  it('flags private, loopback and metadata addresses', () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '192.168.1.4',
      '172.20.0.5',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
  });

  it('refuses internal targets and non-https in production', async () => {
    await expect(
      assertPublicWebhookUrl('http://127.0.0.1:5432/x', true),
    ).rejects.toThrow(/public internet address/);
    await expect(
      assertPublicWebhookUrl('http://93.184.216.34/hook', false),
    ).rejects.toThrow(/https/);
    await expect(
      assertPublicWebhookUrl('https://user:pw@93.184.216.34/hook'),
    ).rejects.toThrow(/credentials/);
    await expect(
      assertPublicWebhookUrl('https://93.184.216.34/hook'),
    ).resolves.toBeInstanceOf(URL);
  });
});

// Through the real guard stack, like session-cookie.spec.ts.
describe('two-factor sign-in, API keys and webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let adminId: string;
  const email = `sec-${randomUUID()}@example.com`;
  const password = 'correct-horse-battery';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LicenseService)
      .useValue({
        isValid: () => true,
        getStatus: () => ({ valid: true }),
        getEdition: () => 'cloud',
        onModuleInit: async () => {},
      })
      .overrideProvider(MailerService)
      .useValue({ onModuleInit: async () => {}, isConfigured: () => false })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    prisma = moduleRef.get(PrismaService);

    orgId = (
      await prisma.organization.create({
        data: { name: `Security ${randomUUID()}`, seatLimit: 5 },
      })
    ).id;
    await prisma.organizationModule.create({
      data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true },
    });
    adminId = (
      await prisma.user.create({
        data: {
          email,
          password: await bcrypt.hash(password, 4),
          role: 'ADMIN',
          organizationId: orgId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const cookieOf = (res: request.Response) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).join('; ');

  async function login() {
    const res = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return res;
  }

  it('asks for a code after the password once 2FA is on, and accepts a recovery code once', async () => {
    const first = await login();
    const cookie = cookieOf(first);
    const write = (path: string, body: object) =>
      http()
        .post(path)
        .set('Cookie', cookie)
        .set(CSRF_HEADER, CSRF_HEADER_VALUE)
        .send(body);

    const setup = await write('/auth/2fa/setup', {}).expect(201);
    expect(setup.body.qrCode).toMatch(/^data:image\/png;base64,/);
    await write('/auth/2fa/enable', { code: '000000' }).expect(400);
    const step = Math.floor(Date.now() / 30000);
    const enabled = await write('/auth/2fa/enable', {
      code: totpCode(setup.body.secret, step),
    }).expect(201);
    expect(enabled.body.recoveryCodes).toHaveLength(10);

    const challenge = await login();
    expect(challenge.body).toMatchObject({ mfaRequired: true });
    expect(cookieOf(challenge)).not.toContain('waresys');
    await http()
      .post('/auth/login/2fa')
      .send({ mfaToken: challenge.body.mfaToken, code: '123456' })
      .expect(401);
    await http()
      .post('/auth/login/2fa')
      .send({
        mfaToken: challenge.body.mfaToken,
        code: totpCode(setup.body.secret, Math.floor(Date.now() / 30000)),
      })
      .expect(201);

    const recovery = enabled.body.recoveryCodes[0];
    const again = await login();
    await http()
      .post('/auth/login/2fa')
      .send({ mfaToken: again.body.mfaToken, code: recovery })
      .expect(201);
    const third = await login();
    await http()
      .post('/auth/login/2fa')
      .send({ mfaToken: third.body.mfaToken, code: recovery })
      .expect(401);
  });

  it('authenticates API keys as their creator, enforcing read-only and revocation', async () => {
    const keys = app.get(ApiKeysService);
    const rw = await keys.create(orgId, adminId, { name: 'ERP sync' });
    const ro = await keys.create(orgId, adminId, {
      name: 'BI',
      readOnly: true,
    });
    const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });

    await http().get('/customers').set(bearer(rw.key)).expect(200);
    await http()
      .post('/customers')
      .set(bearer(rw.key))
      .send({ name: 'From API' })
      .expect(201);
    await http()
      .post('/customers')
      .set(bearer(ro.key))
      .send({ name: 'Nope' })
      .expect(403);
    // USER-level key: admin-only finance routes stay closed.
    await http().get('/supplier-payments').set(bearer(rw.key)).expect(403);
    // Keys can't manage keys.
    await http().get('/integrations-api/keys').set(bearer(rw.key)).expect(403);

    await keys.revoke(orgId, rw.id);
    await http().get('/customers').set(bearer(rw.key)).expect(401);
    await http()
      .get('/customers')
      .set(bearer('wsk_not-a-real-key'))
      .expect(401);
  });

  it('signs webhook deliveries and retries failures with backoff', async () => {
    const webhooks = app.get(WebhooksService);
    const endpoint = await webhooks.create(orgId, {
      url: 'https://93.184.216.34/hook',
      events: ['invoice.issued'],
    });
    await expect(
      webhooks.create(orgId, {
        url: 'https://93.184.216.34/hook',
        events: ['nope'],
      }),
    ).rejects.toThrow(/Unknown events/);

    const calls: { headers: Record<string, string>; body: string }[] = [];
    const realFetch = global.fetch;
    let status = 500;
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      calls.push({
        headers: init!.headers as Record<string, string>,
        body: String(init!.body),
      });
      return new Response(null, { status });
    }) as typeof fetch;
    try {
      await webhooks.emit(orgId, 'invoice.issued', { id: 'inv_1' });
      await webhooks.emit(orgId, 'invoice.voided', { id: 'inv_1' }); // not subscribed
      const [queued] = await prisma.webhookDelivery.findMany({
        where: { endpointId: endpoint.id },
      });

      await webhooks.deliver(queued.id);
      let row = await prisma.webhookDelivery.findUniqueOrThrow({
        where: { id: queued.id },
      });
      expect(row).toMatchObject({
        status: 'PENDING',
        attempts: 1,
        lastStatusCode: 500,
      });
      expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      const sig = calls[0].headers['X-WareSys-Signature'];
      const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(sig)!;
      expect(
        createHmac('sha256', endpoint.secret)
          .update(`${t}.${calls[0].body}`)
          .digest('hex'),
      ).toBe(v1);

      status = 204;
      await prisma.webhookDelivery.update({
        where: { id: queued.id },
        data: { nextAttemptAt: new Date() },
      });
      await webhooks.dispatchDue();
      row = await prisma.webhookDelivery.findUniqueOrThrow({
        where: { id: queued.id },
      });
      expect(row).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
      expect(
        await prisma.webhookDelivery.count({
          where: { endpointId: endpoint.id },
        }),
      ).toBe(1);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('starts a trial on signup only when self-serve billing is switched on', async () => {
    const signup = async () => {
      const e = `trial-${randomUUID()}@example.com`;
      await http()
        .post('/auth/register')
        .send({ email: e, password, organizationName: 'Trial Co' })
        .expect(201);
      const u = await prisma.user.findUniqueOrThrow({
        where: { email: e },
        include: { organization: true },
      });
      return u.organization;
    };
    const previous = process.env.SELF_SERVE_BILLING;
    try {
      delete process.env.SELF_SERVE_BILLING;
      expect((await signup()).plan).toBe('custom');
      process.env.SELF_SERVE_BILLING = 'true';
      const org = await signup();
      expect(org.plan).toBe('trial');
      expect(org.trialEndsAt).not.toBeNull();
    } finally {
      process.env.SELF_SERVE_BILLING = previous;
    }
  });
});
