import 'dotenv/config';
import { randomUUID } from 'crypto';
import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ModuleKey } from '@prisma/client';
import request from 'supertest';
import { OrganizationModule } from './organization.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { PrismaService } from '../prisma/prisma.service';

// Stands in for real JWT verification: reads the role/org/user this test
// wants for the request off a header, so RolesGuard (the thing actually
// under test) sees a real req.user the same way it would in production.
function fakeAuthGuard(): CanActivate {
  return {
    canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest();
      const header = req.headers['x-test-user'];
      if (header) req.user = JSON.parse(header as string);
      return true;
    },
  };
}

describe('OrganizationController — stock policy settings access control', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let adminUserId: string;
  let regularUserId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [OrganizationModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeAuthGuard())
      // OrgGuard's own logic (org exists, sets request.organizationId) is
      // real and worth exercising — only the JWT part is faked above.
      .compile();

    app = module.createNestApplication();
    await app.init();
    prisma = module.get(PrismaService);

    const org = await prisma.organization.create({ data: { name: `Test Org ${randomUUID()}` } });
    orgId = org.id;
    await prisma.organizationModule.create({
      data: { organizationId: orgId, module: ModuleKey.INVOICE_POS, enabled: true },
    });

    const admin = await prisma.user.create({
      data: { email: `admin-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
    });
    adminUserId = admin.id;
    const regular = await prisma.user.create({
      data: { email: `user-${randomUUID()}@example.com`, password: 'x', role: 'USER', organizationId: orgId },
    });
    regularUserId = regular.id;
  });

  afterAll(async () => {
    await prisma.settingsAuditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationModule.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await app.close();
  });

  function asUser(role: 'ADMIN' | 'USER', userId: string) {
    return JSON.stringify({ sub: userId, role, organizationId: orgId });
  }

  it('GET /organization/settings — 403 for a non-admin', async () => {
    await request(app.getHttpServer())
      .get('/organization/settings')
      .set('x-test-user', asUser('USER', regularUserId))
      .expect(403);
  });

  it('PATCH /organization/settings — 403 for a non-admin', async () => {
    await request(app.getHttpServer())
      .patch('/organization/settings')
      .set('x-test-user', asUser('USER', regularUserId))
      .send({ stockPolicy: 'WARN' })
      .expect(403);
  });

  it('PATCH /organization/settings — admin can update stockPolicy, and it is audit-logged', async () => {
    const res = await request(app.getHttpServer())
      .patch('/organization/settings')
      .set('x-test-user', asUser('ADMIN', adminUserId))
      .send({ stockPolicy: 'WARN' })
      .expect(200);

    expect(res.body.stockPolicy).toBe('WARN');

    const logs = await prisma.settingsAuditLog.findMany({
      where: { organizationId: orgId, field: 'stockPolicy' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].oldValue).toBe('BLOCK');
    expect(logs[0].newValue).toBe('WARN');
    expect(logs[0].userId).toBe(adminUserId);
  });

  it('GET /organization/settings — admin can read the updated policy', async () => {
    const res = await request(app.getHttpServer())
      .get('/organization/settings')
      .set('x-test-user', asUser('ADMIN', adminUserId))
      .expect(200);
    expect(res.body.stockPolicy).toBe('WARN');
  });

  it('PATCH /organization/settings — rejects an invalid stockPolicy value', async () => {
    await request(app.getHttpServer())
      .patch('/organization/settings')
      .set('x-test-user', asUser('ADMIN', adminUserId))
      .send({ stockPolicy: 'NOT_A_REAL_POLICY' })
      .expect(400);
  });
});

describe('OrganizationController — stock policy is locked for WAREHOUSE_OPS orgs', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let adminUserId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [OrganizationModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeAuthGuard())
      .compile();

    app = module.createNestApplication();
    await app.init();
    prisma = module.get(PrismaService);

    const org = await prisma.organization.create({ data: { name: `Test Org WHOps ${randomUUID()}` } });
    orgId = org.id;
    await prisma.organizationModule.createMany({
      data: [
        { organizationId: orgId, module: ModuleKey.INVOICE_POS, enabled: true },
        { organizationId: orgId, module: ModuleKey.WAREHOUSE_OPS, enabled: true },
      ],
    });
    const admin = await prisma.user.create({
      data: { email: `admin-whops-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
    });
    adminUserId = admin.id;
  });

  afterAll(async () => {
    await prisma.organizationModule.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await app.close();
  });

  function asAdmin() {
    return JSON.stringify({ sub: adminUserId, role: 'ADMIN', organizationId: orgId });
  }

  it('PATCH /organization/settings — rejects setting stockPolicy while WAREHOUSE_OPS is enabled', async () => {
    await request(app.getHttpServer())
      .patch('/organization/settings')
      .set('x-test-user', asAdmin())
      .send({ stockPolicy: 'ALLOW' })
      .expect(400);
  });

  it('GET /organization/settings — always reports BLOCK/no-override for a WAREHOUSE_OPS org', async () => {
    const res = await request(app.getHttpServer())
      .get('/organization/settings')
      .set('x-test-user', asAdmin())
      .expect(200);
    expect(res.body.stockPolicy).toBe('BLOCK');
    expect(res.body.stockOverrideRequiresAdmin).toBe(false);
  });
});
