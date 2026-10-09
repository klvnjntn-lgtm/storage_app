import 'dotenv/config';
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DeliveryOrderStatus, ModuleKey, RouteStatus } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageModule } from '../storage/storage.module';
import { DeliveryRoutesModule } from './delivery-routes.module';
import { DeliveryRoutesService } from './delivery-routes.service';
import { StopProofService } from './stop-proof.service';

// Team-owned routes and customer stops (stops without a delivery order),
// against the real database and a temp uploads folder.
describe('Team routes & customer stops', () => {
  let prisma: PrismaService;
  let routes: DeliveryRoutesService;
  let proofs: StopProofService;
  let root: string;
  let orgId: string;
  let adminId: string;
  let teamId: string;
  let otherTeamId: string;
  let driverId: string;
  let otherDriverId: string;
  let photo: Express.Multer.File;
  let day = 0;

  const admin = () => ({ sub: adminId, role: 'ADMIN' });
  const driver = () => ({ sub: driverId, role: 'DRIVER' });
  const nextDate = () => `2031-03-${String(++day).padStart(2, '0')}`;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'waresys-stops-'));
    process.env.UPLOADS_DIR = root;
    process.env.FILE_URL_SECRET = 'test-file-secret';

    const module = await Test.createTestingModule({
      imports: [StorageModule, DeliveryRoutesModule],
    }).compile();
    prisma = module.get(PrismaService);
    routes = module.get(DeliveryRoutesService);
    proofs = module.get(StopProofService);

    orgId = (
      await prisma.organization.create({
        data: { name: `Stops Org ${randomUUID()}` },
      })
    ).id;
    adminId = (
      await prisma.user.create({
        data: {
          email: `a-${randomUUID()}@example.com`,
          password: 'x',
          role: 'ADMIN',
          organizationId: orgId,
        },
      })
    ).id;
    teamId = (
      await prisma.team.create({
        data: { organizationId: orgId, name: 'Team A' },
      })
    ).id;
    otherTeamId = (
      await prisma.team.create({
        data: { organizationId: orgId, name: 'Team B' },
      })
    ).id;
    const mkDriver = async (team: string) =>
      (
        await prisma.user.create({
          data: {
            email: `d-${randomUUID()}@example.com`,
            password: 'x',
            role: 'DRIVER',
            organizationId: orgId,
            teamId: team,
          },
        })
      ).id;
    driverId = await mkDriver(teamId);
    otherDriverId = await mkDriver(otherTeamId);

    const jpeg = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 10, g: 120, b: 60 },
      },
    })
      .jpeg()
      .toBuffer();
    photo = {
      buffer: jpeg,
      mimetype: 'image/jpeg',
      size: jpeg.length,
      originalname: 'p.jpg',
    } as Express.Multer.File;
  });

  afterAll(async () => {
    await prisma.routeHistoryEvent.deleteMany({
      where: { route: { organizationId: orgId } },
    });
    await prisma.routeStop.deleteMany({
      where: { route: { organizationId: orgId } },
    });
    await prisma.route.deleteMany({ where: { organizationId: orgId } });
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.deliveryOrder.deleteMany({ where: { organizationId: orgId } });
    await prisma.customer.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationModule.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.team.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    rmSync(root, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  const setInvoicePos = async (enabled: boolean) => {
    await prisma.organizationModule.upsert({
      where: {
        organizationId_module: {
          organizationId: orgId,
          module: ModuleKey.INVOICE_POS,
        },
      },
      update: { enabled },
      create: { organizationId: orgId, module: ModuleKey.INVOICE_POS, enabled },
    });
  };

  const mkCustomer = (name: string, pinned = true) =>
    prisma.customer.create({
      data: {
        organizationId: orgId,
        name,
        address: `${name} street`,
        deliveryNotes: 'Blue gate',
        ...(pinned ? { latitude: 1.1, longitude: 104.1 } : {}),
      },
    });

  const mkRoute = (team = teamId) =>
    routes.createRoute(orgId, adminId, { teamId: team, routeDate: nextDate() });

  beforeEach(() => setInvoicePos(false));

  it('allows one route per team per day', async () => {
    const date = nextDate();
    const route = await routes.createRoute(orgId, adminId, {
      teamId,
      routeDate: date,
    });
    await expect(
      routes.createRoute(orgId, adminId, { teamId, routeDate: date }),
    ).rejects.toBeInstanceOf(ConflictException);

    // A cancelled route frees the day again.
    await routes.updateRoute(orgId, route.id, {
      status: RouteStatus.CANCELLED,
    });
    await expect(
      routes.createRoute(orgId, adminId, { teamId, routeDate: date }),
    ).resolves.toBeDefined();
  });

  it('without INVOICE_POS: adds customer stops (pinned or not), and DOs still work', async () => {
    const route = await mkRoute();
    const customer = await mkCustomer('Toko Maju');
    await routes.addStop(orgId, route.id, { customerId: customer.id });

    // No pin yet is fine — the stop just starts unpinned.
    const unpinned = await routes.addStop(orgId, route.id, {
      customerId: (await mkCustomer('No Pin', false)).id,
    });
    expect(unpinned.destinationLatitude).toBeNull();
    expect(unpinned.destinationLongitude).toBeNull();
    await expect(
      routes.addStop(orgId, route.id, { customerId: customer.id }),
    ).rejects.toThrow(/already a pending stop/);

    const order = await prisma.deliveryOrder.create({
      data: {
        organizationId: orgId,
        customerName: 'Warehouse DO',
        status: DeliveryOrderStatus.SHIPPED,
      },
    });
    await routes.addStop(orgId, route.id, { deliveryOrderId: order.id });

    const view = await routes.getRoute(orgId, route.id);
    expect(view.stops.map((s) => [s.kind, s.label])).toEqual([
      ['CUSTOMER', 'Toko Maju'],
      ['DELIVERY_ORDER', 'Warehouse DO'],
    ]);
    expect(Number(view.stops[0].destinationLatitude)).toBeCloseTo(1.1);
    expect(view.stops[0].address).toBe('Toko Maju street');
    expect(view.stops[0].customerInfo?.deliveryNotes).toBe('Blue gate');
  });

  it('with INVOICE_POS: stops must be delivery orders', async () => {
    await setInvoicePos(true);
    const route = await mkRoute();
    const customer = await mkCustomer('Invoice Co');
    await expect(
      routes.addStop(orgId, route.id, { customerId: customer.id }),
    ).rejects.toThrow(/must be delivery orders/);
  });

  it("corrects a stop's pin for the route only, until the route is finished", async () => {
    const route = await mkRoute();
    const customer = await mkCustomer('Pin Co');
    const stop = await routes.addStop(orgId, route.id, {
      customerId: customer.id,
    });

    await routes.setStopDestination(orgId, route.id, stop.id, {
      latitude: 1.5,
      longitude: 104.5,
    });
    const saved = await prisma.routeStop.findUniqueOrThrow({
      where: { id: stop.id },
    });
    expect(Number(saved.destinationLatitude)).toBeCloseTo(1.5);
    const master = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(Number(master.latitude)).toBeCloseTo(1.1);

    await routes.updateRoute(orgId, route.id, {
      status: RouteStatus.COMPLETED,
    });
    await expect(
      routes.setStopDestination(orgId, route.id, stop.id, {
        latitude: 1.6,
        longitude: 104.6,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a proof photo and receiver, and only the team driver may record it', async () => {
    const route = await mkRoute();
    const stop = await routes.addStop(orgId, route.id, {
      customerId: (await mkCustomer('Proof Co')).id,
    });

    await expect(
      routes.recordCustomerStopProof(
        orgId,
        route.id,
        stop.id,
        { receivedBy: 'Ani' },
        driver(),
      ),
    ).rejects.toThrow(/proof photo/);

    const outsider = { sub: otherDriverId, role: 'DRIVER' };
    await expect(
      proofs.uploadPhoto(orgId, route.id, stop.id, photo, outsider),
    ).rejects.toBeInstanceOf(NotFoundException);

    await proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver());
    const view = await routes.recordCustomerStopProof(
      orgId,
      route.id,
      stop.id,
      { receivedBy: 'Ani', latitude: 1.1, longitude: 104.1 },
      driver(),
    );
    const done = view.stops.find((s) => s.id === stop.id)!;
    expect(done.status).toBe('DELIVERED');
    expect(done.receivedBy).toBe('Ani');
    expect(done.hasProofPhoto).toBe(true);

    // Locked once signed for.
    await expect(
      proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver()),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      routes.recordCustomerStopFailure(orgId, route.id, stop.id, {}, admin()),
    ).rejects.toThrow(/already resolved/);
  });

  it("shows a driver their team's route, and nobody else's", async () => {
    const date = nextDate();
    const mine = await routes.createRoute(orgId, adminId, {
      teamId,
      routeDate: date,
    });
    const theirs = await routes.createRoute(orgId, adminId, {
      teamId: otherTeamId,
      routeDate: date,
    });

    const list = await routes.listMyRoutes(orgId, driverId, date);
    expect(list.map((r) => r.id)).toEqual([mine.id]);
    expect(list[0].team.driver?.id).toBe(driverId);
    await expect(
      routes.getRoute(orgId, theirs.id, driver()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("edits a customer stop's priority and window while it is pending", async () => {
    const route = await mkRoute();
    const stop = await routes.addStop(orgId, route.id, {
      customerId: (await mkCustomer('Window Co')).id,
    });
    await routes.updateCustomerStopDetails(orgId, route.id, stop.id, {
      priority: 'HIGH',
      deliveryWindowStart: '2031-03-20T02:00:00.000Z',
      deliveryWindowEnd: '2031-03-20T04:00:00.000Z',
    });
    const saved = await prisma.routeStop.findUniqueOrThrow({
      where: { id: stop.id },
    });
    expect(saved.priority).toBe('HIGH');
    expect(saved.deliveryWindowEnd).toEqual(
      new Date('2031-03-20T04:00:00.000Z'),
    );

    // End before the (kept) start is refused.
    await expect(
      routes.updateCustomerStopDetails(orgId, route.id, stop.id, {
        deliveryWindowEnd: '2031-03-20T01:00:00.000Z',
      }),
    ).rejects.toThrow(/end must be after/);
  });

  it('reschedules a failed customer stop onto another route, keeping the old one as history', async () => {
    const from = await mkRoute();
    const to = await mkRoute();
    const customer = await mkCustomer('Retry Co');
    const stop = await routes.addStop(orgId, from.id, {
      customerId: customer.id,
    });
    await routes.setStopDestination(orgId, from.id, stop.id, {
      latitude: 1.7,
      longitude: 104.7,
    });

    // Only failed stops.
    await expect(
      routes.rescheduleCustomerStop(orgId, from.id, stop.id, {
        routeId: to.id,
      }),
    ).rejects.toThrow(/Only a failed stop/);

    await routes.recordCustomerStopFailure(
      orgId,
      from.id,
      stop.id,
      { reason: 'Closed' },
      admin(),
    );
    const fresh = await routes.rescheduleCustomerStop(orgId, from.id, stop.id, {
      routeId: to.id,
    });

    // The corrected pin travels with the retry.
    expect(Number(fresh.destinationLatitude)).toBeCloseTo(1.7);
    const toView = await routes.getRoute(orgId, to.id);
    expect(toView.stops.map((s) => [s.label, s.status])).toEqual([
      ['Retry Co', 'PENDING'],
    ]);
    const fromView = await routes.getRoute(orgId, from.id);
    expect(fromView.stops[0].superseded).toBe(true);
    expect(fromView.stops[0].status).toBe('FAILED');

    await expect(
      routes.rescheduleCustomerStop(orgId, from.id, stop.id, {
        routeId: to.id,
      }),
    ).rejects.toThrow(/Only a failed stop/);
  });
});
