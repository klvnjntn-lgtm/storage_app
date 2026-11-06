import { ExecutionContext, ForbiddenException, HttpException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcrypt';

jest.mock('puppeteer', () => ({ __esModule: true, default: { launch: jest.fn() } }));

import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { NO_API_KEY } from './auth/decorators/no-api-key.decorator';
import { ROLES_KEY } from './auth/decorators/roles.decorator';
import { BRANCH_RECORD_KEY } from './auth/guards/branch-record.guard';
import { isTwoFactorSetupRoute } from './auth/jwt.strategy';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { LoginLockout } from './auth/login-lockout';
import { TwoFactorController } from './auth/two-factor.controller';
import { ApiAccessController } from './api-access/api-access.controller';
import { ApiKeysService } from './api-access/api-keys.service';
import { PlatformOwnerGuard } from './platform/platform-owner.guard';
import { MessagingController } from './messaging/messaging.controller';
import { MessagingService } from './messaging/messaging.service';
import { InvoiceService } from './invoice/invoice.service';
import { InvoiceController } from './invoice/invoice.controller';
import { WorkOrdersController } from './work-orders/work-orders.controller';

const context = (cls: any, handler: any, request: object) =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('API keys on routes closed to them', () => {
  const principal = { sub: 'u', role: 'ADMIN', organizationId: 'o', apiKeyId: 'k', readOnly: false };
  const guard = new JwtAuthGuard(new Reflector(), { authenticate: async () => principal } as unknown as ApiKeysService);
  const call = (cls: any, handler: any, path: string) => {
    const request: any = { path, method: 'POST', headers: { authorization: 'Bearer wsk_dummy' } };
    return Promise.resolve(guard.canActivate(context(cls, handler, request))).then(() => request);
  };

  it.each([
    ['/integrations-api/keys'],
    ['/INTEGRATIONS-API/keys'],
    ['/Integrations-Api/keys/'],
  ])('refuses %s, whatever the spelling', async (path) => {
    await expect(call(ApiAccessController, ApiAccessController.prototype.createKey, path)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['AuthController', AuthController, AuthController.prototype.invite, '/AUTH/invite'],
    ['TwoFactorController', TwoFactorController, TwoFactorController.prototype.policy, '/AUTH/2fa/policy'],
    ['TwoFactorController setup', TwoFactorController, TwoFactorController.prototype.setup, '/Auth/2fa/setup'],
  ])('refuses %s', async (_label, cls, handler, path) => {
    await expect(call(cls, handler, path)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still lets a key use ordinary routes', async () => {
    const request = await call(InvoiceController, InvoiceController.prototype.getOne, '/invoices/1');
    expect(request.user).toBe(principal);
  });

  it('marks every controller under the closed prefixes', () => {
    for (const cls of [AuthController, TwoFactorController, ApiAccessController]) {
      expect(Reflect.getMetadata(NO_API_KEY, cls)).toBe(true);
    }
  });

  it('caps a new key at the role of the credential asking for it', async () => {
    const prisma = {
      user: { findFirst: async () => ({ role: 'MASTER' }) },
      apiKey: { create: jest.fn(async ({ data }) => ({ id: 'n', ...data })) },
    };
    const keys = new ApiKeysService(prisma as any);
    await expect(keys.create('o', 'u', { name: 'x', role: 'MASTER' as any }, 'ADMIN')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.apiKey.create).not.toHaveBeenCalled();
    await expect(keys.create('o', 'u', { name: 'x', role: 'ADMIN' as any }, 'ADMIN')).resolves.toBeTruthy();
    await expect(keys.create('o', 'u', { name: 'x', role: 'MASTER' as any }, 'MASTER')).resolves.toBeTruthy();
  });
});

describe('platform console', () => {
  const owner = 'owner@example.test';
  const row = {
    id: 'u', email: owner, role: 'MASTER', active: true, removedAt: null, organizationId: 'o',
    isPlatformOwner: true, currentSessionId: 's', platformUnlockSessionId: 's',
    platformUnlockedUntil: new Date(Date.now() + 60_000),
  };
  const saved = process.env.PLATFORM_OWNER_EMAILS;
  beforeAll(() => { process.env.PLATFORM_OWNER_EMAILS = owner; });
  afterAll(() => { process.env.PLATFORM_OWNER_EMAILS = saved; });
  const guard = new PlatformOwnerGuard({ user: { findUnique: async () => row } } as any, new Reflector());
  class C { h() {} }

  it('refuses an owner API key during an unlock window', async () => {
    await expect(guard.canActivate(context(C, C.prototype.h, { user: { sub: 'u', apiKeyId: 'k' } }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still lets the unlocked owner session in', async () => {
    await expect(guard.canActivate(context(C, C.prototype.h, { user: { sub: 'u' } }))).resolves.toBe(true);
  });
});

describe('two-factor lockout', () => {
  const email = 'victim@example.test';
  const password = 'dummy-password';
  const build = async () => {
    const user = { id: 'u', email, password: await bcrypt.hash(password, 4), active: true, role: 'MASTER', organizationId: 'o', totpEnabledAt: new Date(), accessSchedules: [], organization: {} };
    const svc: any = Object.create(AuthService.prototype);
    svc.loginLockout = new LoginLockout();
    svc.prisma = { user: { findUnique: async () => user } };
    svc.twoFactor = {
      createChallenge: () => 'challenge',
      readChallenge: () => 'u',
      verifyCode: jest.fn(async (_id: string, code: string) => {
        if (code !== 'right') throw new Error('wrong code');
      }),
    };
    svc.issueToken = jest.fn(async () => ({ accessToken: 't' }));
    return svc;
  };
  const wrong = (svc: any) => expect(svc.completeTwoFactorLogin('challenge', 'wrong')).rejects.toThrow('wrong code');

  it('keeps counting wrong codes across a fresh password login', async () => {
    const svc = await build();
    await svc.login(email, password);
    for (let i = 0; i < 4; i++) await wrong(svc);
    await svc.login(email, password);
    await wrong(svc);
    await expect(svc.completeTwoFactorLogin('challenge', 'wrong')).rejects.toBeInstanceOf(HttpException);
    await expect(svc.login(email, password)).rejects.toBeInstanceOf(HttpException);
    expect(svc.twoFactor.verifyCode).toHaveBeenCalledTimes(5);
  });

  it('clears the count once a login is finished', async () => {
    const svc = await build();
    await svc.login(email, password);
    for (let i = 0; i < 4; i++) await wrong(svc);
    await svc.completeTwoFactorLogin('challenge', 'right');
    for (let i = 0; i < 4; i++) await wrong(svc);
    await expect(svc.completeTwoFactorLogin('challenge', 'right')).resolves.toBeTruthy();
  });
});

describe('two-factor setup gate and policy', () => {
  it.each(['/auth/me', '/auth/logout', '/auth/2fa', '/auth/2fa/setup', '/auth/2fa/enable', '/auth/2fa/'])('leaves %s open', (path) => {
    expect(isTwoFactorSetupRoute(path)).toBe(true);
  });

  it.each(['/auth/2fa/policy', '/auth/invite', '/auth/2fa/disable', '/auth/change-password', '/AUTH/2fa/policy', '/invoices'])('holds %s shut', (path) => {
    expect(isTwoFactorSetupRoute(path)).toBe(false);
  });

  it('keeps the org requirement to MASTER', () => {
    expect(Reflect.getMetadata(ROLES_KEY, TwoFactorController.prototype.policy)).toEqual(['MASTER']);
  });
});

describe('branch isolation', () => {
  it('sends a statement with the member branch only', async () => {
    const send = jest.fn(async () => ({}));
    const prisma = { organization: { findUniqueOrThrow: async () => ({ timezone: 'Asia/Jakarta' }) } };
    const controller = new MessagingController({ sendStatement: send } as any, prisma as any);
    const dto: any = { customerId: 'c', periodFrom: '2026-01-01', periodTo: '2026-02-01', channel: 'EMAIL' };
    await controller.sendStatement('o', { sub: 'u', branchId: 'branch-b' } as any, dto);
    expect((send.mock.calls[0] as unknown[])[5]).toBe('branch-b');
    await controller.sendStatement('o', { sub: 'm', branchId: null } as any, dto);
    expect((send.mock.calls[1] as unknown[])[5]).toBeUndefined();
  });

  it('builds the statement with that branch', async () => {
    const svc: any = Object.create(MessagingService.prototype);
    const stop = new Error('stop here');
    const getCustomerStatement = jest.fn(async () => { throw stop; });
    svc.invoices = { getCustomerStatement };
    await expect(svc.sendStatement('o', 'u', 'c', { from: new Date(), to: new Date() }, {}, 'branch-b')).rejects.toBe(stop);
    expect((getCustomerStatement.mock.calls[0] as unknown[])[5]).toBe('branch-b');
  });

  it('checks the quotation branch when converting to a work order', () => {
    expect(Reflect.getMetadata(BRANCH_RECORD_KEY, WorkOrdersController.prototype.fromQuotation)).toEqual({ model: 'salesQuotation', param: 'quotationId' });
  });
});

describe('issued invoice edits', () => {
  it('refuses an employee of another organization before anything else runs', async () => {
    const svc: any = Object.create(InvoiceService.prototype);
    const count = jest.fn();
    svc.prisma = { productSerial: { count } };
    svc.tenantOwnership = { validate: jest.fn(async () => { throw new NotFoundException('Employee not found'); }) };
    await expect(svc.editIssuedInvoice('org-a', 'inv', { items: [], reason: 'x', employeeId: 'foreign' }, 'u')).rejects.toBeInstanceOf(NotFoundException);
    expect(svc.tenantOwnership.validate).toHaveBeenCalledWith('org-a', { employeeId: 'foreign' });
    expect(count).not.toHaveBeenCalled();
  });
});
