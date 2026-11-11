import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { JournalEntryStatus, SystemAccountKey, WorkOrderStatus } from '@prisma/client';

jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

import { AuthService } from './auth/auth.service';
import { LoginLockout } from './auth/login-lockout';
import { deviceIdFor, issueDeviceToken, lockoutKey } from './auth/device-cookie';
import { SessionRenewalInterceptor } from './auth/session-renewal.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { StorageModule } from './storage/storage.module';
import { DeliveryRoutesModule } from './delivery-routes/delivery-routes.module';
import { DeliveryRoutesService } from './delivery-routes/delivery-routes.service';
import { GdbImportModule } from './gdb-import/gdb-import.module';
import { GdbImportService } from './gdb-import/gdb-import.service';
import { WorkOrdersModule } from './work-orders/work-orders.module';
import { WorkOrdersService } from './work-orders/work-orders.service';
import { ChartOfAccountsSeedService } from './accounting/chart-of-accounts-seed.service';
import { AccountingReportsService } from './accounting/accounting-reports.service';

process.env.JWT_SECRET ??= 'test-secret';

describe('login lockout with device cookies', () => {
  const email = 'owner@example.test';
  const password = 'right-password';
  const build = async () => {
    const user = { id: 'u', email, password: await bcrypt.hash(password, 4), active: true, role: 'MASTER', organizationId: 'o', accessSchedules: [], organization: {} };
    const svc: any = Object.create(AuthService.prototype);
    svc.loginLockout = new LoginLockout();
    svc.prisma = { user: { findUnique: async () => user } };
    svc.issueToken = jest.fn(async () => ({ accessToken: 't' }));
    return svc;
  };

  it('keeps the owner’s own browser working while strangers are locked out', async () => {
    const svc = await build();
    const { deviceToken } = await svc.login(email, password);
    for (let i = 0; i < 5; i++) await expect(svc.login(email, 'guess')).rejects.toThrow('Invalid credentials');
    // The stranger is locked…
    await expect(svc.login(email, password)).rejects.toBeInstanceOf(HttpException);
    // …the owner, on a browser that signed in before, is not.
    await expect(svc.login(email, password, undefined, undefined, deviceToken)).resolves.toMatchObject({ accessToken: 't' });
  });

  it('still locks guesses made from a known browser', async () => {
    const svc = await build();
    const { deviceToken } = await svc.login(email, password);
    for (let i = 0; i < 5; i++) {
      await expect(svc.login(email, 'guess', undefined, undefined, deviceToken)).rejects.toThrow('Invalid credentials');
    }
    await expect(svc.login(email, password, undefined, undefined, deviceToken)).rejects.toBeInstanceOf(HttpException);
  });

  it('refuses a forged, tampered or other account’s cookie', () => {
    const token = issueDeviceToken(email);
    expect(deviceIdFor(token, email)).toBeTruthy();
    expect(deviceIdFor(token, 'someone@else.test')).toBeNull();
    expect(deviceIdFor(`${token.slice(0, -2)}xx`, email)).toBeNull();
    expect(deviceIdFor('a.b.c.d', email)).toBeNull();
    expect(lockoutKey(email, 'junk')).toBe(email);
  });
});

describe('session renewal', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const interceptor = new SessionRenewalInterceptor(jwt);
  const claims = { sub: 'u', email: 'a@b.c', role: 'ADMIN', organizationId: 'o', sessionId: 's' };
  const run = (token: string) => {
    const setCookie = jest.fn();
    const req: any = { path: '/invoices', headers: { cookie: `waresys_session=${token}` }, user: { sub: 'u' }, secure: false };
    const res: any = { cookie: setCookie };
    const context: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
    interceptor.intercept(context, { handle: () => ({}) as any });
    return setCookie;
  };
  const daysAgo = (d: number) => Math.floor(Date.now() / 1000) - d * 86_400;

  it('leaves a fresh token alone', () => {
    expect(run(jwt.sign({ ...claims, loginAt: Date.now() }))).not.toHaveBeenCalled();
  });

  it('renews a day-old token, keeping the session and sign-in time', () => {
    const loginAt = Date.now() - 2 * 86_400_000;
    const setCookie = run(jwt.sign({ ...claims, loginAt, iat: daysAgo(2) }));
    expect(setCookie).toHaveBeenCalledTimes(1);
    const renewed = jwt.decode(setCookie.mock.calls[0][1]) as any;
    expect(renewed).toMatchObject({ sessionId: 's', loginAt });
    expect(renewed.exp - renewed.iat).toBe(7 * 86_400);
  });

  it('stops renewing 30 days after sign-in, and never runs past that', () => {
    expect(run(jwt.sign({ ...claims, loginAt: Date.now() - 31 * 86_400_000, iat: daysAgo(2) }))).not.toHaveBeenCalled();
    const setCookie = run(jwt.sign({ ...claims, loginAt: Date.now() - 28 * 86_400_000, iat: daysAgo(2) }));
    const renewed = jwt.decode(setCookie.mock.calls[0][1]) as any;
    expect(renewed.exp * 1000).toBeLessThanOrEqual(Date.now() - 28 * 86_400_000 + 30 * 86_400_000 + 1000);
  });
});

describe('second-pass fixes (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let orgId: string;
  let adminId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, StorageModule, DeliveryRoutesModule, GdbImportModule, WorkOrdersModule],
    }).compile();
    prisma = module.get(PrismaService);
    orgId = (await prisma.organization.create({ data: { name: `Second pass ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    adminId = (
      await prisma.user.create({
        data: { email: `sp-${randomUUID()}@example.com`, password: 'x', role: 'MASTER', organizationId: orgId },
      })
    ).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  it('creates one route per team per day even when two requests race', async () => {
    const routes = module.get(DeliveryRoutesService);
    const teamId = (await prisma.team.create({ data: { organizationId: orgId, name: `T ${randomUUID().slice(0, 4)}` } })).id;
    const results = await Promise.allSettled([
      routes.createRoute(orgId, adminId, { teamId, routeDate: '2031-03-03' } as any),
      routes.createRoute(orgId, adminId, { teamId, routeDate: '2031-03-03' } as any),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.route.count({ where: { teamId } })).toBe(1);
  });

  it('refuses bringing a cancelled route back onto a day the team already has', async () => {
    const routes = module.get(DeliveryRoutesService);
    const teamId = (await prisma.team.create({ data: { organizationId: orgId, name: `T ${randomUUID().slice(0, 4)}` } })).id;
    const first = await routes.createRoute(orgId, adminId, { teamId, routeDate: '2031-04-04' } as any);
    await routes.updateRoute(orgId, first.id, { status: 'CANCELLED' } as any, adminId);
    await routes.createRoute(orgId, adminId, { teamId, routeDate: '2031-04-04' } as any);
    await expect(routes.updateRoute(orgId, first.id, { status: 'PLANNED' } as any, adminId)).rejects.toThrow(
      'already has a route on that date',
    );
  });

  it('books stock brought in by the Accurate import, and only the change on a re-import', async () => {
    const gdb: any = module.get(GdbImportService);
    const locationId = (await prisma.location.create({ data: { name: 'CENTRE', organizationId: orgId } })).id;
    const categoryId = (await prisma.category.create({ data: { name: `Imported ${randomUUID().slice(0, 4)}`, organizationId: orgId } })).id;
    const product = async (cost: number | null) =>
      (
        await prisma.product.create({
          data: { name: 'Item', sku: `A-${randomUUID().slice(0, 8)}`, categoryId, organizationId: orgId, costPrice: cost },
        })
      ).id;
    const [a, b, noCost] = [await product(10_000), await product(2_500), await product(null)];

    const first = await gdb.bookImportedStock(
      orgId,
      locationId,
      new Map(),
      new Map([[a, 4], [b, 2], [noCost, 9]]),
      new Map([[a, 10_000], [b, 2_500], [noCost, null]]),
    );
    expect(first).toMatchObject({ movements: 3, valueIn: 45_000, valueOut: 0 });

    // Re-import: a sold one in Accurate, b unchanged.
    const second = await gdb.bookImportedStock(
      orgId,
      locationId,
      new Map([[a, 4], [b, 2]]),
      new Map([[a, 3], [b, 2]]),
      new Map([[a, 10_000], [b, 2_500]]),
    );
    expect(second).toMatchObject({ movements: 1, valueIn: 0, valueOut: 10_000 });

    const inventory = await prisma.chartOfAccount.findFirstOrThrow({
      where: { organizationId: orgId, systemKey: SystemAccountKey.INVENTORY },
    });
    const agg = await prisma.journalEntryLine.aggregate({
      where: { accountId: inventory.id, journalEntry: { status: JournalEntryStatus.POSTED } },
      _sum: { debit: true, credit: true },
    });
    expect(Number(agg._sum.debit) - Number(agg._sum.credit)).toBe(35_000);
    expect(await prisma.event.count({ where: { organizationId: orgId, type: 'IMPORT_REPLACE' } })).toBe(4);
  });

  it('lists and reminds about finished jobs that were never invoiced', async () => {
    const workOrders = module.get(WorkOrdersService);
    await prisma.organization.update({ where: { id: orgId }, data: { workOrdersEnabled: true } });
    const customer = await prisma.customer.create({ data: { organizationId: orgId, name: 'Bengkel Test' } });
    const plate = `B${Math.floor(Math.random() * 9999)}SP`;
    const vehicle = await prisma.vehicle.create({
      data: { organizationId: orgId, customerId: customer.id, plateNumber: plate, plateNormalized: plate, vehicleModel: 'Avanza' },
    });
    const job = (status: WorkOrderStatus, completedAt: Date | null) =>
      prisma.workOrder.create({
        data: { organizationId: orgId, number: `WO-${randomUUID().slice(0, 6)}`, status, customerId: customer.id, vehicleId: vehicle.id, completedAt },
      });
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const unbilled = await job(WorkOrderStatus.DONE, twoDaysAgo);
    await job(WorkOrderStatus.IN_PROGRESS, null);

    const listed = await workOrders.list(orgId, { unbilled: true });
    expect(listed.map((w) => w.id)).toEqual([unbilled.id]);

    await workOrders.remindUnbilled();
    const note = await prisma.notification.findFirst({ where: { organizationId: orgId, type: 'WORK_ORDER_UNBILLED' } });
    expect(note).toMatchObject({ title: '1 finished job not invoiced yet', link: '/workshop/work-orders?filter=UNBILLED' });
  });

  it('values imported stock in the stock check once booked', async () => {
    const check = await module.get(AccountingReportsService).getInventoryReconciliation(orgId);
    expect(check.productsWithoutCost.count).toBe(0); // no Stock rows were written in this test
    expect(check.ledgerBalance).toBe(35_000);
  });
});
