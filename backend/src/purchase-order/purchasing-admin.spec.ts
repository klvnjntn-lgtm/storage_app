import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrderStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseOrderModule } from './purchase-order.module';
import { PurchaseOrderService } from './purchase-order.service';
import { SupplierModule } from '../supplier/supplier.module';
import { SupplierService } from '../supplier/supplier.service';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { TeamsModule } from '../teams/teams.module';
import { TeamsService } from '../teams/teams.service';

process.env.PRINT_TOKEN_SECRET ??= 'test-print-secret';
// Puppeteer is ESM-only and never used here (no PDFs rendered).
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// The modules that had no tests of their own: purchase-order rules,
// suppliers, members and teams. Isolated test DB, one fresh org.
describe('Purchase orders, suppliers, members and teams (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let pos: PurchaseOrderService;
  let suppliers: SupplierService;
  let users: UsersService;
  let teams: TeamsService;

  let orgId: string;
  let adminId: string;
  let productId: string;
  let taxRateId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PurchaseOrderModule,
        SupplierModule,
        UsersModule,
        TeamsModule,
      ],
    }).compile();
    prisma = module.get(PrismaService);
    pos = module.get(PurchaseOrderService);
    suppliers = module.get(SupplierService);
    users = module.get(UsersService);
    teams = module.get(TeamsService);

    orgId = (
      await prisma.organization.create({
        data: { name: `Admin ${randomUUID()}`, seatLimit: 10 },
      })
    ).id;
    adminId = (
      await prisma.user.create({
        data: {
          email: `a-${randomUUID()}@example.com`,
          password: 'x',
          role: 'MASTER',
          organizationId: orgId,
        },
      })
    ).id;
    const category = await prisma.category.create({
      data: { name: 'General', organizationId: orgId },
    });
    productId = (
      await prisma.product.create({
        data: {
          name: 'Bolt',
          sku: `B-${randomUUID().slice(0, 6)}`,
          categoryId: category.id,
          organizationId: orgId,
        },
      })
    ).id;
    taxRateId = (
      await prisma.organizationTaxRate.create({
        data: { organizationId: orgId, name: 'PPN', percentage: 11 },
      })
    ).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  describe('purchase orders', () => {
    it('totals discount before tax and keeps them on edit', async () => {
      const po = await pos.create(orgId, adminId, {
        items: [{ productId, quantity: 10, unitCost: 10_000 }],
        discountAmount: 10_000,
        taxRateId,
      });
      expect(Number(po.subtotal)).toBe(100_000);
      expect(Number(po.taxAmount)).toBe(9_900);
      expect(Number(po.total)).toBe(99_900);

      const edited = await pos.update(orgId, po.id, adminId, {
        discountAmount: 0,
      });
      expect(Number(edited.total)).toBe(111_000);

      await expect(
        pos.create(orgId, adminId, {
          items: [{ productId, quantity: 1, unitCost: 100 }],
          discountAmount: 101,
        }),
      ).rejects.toThrow(/cannot exceed subtotal/);
    });

    it('numbers on send, then freezes the document', async () => {
      const po = await pos.create(orgId, adminId, {
        items: [{ productId, quantity: 1, unitCost: 500 }],
      });
      expect(po.poNumber).toBeNull();
      const sent = await pos.send(orgId, po.id, adminId, 'ADMIN');
      expect(sent.poNumber).toMatch(/^PO-\d{4}-\d{5}$/);
      await expect(pos.send(orgId, po.id, adminId, 'ADMIN')).rejects.toThrow();
      await expect(
        pos.update(orgId, po.id, adminId, { notes: 'late edit' }),
      ).rejects.toThrow();

      const history = await pos.getActivityHistory(orgId, po.id);
      expect(history.map((h: { eventType: string }) => h.eventType)).toEqual(
        expect.arrayContaining(['CREATED', 'SENT']),
      );
    });

    it('refuses an empty send and cancelling after goods arrived', async () => {
      const empty = await pos.create(orgId, adminId, { items: [] });
      await expect(pos.send(orgId, empty.id, adminId, 'ADMIN')).rejects.toThrow(
        /empty/,
      );

      const po = await pos.create(orgId, adminId, {
        items: [{ productId, quantity: 2, unitCost: 1 }],
      });
      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: { status: PurchaseOrderStatus.PARTIALLY_RECEIVED },
      });
      await expect(pos.cancel(orgId, po.id, adminId)).rejects.toThrow(
        /PARTIALLY_RECEIVED/,
      );
      expect((await pos.cancel(orgId, empty.id, adminId)).status).toBe(
        PurchaseOrderStatus.CANCELLED,
      );
    });

    it('never shows another organization’s purchase order', async () => {
      const otherOrg = await prisma.organization.create({
        data: { name: `Other ${randomUUID()}` },
      });
      const foreign = await prisma.purchaseOrder.create({
        data: { organizationId: otherOrg.id },
      });
      await expect(pos.getOne(orgId, foreign.id)).rejects.toThrow(/not found/i);
      await expect(pos.cancel(orgId, foreign.id, adminId)).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe('suppliers', () => {
    it('searches, gates (de)activation to admins, and keeps suppliers with orders', async () => {
      const s = await suppliers.create(orgId, {
        name: `Toko Sinar ${randomUUID().slice(0, 4)}`,
        phone: '0811',
      });
      const found = await suppliers.list(orgId, { search: 'sinar' });
      expect(found.data.map((r) => r.id)).toContain(s.id);

      await expect(
        suppliers.update(orgId, s.id, { isActive: false }, 'USER'),
      ).rejects.toThrow(/Only an admin/);
      expect(
        (
          await suppliers.update(
            orgId,
            s.id,
            { name: 'Renamed', isActive: true },
            'USER',
          )
        ).name,
      ).toBe('Renamed');

      await prisma.purchaseOrder.create({
        data: { organizationId: orgId, supplierId: s.id },
      });
      await expect(suppliers.delete(orgId, s.id)).rejects.toThrow(
        /deactivate instead/,
      );
      expect((await suppliers.deactivate(orgId, s.id)).isActive).toBe(false);
    });
  });

  describe('members', () => {
    const master = (sub: string) => ({ sub, role: 'MASTER' });
    it('never leaves the organization without an active master', async () => {
      const other = await prisma.user.create({
        data: {
          email: `m-${randomUUID()}@example.com`,
          password: 'x',
          role: 'USER',
          organizationId: orgId,
        },
      });
      await expect(
        users.setRole(orgId, master(adminId), adminId, 'USER'),
      ).rejects.toThrow(/own role/);
      await expect(users.removeMember(orgId, master(adminId), adminId)).rejects.toThrow(
        /yourself/,
      );

      await users.setRole(orgId, master(adminId), other.id, 'MASTER');
      // Now there's a second master, so the first can be demoted by them.
      await users.setRole(orgId, master(other.id), adminId, 'USER');
      await expect(
        users.setRole(orgId, master(adminId), other.id, 'USER'),
      ).rejects.toThrow();
      await users.setRole(orgId, master(other.id), adminId, 'MASTER');

      const removed = await users.removeMember(orgId, master(adminId), other.id);
      expect(removed.removed).toBe(true);
      const members = await users.listMembers(orgId, master(adminId));
      expect(members.members.map((m) => m.id)).not.toContain(other.id);
    });
  });

  describe('teams', () => {
    it('holds one driver per team and refuses non-drivers', async () => {
      const team = await teams.create(orgId, {
        name: `Truck ${randomUUID().slice(0, 4)}`,
      });
      await expect(teams.create(orgId, { name: team.name })).rejects.toThrow(
        /already exists/,
      );

      const d1 = await prisma.user.create({
        data: {
          email: `d1-${randomUUID()}@example.com`,
          password: 'x',
          role: 'DRIVER',
          organizationId: orgId,
        },
      });
      const d2 = await prisma.user.create({
        data: {
          email: `d2-${randomUUID()}@example.com`,
          password: 'x',
          role: 'DRIVER',
          organizationId: orgId,
        },
      });
      await expect(teams.assignDriver(orgId, team.id, adminId)).rejects.toThrow(
        /DRIVER role/,
      );
      await teams.assignDriver(orgId, team.id, d1.id);
      await expect(teams.assignDriver(orgId, team.id, d2.id)).rejects.toThrow(
        /already has a driver/,
      );

      await teams.unassignDriver(orgId, d1.id);
      await teams.assignDriver(orgId, team.id, d2.id);
      await teams.remove(orgId, team.id);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: d2.id } })).teamId,
      ).toBeNull();
    });
  });
});
