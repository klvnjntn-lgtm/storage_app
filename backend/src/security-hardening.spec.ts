import 'dotenv/config';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { LoginLockout } from './auth/login-lockout';
import { redactCostFields } from './common/interceptors/redact-cost.interceptor';
import { isPushServiceEndpoint } from './notifications/dto/push-subscription.dto';
import { withPdfRenderSlot } from './common/print/pdf-render-limiter';
import { UsersService } from './users/users.service';
import { DevicesService } from './auth/devices.service';
import type { NotificationsService } from './notifications/notifications.service';

// Regression tests for the security/logic hardening pass: login lockout,
// cost redaction, push endpoint validation, the PDF render cap, the
// last-admin / self-lock guards, and the device-revoke bypass.

describe('LoginLockout', () => {
  it('locks an email after 5 failures for 15 minutes, then lets it try again', () => {
    let now = 1_000_000;
    const lockout = new LoginLockout(() => now);
    for (let i = 0; i < 4; i++) lockout.recordFailure('a@x.com');
    expect(() => lockout.assertNotLocked('a@x.com')).not.toThrow();
    lockout.recordFailure('a@x.com');
    expect(() => lockout.assertNotLocked('a@x.com')).toThrow(HttpException);
    // Other accounts are unaffected.
    expect(() => lockout.assertNotLocked('b@x.com')).not.toThrow();
    now += 15 * 60 * 1000 + 1;
    expect(() => lockout.assertNotLocked('a@x.com')).not.toThrow();
  });

  it('forgets failures on success and after the window passes', () => {
    let now = 0;
    const lockout = new LoginLockout(() => now);
    for (let i = 0; i < 4; i++) lockout.recordFailure('a@x.com');
    lockout.recordSuccess('a@x.com');
    lockout.recordFailure('a@x.com');
    expect(() => lockout.assertNotLocked('a@x.com')).not.toThrow();

    for (let i = 0; i < 4; i++) lockout.recordFailure('c@x.com');
    now += 16 * 60 * 1000; // window expired — count restarts
    lockout.recordFailure('c@x.com');
    expect(() => lockout.assertNotLocked('c@x.com')).not.toThrow();
  });
});

describe('redactCostFields', () => {
  const body = {
    id: 'inv1',
    items: [{ unitCost: 5, unitPrice: 9, product: { name: 'A', costPrice: 5, sellingPrice: 9 } }],
    when: new Date(0),
  };

  it('strips costPrice and unitCost at any depth, leaving the rest', () => {
    const out = redactCostFields(body, '/invoices/inv1') as typeof body;
    expect(out.items[0]).toEqual({ unitPrice: 9, product: { name: 'A', sellingPrice: 9 } });
    expect(out.when).toBeInstanceOf(Date);
    // The original object is not mutated.
    expect(body.items[0].unitCost).toBe(5);
  });

  it('keeps unitCost on purchasing routes, where it is the purchase price', () => {
    const out = redactCostFields(body, '/purchase-orders/po1') as typeof body;
    expect(out.items[0].unitCost).toBe(5);
    expect(out.items[0].product).not.toHaveProperty('costPrice');
  });
});

describe('isPushServiceEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (url) => expect(isPushServiceEndpoint(url)).toBe(true));

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc', // not https
    'https://vroom:3000/',
    'https://169.254.169.254/latest/meta-data',
    'https://fcm.googleapis.com.evil.com/x',
    'https://evilfcm.googleapis.com.example/x',
    'https://fcm.googleapis.com:8443/x', // non-default port
    'not a url',
  ])('rejects %s', (url) => expect(isPushServiceEndpoint(url)).toBe(false));
});

describe('withPdfRenderSlot', () => {
  it('never runs more than 2 renders at once', async () => {
    let running = 0;
    let peak = 0;
    const render = () =>
      withPdfRenderSlot(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
      });
    await Promise.all(Array.from({ length: 6 }, render));
    expect(peak).toBe(2);
    expect(running).toBe(0);
  });

  it('frees the slot when a render throws', async () => {
    await expect(withPdfRenderSlot(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(withPdfRenderSlot(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});

describe('member and device guards (database)', () => {
  const prisma = new PrismaService();
  const notifications = {
    create: jest.fn(),
    notifyOrgStaff: jest.fn(),
  } as unknown as NotificationsService;
  const users = new UsersService(prisma, notifications);
  const devices = new DevicesService(prisma, notifications);

  let orgId: string;
  let adminId: string;
  let otherAdminId: string;
  let driverId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: `Hardening ${randomUUID()}`, seatLimit: 10 } });
    orgId = org.id;
    const mk = (role: 'ADMIN' | 'USER' | 'DRIVER') =>
      prisma.user.create({
        data: { email: `${role.toLowerCase()}-${randomUUID()}@example.com`, password: 'x', role, organizationId: orgId },
      });
    adminId = (await mk('ADMIN')).id;
    otherAdminId = (await mk('ADMIN')).id;
    driverId = (await mk('DRIVER')).id;
  });

  afterAll(async () => {
    await prisma.device.deleteMany({ where: { user: { organizationId: orgId } } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it("won't let an admin lock their own account", async () => {
    await expect(users.setActive(orgId, adminId, adminId, false)).rejects.toThrow(/own account/);
  });

  it("won't lock or demote the last active admin", async () => {
    await users.setActive(orgId, adminId, otherAdminId, false);
    await expect(users.setRole(orgId, otherAdminId, adminId, 'USER')).rejects.toThrow(/last active admin/);
    // otherAdmin is locked, so adminId is the last active admin.
    await users.setActive(orgId, adminId, otherAdminId, true);
  });

  it('changes a role and ends that member’s session', async () => {
    await prisma.user.update({ where: { id: otherAdminId }, data: { currentSessionId: 's1' } });
    const updated = await users.setRole(orgId, adminId, otherAdminId, 'USER');
    expect(updated.role).toBe('USER');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: otherAdminId } });
    expect(row.currentSessionId).toBeNull();
    await expect(users.setRole(orgId, adminId, adminId, 'USER')).rejects.toThrow(/own role/);
  });

  it('auto-approves only a driver’s very first device, so a revoke sticks', async () => {
    expect(await devices.registerOrCheck(orgId, driverId, 'phone-1')).toBe('OK');
    const first = await prisma.device.findFirstOrThrow({ where: { userId: driverId, deviceId: 'phone-1' } });
    await devices.revoke(orgId, first.id);
    expect(await devices.registerOrCheck(orgId, driverId, 'phone-1')).toBe('REJECTED');
    // A fresh device id after the revoke waits for an admin instead of
    // being approved automatically.
    expect(await devices.registerOrCheck(orgId, driverId, 'phone-2')).toBe('PENDING');
  });
});
