import 'dotenv/config';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from '../configure-app';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../app.module';
import { LicenseService } from '../license/license.service';
import { MailerService } from './mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_COOKIE } from './session-cookie';

process.env.PRINT_TOKEN_SECRET ??= 'test-print-secret';
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// End-to-end check of the cookie session through the real guard stack:
// the token is only ever an httpOnly cookie, cookie-authenticated writes
// need the CSRF header, and logout clears both the cookie and the session.
describe('session cookie (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string | undefined;
  const email = `cookie-${randomUUID()}@example.com`;
  const password = 'correct-horse-battery';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LicenseService)
      .useValue({ isValid: () => true, getStatus: () => ({ valid: true }), getEdition: () => 'cloud', onModuleInit: async () => {} })
      .overrideProvider(MailerService)
      .useValue({ onModuleInit: async () => {}, sendPasswordReset: jest.fn(), sendChangePasswordOtp: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication); // same parsers/pipes/headers as main.ts
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (orgId) {
      await prisma.user.deleteMany({ where: { organizationId: orgId } });
      await prisma.priceLevel.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    await app.close();
  });

  const sessionCookie = (res: request.Response) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${SESSION_COOKIE}=`));

  it('register sets an httpOnly cookie and never returns the token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, organizationName: 'Cookie Org' })
      .expect(201);
    expect(res.body).toEqual({ ok: true });
    const cookie = sessionCookie(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    orgId = user.organizationId;
  });

  it('authenticates reads with the cookie and requires the CSRF header on writes', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
    expect(login.body).toEqual({ ok: true });
    const cookie = sessionCookie(login)!.split(';')[0];

    await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(200);

    // Same write, without and with the header.
    await request(app.getHttpServer()).patch('/auth/me').set('Cookie', cookie).send({ avatarUrl: null }).expect(403);
    await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'waresys')
      .send({ avatarUrl: null })
      .expect(200);

    // avatarUrl must be a media-library path.
    await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'waresys')
      .send({ avatarUrl: 'https://tracker.example/pixel.png' })
      .expect(400);

    // Logout needs the header, clears the cookie and ends the session.
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie).expect(403);
    const out = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'waresys')
      .expect(201);
    expect(sessionCookie(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(401);
  });

  it.each(['invoices', 'sales-orders', 'delivery-orders', 'purchase-orders', 'quotations'])(
    'print/%s is reachable without a session (the print token is the auth)',
    async (doc) => {
      // 403 from the print-token check, not 401 from the login guard —
      // these routes used to 401, so every non-invoice PDF came out blank.
      const res = await request(app.getHttpServer()).get(`/print/${doc}/some-id?token=not-a-token`);
      expect(res.status).toBe(403);
      expect((res.body as { message: string }).message).toMatch(/print token/i);
    },
  );

  it('keeps the 100kb JSON limit everywhere except the two import routes', async () => {
    // Regression: mounting express.json() directly for the import routes
    // made Nest skip its global JSON parser, so every other route received
    // an empty body.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever1' })
      .expect(401); // parsed: wrong credentials, not a validation error
    const big = { rows: Array.from({ length: 3000 }, () => 'x'.repeat(100)) }; // ~300kb
    await request(app.getHttpServer()).post('/customers/import').send(big).expect(413);
    // Parsed (so it reaches the auth check) rather than rejected as too large.
    await request(app.getHttpServer()).post('/stock/import').send(big).expect(401);
  });

  it('gates finance and destructive routes from staff (USER role)', async () => {
    await prisma.organizationModule.create({ data: { organizationId: orgId!, module: 'INVOICE_POS', enabled: true } });
    const userEmail = `staff-${randomUUID()}@example.com`;
    await prisma.user.create({
      data: { email: userEmail, password: await bcrypt.hash(password, 4), role: 'USER', organizationId: orgId! },
    });
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: userEmail, password }).expect(201);
    const cookie = sessionCookie(login)!.split(';')[0];
    const as = (req: request.Test) => req.set('Cookie', cookie).set('X-Requested-With', 'waresys');

    await as(request(app.getHttpServer()).get('/accounting/reports/profit-loss')).expect(403);
    await as(request(app.getHttpServer()).get('/expenses')).expect(403);
    await as(request(app.getHttpServer()).get('/supplier-payments')).expect(403);
    await as(request(app.getHttpServer()).delete(`/customers/${randomUUID()}`)).expect(403);
    await as(request(app.getHttpServer()).post('/teams').send({ name: 'x' })).expect(403);
    // Still open: period status for the invoice page, and day-to-day reads.
    await as(request(app.getHttpServer()).get('/accounting/fiscal-periods')).expect(200);
    await as(request(app.getHttpServer()).get('/customers')).expect(200);

    // Supplier activation can't be flipped through the general update…
    const supplier = await prisma.supplier.create({ data: { organizationId: orgId!, name: 'Gate Supplier' } });
    await as(request(app.getHttpServer()).patch(`/suppliers/${supplier.id}`).send({ isActive: false })).expect(403);
    // …but an ordinary edit that resends the current isActive still works.
    await as(request(app.getHttpServer()).patch(`/suppliers/${supplier.id}`).send({ name: 'Renamed', isActive: true })).expect(200);
    await prisma.supplier.delete({ where: { id: supplier.id } });
    await prisma.organizationModule.deleteMany({ where: { organizationId: orgId! } });
  });

  it('locks an account after repeated wrong passwords', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'wrong-password' }).expect(401);
    }
    // Even the right password is refused while locked.
    await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(429);
  });
});
