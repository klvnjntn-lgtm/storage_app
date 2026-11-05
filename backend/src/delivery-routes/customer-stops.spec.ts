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
import { DeliveryOrderStatus, ModuleKey, Prisma, RouteStatus } from '@prisma/client';
import sharp from 'sharp';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageModule } from '../storage/storage.module';
import { DeliveryRoutesModule } from './delivery-routes.module';
import { DeliveryRoutesService, pendingStopWhere } from './delivery-routes.service';
import { STOP_DWELL_SECONDS } from './route-optimizer.service';
import type { RouteOptimizerService, UnscheduledReason } from './route-optimizer.service';
import { StopProofService } from './stop-proof.service';

// Team-owned routes and customer stops (stops without a delivery order),
// against the real database and a temp uploads folder.
describe('Team routes & customer stops', () => {
  let prisma: PrismaService;
  let routes: DeliveryRoutesService;
  let proofs: StopProofService;
  let customers: CustomersService;
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
  // A driver's photo has to come with GPS.
  const shotAt = { latitude: 1.2, longitude: 104.2, accuracy: 8 };
  const nextDate = () => new Date(Date.UTC(2031, 2, ++day)).toISOString().slice(0, 10);

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'waresys-stops-'));
    process.env.UPLOADS_DIR = root;
    process.env.FILE_URL_SECRET = 'test-file-secret';

    const module = await Test.createTestingModule({
      imports: [StorageModule, DeliveryRoutesModule, CustomersModule],
    }).compile();
    prisma = module.get(PrismaService);
    routes = module.get(DeliveryRoutesService);
    proofs = module.get(StopProofService);
    customers = module.get(CustomersService);

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
    await prisma.$disconnect();
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
  // A route that has already started, so deliveries recorded now aren't
  // before its day (driver-proof.ts refuses those as a wrong phone clock) —
  // a day or so back, still inside the driver's catch-up window.
  let pastDay = 0;
  const mkStartedRoute = async () => {
    const route = await mkRoute();
    const today = new Date();
    await prisma.route.update({
      where: { id: route.id },
      data: {
        routeDate: new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (++pastDay % 6) - 1),
        ),
      },
    });
    return route;
  };

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
      ['CUSTOMER', 'No Pin'],
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

  it("sends a customer stop to one of the customer's saved addresses", async () => {
    const route = await mkRoute();
    const customer = await mkCustomer('Multi Site');
    const branch = await prisma.customerAddress.create({
      data: {
        organizationId: orgId,
        customerId: customer.id,
        label: 'Gudang Timur',
        address: 'Jl. Timur 5',
        latitude: 1.9,
        longitude: 104.9,
      },
    });
    const unpinned = await prisma.customerAddress.create({
      data: { organizationId: orgId, customerId: customer.id, label: 'Kantor', address: 'Jl. Kantor 1' },
    });

    // Saved address: its text, name and pin.
    const atBranch = await routes.addStop(orgId, route.id, {
      customerId: customer.id,
      customerAddressId: branch.id,
    });
    expect(atBranch.address).toBe('Jl. Timur 5');
    expect(atBranch.addressLabel).toBe('Gudang Timur');
    expect(Number(atBranch.destinationLatitude)).toBeCloseTo(1.9);

    // The main address is a different site: allowed on the same route...
    const atMain = await routes.addStop(orgId, route.id, { customerId: customer.id });
    expect(atMain.address).toBe('Multi Site street');
    expect(atMain.addressLabel).toBeNull();
    // ...but the same site twice isn't.
    await expect(
      routes.addStop(orgId, route.id, { customerId: customer.id, customerAddressId: branch.id }),
    ).rejects.toThrow(/Gudang Timur\) is already a pending stop/);
    // Another customer's address is refused.
    const other = await mkCustomer('Other Co');
    await expect(
      routes.addStop(orgId, route.id, { customerId: other.id, customerAddressId: branch.id }),
    ).rejects.toThrow(/Saved address not found/);

    // Switching a pending stop moves text, name and pin together — an
    // unpinned saved address leaves the stop unpinned.
    await routes.applyStopAddress(orgId, route.id, atBranch.id, unpinned.id);
    let row = await prisma.routeStop.findUniqueOrThrow({ where: { id: atBranch.id } });
    expect(row.address).toBe('Jl. Kantor 1');
    expect(row.addressLabel).toBe('Kantor');
    expect(row.destinationLatitude).toBeNull();
    // Back to the main address clashes with the main-address stop.
    await expect(
      routes.applyStopAddress(orgId, route.id, atBranch.id, undefined),
    ).rejects.toThrow(/already a pending stop/);
    await routes.applyStopAddress(orgId, route.id, atBranch.id, branch.id);
    row = await prisma.routeStop.findUniqueOrThrow({ where: { id: atBranch.id } });
    expect(row.customerAddressId).toBe(branch.id);
    expect(Number(row.destinationLatitude)).toBeCloseTo(1.9);
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
    const route = await mkStartedRoute();
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

    await proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver(), shotAt);
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
      proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver(), shotAt),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      routes.recordCustomerStopFailure(orgId, route.id, stop.id, {}, admin()),
    ).rejects.toThrow(/already resolved/);
  });

  it("needs a driver's GPS, and dates the delivery from the photo", async () => {
    const route = await mkStartedRoute();
    const stop = await routes.addStop(orgId, route.id, {
      customerId: (await mkCustomer('Late Done Co')).id,
    });
    // Uploaded from the office, so no GPS came with it to fall back on.
    await proofs.uploadPhoto(orgId, route.id, stop.id, photo, admin());
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    const gps = { latitude: 1.1, longitude: 104.1 };

    await expect(
      routes.recordCustomerStopProof(orgId, route.id, stop.id, { receivedBy: 'Ani' }, driver()),
    ).rejects.toThrow(/GPS location is required/);
    await expect(
      routes.recordCustomerStopProof(
        orgId,
        route.id,
        stop.id,
        { receivedBy: 'Ani', ...gps, signedAt: at(-5 * 24 * 60 * 60 * 1000) },
        driver(),
      ),
    ).rejects.toThrow(/too far back/);

    // Photo taken 40 minutes before Done was tapped.
    const photoAt = at(-40 * 60 * 1000);
    await routes.recordCustomerStopProof(
      orgId,
      route.id,
      stop.id,
      { receivedBy: 'Ani', ...gps, signedAt: photoAt },
      driver(),
    );
    const saved = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } });
    expect(saved.signedAt?.toISOString()).toBe(photoAt);
  });

  it('keeps what came with the photo for the office, and Done falls back to it', async () => {
    const route = await mkStartedRoute();
    const stop = await routes.addStop(orgId, route.id, {
      customerId: (await mkCustomer('Forgot Done Co')).id,
    });

    await expect(
      proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver(), {}),
    ).rejects.toThrow(/GPS location is required/);

    const takenAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver(), {
      ...shotAt,
      takenAt,
      receivedBy: 'Budi',
    });
    await proofs.saveDraft(orgId, route.id, stop.id, 'Budi Santoso', driver());

    // Never confirmed: still pending, but the office sees the evidence.
    const view = await routes.getRoute(orgId, route.id);
    const pending = view.stops.find((s) => s.id === stop.id)!;
    expect(pending.status).toBe('PENDING');
    expect(pending.hasProofPhoto).toBe(true);
    expect(pending.photoTakenAt?.toISOString()).toBe(takenAt);
    expect(Number(pending.photoLatitude)).toBeCloseTo(1.2);
    expect(pending.pendingReceivedBy).toBe('Budi Santoso');

    // Done later, from a phone that lost the photo's reading.
    await routes.recordCustomerStopProof(
      orgId,
      route.id,
      stop.id,
      { receivedBy: 'Budi Santoso' },
      driver(),
    );
    const saved = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } });
    expect(saved.signedAt?.toISOString()).toBe(takenAt);
    expect(Number(saved.completedLatitude)).toBeCloseTo(1.2);
    expect(saved.completedAccuracy).toBe(8);
    await expect(
      proofs.saveDraft(orgId, route.id, stop.id, 'Late', driver()),
    ).rejects.toThrow(/already resolved/);
  });

  it("refuses a photo from before the route's day (phone set to the wrong date)", async () => {
    const route = await mkRoute(); // dated in the future
    const stop = await routes.addStop(orgId, route.id, {
      customerId: (await mkCustomer('Wrong Date Co')).id,
    });
    await expect(
      proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver(), {
        ...shotAt,
        takenAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/date or time looks wrong/);
  });

  it('moves the photo to a failed attempt, out of the way of a retry', async () => {
    const route = await mkStartedRoute();
    const stop = await routes.addStop(orgId, route.id, {
      customerId: (await mkCustomer('Closed Shop Co')).id,
    });
    await proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver(), shotAt);
    const view = await routes.recordCustomerStopFailure(
      orgId,
      route.id,
      stop.id,
      { reason: 'Shop closed' },
      driver(),
    );
    const failed = view.stops.find((s) => s.id === stop.id)!;
    expect(failed.hasProofPhoto).toBe(false);
    expect(failed.hasFailurePhoto).toBe(true);
    expect(Number(failed.failureLatitude)).toBeCloseTo(1.2);
    await expect(
      proofs.photoLink(orgId, route.id, stop.id, driver(), 'failure'),
    ).resolves.toMatchObject({ kind: 'signed' });
  });

  it('keeps one start point for the business, shown on every route', async () => {
    expect(await routes.getStartPoint(orgId)).toBeNull();
    await routes.setStartPoint(orgId, { latitude: 1.106452, longitude: 104.071004 });
    const view = await routes.getRoute(orgId, (await mkRoute()).id);
    expect(view.startPoint).toEqual({ latitude: 1.106452, longitude: 104.071004 });
  });

  describe('re-optimizing', () => {
    const planned = new Date('2031-03-01T01:00:00.000Z');

    // Three pending stops; the optimizer is stubbed to keep whatever it's given.
    const mkOptimizable = async () => {
      const route = await mkStartedRoute();
      const stops: { id: string }[] = [];
      for (const name of ['One', 'Two', 'Three']) {
        stops.push(await routes.addStop(orgId, route.id, { customerId: (await mkCustomer(name)).id }));
      }
      await prisma.route.update({ where: { id: route.id }, data: { plannedDepartureAt: planned } });
      return { route, stops };
    };
    const resolve = (id: string, minutesAgo: number, latitude: number) =>
      prisma.routeStop.update({
        where: { id },
        data: {
          signedAt: new Date(Date.now() - minutesAgo * 60_000),
          completedLatitude: latitude,
          completedLongitude: 104.3,
        },
      });
    const spyOptimizer = (unassigned: (keys: string[]) => { key: string; reason: UnscheduledReason }[] = () => []) => {
      const optimizer = (routes as unknown as { optimizer: RouteOptimizerService }).optimizer;
      return jest.spyOn(optimizer, 'optimize').mockImplementation(async (input) => ({
        routes: new Map(
          input.vehicles.map((v) => [
            v.key,
            input.jobs.map((j) => ({ key: j.key, eta: null, leg: null })),
          ]),
        ),
        unassigned: unassigned(input.jobs.map((j) => j.key)),
      }));
    };

    afterEach(() => jest.restoreAllMocks());

    it("starts from the driver's most recent stop and from now, not the old departure", async () => {
      const { route, stops } = await mkOptimizable();
      // Done out of order: the third stop first, then the first.
      await resolve(stops[2].id, 30, 1.5);
      await resolve(stops[0].id, 10, 1.3);
      const spy = spyOptimizer();
      const before = Date.now();

      await routes.optimize(orgId, route.id, { departureAt: planned.toISOString() });

      expect(spy).toHaveBeenCalledTimes(1); // no second solve from the depot
      const input = spy.mock.calls[0][0];
      expect(input.depot).toEqual({ lat: 1.3, lng: 104.3 });
      expect(input.jobs.map((j) => j.key)).toEqual([stops[1].id]);
      expect(input.vehicles[0].availableFrom.getTime()).toBeGreaterThanOrEqual(before);
      const saved = await prisma.route.findUniqueOrThrow({ where: { id: route.id } });
      expect(saved.plannedDepartureAt).toEqual(planned);
    });

    it('still honours a later departure on a route that is underway', async () => {
      const { route, stops } = await mkOptimizable();
      await resolve(stops[0].id, 10, 1.3);
      const spy = spyOptimizer();
      const later = new Date(Date.now() + 3600_000);

      await routes.optimize(orgId, route.id, { departureAt: later.toISOString() });

      expect(spy.mock.calls[0][0].vehicles[0].availableFrom).toEqual(later);
    });

    it('plans a route nobody has started from the depot at the asked time', async () => {
      const { route } = await mkOptimizable();
      const spy = spyOptimizer();

      await routes.optimize(orgId, route.id, { departureAt: planned.toISOString() });

      const input = spy.mock.calls[0][0];
      const depot = (await routes.getStartPoint(orgId))!;
      expect(input.depot).toEqual({ lat: depot.latitude, lng: depot.longitude });
      expect(input.vehicles[0].availableFrom).toEqual(planned);
    });

    it("falls back to the depot when no road leaves the driver's last spot", async () => {
      const { route, stops } = await mkOptimizable();
      await resolve(stops[0].id, 10, 1.3);
      const spy = spyOptimizer((keys) => keys.map((key) => ({ key, reason: 'UNREACHABLE' })));

      await routes.optimize(orgId, route.id, {});

      expect(spy).toHaveBeenCalledTimes(2);
      const depot = (await routes.getStartPoint(orgId))!;
      expect(spy.mock.calls[1][0].depot).toEqual({ lat: depot.latitude, lng: depot.longitude });
    });
  });

  describe('going back to the original order', () => {
    afterEach(() => jest.restoreAllMocks());

    const optimizer = () => (routes as unknown as { optimizer: RouteOptimizerService }).optimizer;
    // Stubbed to visit the stops it's given in reverse, with ETAs.
    const spyReversing = () =>
      jest.spyOn(optimizer(), 'optimize').mockImplementation(async (input) => ({
        routes: new Map(
          input.vehicles.map((v) => [
            v.key,
            [...input.jobs].reverse().map((j, i) => ({
              key: j.key,
              eta: new Date(Date.now() + (i + 1) * 3600_000),
              leg: { durationSeconds: 100, distanceMeters: 1000 },
            })),
          ]),
        ),
        unassigned: [],
      }));
    const mkThree = async () => {
      const route = await mkStartedRoute();
      const stops: { id: string }[] = [];
      for (const name of ['Org1', 'Org2', 'Org3']) {
        stops.push(await routes.addStop(orgId, route.id, { customerId: (await mkCustomer(name)).id }));
      }
      return { route, stops };
    };
    const order = async (routeId: string) =>
      (await prisma.routeStop.findMany({ where: { routeId }, orderBy: { sequence: 'asc' } })).map((s) => s.customerName);

    it('puts a hand-built list back as it was, ETAs and departure included', async () => {
      const { route } = await mkThree();
      const departure = new Date('2031-03-01T01:00:00.000Z');
      await prisma.route.update({ where: { id: route.id }, data: { plannedDepartureAt: departure } });
      spyReversing();

      await routes.optimize(orgId, route.id, {});
      expect(await order(route.id)).toEqual(['Org3', 'Org2', 'Org1']);

      const view = await routes.restoreOriginalOrder(orgId, route.id);

      expect(view.originalOrder).toBeNull();
      expect(await order(route.id)).toEqual(['Org1', 'Org2', 'Org3']);
      const stops = await prisma.routeStop.findMany({ where: { routeId: route.id } });
      expect(stops.map((s) => s.sequence).sort()).toEqual([1, 2, 3]);
      expect(stops.every((s) => s.plannedEta === null && s.travelSecondsFromPrevious === null)).toBe(true);
      expect((await prisma.route.findUniqueOrThrow({ where: { id: route.id } })).plannedDepartureAt).toEqual(departure);
    });

    it('goes back past a second optimize to the first list', async () => {
      const { route } = await mkThree();
      spyReversing();
      await routes.optimize(orgId, route.id, {});
      await routes.optimize(orgId, route.id, {});
      expect(await order(route.id)).toEqual(['Org1', 'Org2', 'Org3']);
      // Reversing twice lands on the same order, so prove the snapshot held too.
      await routes.reorderStops(orgId, route.id, {
        stops: (await prisma.routeStop.findMany({ where: { routeId: route.id }, orderBy: { sequence: 'desc' } })).map(
          (s, i) => ({ stopId: s.id, sequence: i + 1 }),
        ),
      });
      await routes.restoreOriginalOrder(orgId, route.id);
      expect(await order(route.id)).toEqual(['Org1', 'Org2', 'Org3']);
    });

    it('keeps a stop added since at the end and skips one removed since', async () => {
      const { route, stops } = await mkThree();
      spyReversing();
      jest.spyOn(optimizer(), 'scheduleFixedOrder').mockResolvedValue([]);
      await routes.optimize(orgId, route.id, {});
      await routes.removeStop(orgId, route.id, stops[1].id);
      await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('Org4')).id });

      await routes.restoreOriginalOrder(orgId, route.id);

      expect(await order(route.id)).toEqual(['Org1', 'Org3', 'Org4']);
    });

    it('works once a stop is done, leaving what it recorded', async () => {
      const { route, stops } = await mkThree();
      spyReversing();
      await routes.optimize(orgId, route.id, {});
      const signedAt = new Date();
      await prisma.routeStop.update({ where: { id: stops[1].id }, data: { signedAt } });

      await routes.restoreOriginalOrder(orgId, route.id);

      expect(await order(route.id)).toEqual(['Org1', 'Org2', 'Org3']);
      const done = await prisma.routeStop.findUniqueOrThrow({ where: { id: stops[1].id } });
      expect(done.signedAt).toEqual(signedAt);
      expect(done.plannedEta).not.toBeNull();
    });

    it('recomputes ETAs for a route that already had them', async () => {
      const { route, stops } = await mkThree();
      await prisma.routeStop.update({ where: { id: stops[0].id }, data: { plannedEta: new Date(Date.now() + 3600_000) } });
      spyReversing();
      const schedule = jest.spyOn(optimizer(), 'scheduleFixedOrder').mockResolvedValue([]);
      await routes.optimize(orgId, route.id, {});

      await routes.restoreOriginalOrder(orgId, route.id);

      expect(schedule.mock.calls[0][2].map((j) => j.key)).toEqual(stops.map((s) => s.id));
    });

    it('refuses when there is nothing to go back to, or the route is closed', async () => {
      const { route } = await mkThree();
      await expect(routes.restoreOriginalOrder(orgId, route.id)).rejects.toThrow(/no earlier order/);
      spyReversing();
      await routes.optimize(orgId, route.id, {});
      await prisma.route.update({ where: { id: route.id }, data: { status: RouteStatus.COMPLETED } });
      await expect(routes.restoreOriginalOrder(orgId, route.id)).rejects.toThrow(/completed or cancelled/);
    });
  });

  it('refuses to re-optimize a closed route', async () => {
    const route = await mkRoute();
    await prisma.route.update({ where: { id: route.id }, data: { status: RouteStatus.COMPLETED } });
    await expect(routes.optimize(orgId, route.id, {})).rejects.toThrow(/completed or cancelled/);
  });

  it('inserts a stop at a chosen position', async () => {
    const route = await mkRoute();
    for (const n of ['In1', 'In2', 'In3']) {
      await routes.addStop(orgId, route.id, { customerId: (await mkCustomer(n)).id });
    }
    await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('In0')).id, sequence: 2 });
    const view = await routes.getRoute(orgId, route.id);
    expect(view.stops.map((s) => s.customerName)).toEqual(['In1', 'In0', 'In2', 'In3']);
  });

  it('refuses a reorder that is on a closed route or gives two stops one position', async () => {
    const route = await mkRoute();
    const a = await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('Re1')).id });
    const b = await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('Re2')).id });
    await expect(
      routes.reorderStops(orgId, route.id, {
        stops: [
          { stopId: a.id, sequence: 1 },
          { stopId: b.id, sequence: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await prisma.route.update({ where: { id: route.id }, data: { status: RouteStatus.CANCELLED } });
    await expect(
      routes.reorderStops(orgId, route.id, {
        stops: [
          { stopId: a.id, sequence: 2 },
          { stopId: b.id, sequence: 1 },
        ],
      }),
    ).rejects.toThrow(/completed or cancelled/);
  });

  it('finds the same pending stops in SQL as stopStatus does', async () => {
    const route = await mkRoute();
    const stops: { id: string }[] = [];
    for (const n of ['Sq1', 'Sq2', 'Sq3']) {
      stops.push(await routes.addStop(orgId, route.id, { customerId: (await mkCustomer(n)).id }));
    }
    await prisma.routeStop.update({ where: { id: stops[0].id }, data: { signedAt: new Date() } });
    await prisma.routeStop.update({ where: { id: stops[1].id }, data: { failedAt: new Date() } });
    const found = await prisma.routeStop.findMany({ where: { routeId: route.id, ...pendingStopWhere } });
    expect(found.map((s) => s.id)).toEqual([stops[2].id]);
  });

  describe('HIGH priority stops come first', () => {
    const order = async (routeId: string) =>
      (await routes.getRoute(orgId, routeId)).stops.map((s) => s.id);
    const threeStops = async () => {
      const route = await mkRoute();
      const a = await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('HpA')).id });
      const b = await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('HpB')).id });
      const c = await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('HpC')).id });
      return { route, a, b, c };
    };

    it('puts an added HIGH stop above normal stops but below earlier HIGH stops', async () => {
      const { route, a, b } = await threeStops();
      const high1 = await routes.addStop(orgId, route.id, {
        customerId: (await mkCustomer('HpH1')).id,
        priority: 'HIGH',
      });
      expect(high1.sequence).toBe(1);
      const high2 = await routes.addStop(orgId, route.id, {
        customerId: (await mkCustomer('HpH2')).id,
        priority: 'HIGH',
      });
      expect((await order(route.id)).slice(0, 4)).toEqual([high1.id, high2.id, a.id, b.id]);
    });

    it('moves a stop when its priority is edited', async () => {
      const { route, a, b, c } = await threeStops();
      await routes.updateCustomerStopDetails(orgId, route.id, c.id, { priority: 'HIGH' });
      expect(await order(route.id)).toEqual([c.id, a.id, b.id]);
      await routes.updateCustomerStopDetails(orgId, route.id, c.id, { priority: 'NORMAL' });
      expect(await order(route.id)).toEqual([c.id, a.id, b.id]);
    });

    const swapFirstTwo = async (routeId: string) => {
      const [x, y, ...rest] = await prisma.routeStop.findMany({ where: { routeId }, orderBy: { sequence: 'asc' } });
      return [
        { stopId: y.id, sequence: x.sequence },
        { stopId: x.id, sequence: y.sequence },
        ...rest.map((r) => ({ stopId: r.id, sequence: r.sequence })),
      ];
    };
    const versionOf = async (routeId: string) =>
      (await prisma.route.findUniqueOrThrow({ where: { id: routeId } })).version;

    it('leaves finished stops in place when a HIGH stop is added', async () => {
      const { route, a, b, c } = await threeStops();
      await prisma.routeStop.update({ where: { id: a.id }, data: { signedAt: new Date() } });
      const high = await routes.addStop(orgId, route.id, {
        customerId: (await mkCustomer('HpFin')).id,
        priority: 'HIGH',
      });
      expect(await order(route.id)).toEqual([a.id, high.id, b.id, c.id]);
      expect(high.sequence).toBe(2);
    });

    it("doesn't touch the route when a finished stop's priority changes", async () => {
      const { route, a, b } = await threeStops();
      await prisma.routeStop.update({ where: { id: b.id }, data: { signedAt: new Date(), priority: 'HIGH' } });
      const version = await versionOf(route.id);
      const notify = jest.spyOn(
        (routes as unknown as { notifications: { create: () => Promise<unknown> } }).notifications,
        'create',
      );
      await prisma.route.update({ where: { id: route.id }, data: { status: RouteStatus.ACTIVE } });

      expect(await routes.applyPriorityOrder(orgId, route.id)).toBe(false);

      expect((await order(route.id))[0]).toBe(a.id);
      expect(await versionOf(route.id)).toBe(version);
      expect(notify).not.toHaveBeenCalled();
      notify.mockRestore();
    });

    it('refuses to move a finished stop', async () => {
      const { route, a } = await threeStops();
      await prisma.routeStop.update({ where: { id: a.id }, data: { signedAt: new Date() } });
      await expect(
        routes.reorderStops(orgId, route.id, { stops: await swapFirstTwo(route.id) }),
      ).rejects.toThrow(/keeps its place/);
    });

    it('refuses a reorder built from an older version of the route', async () => {
      const { route } = await threeStops();
      const version = await versionOf(route.id);
      await expect(
        routes.reorderStops(orgId, route.id, {
          stops: await swapFirstTwo(route.id),
          expectedVersion: version - 1,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      const view = await routes.reorderStops(orgId, route.id, {
        stops: await swapFirstTwo(route.id),
        expectedVersion: version,
      });
      expect(view.version).toBe(version + 1);
    });

    it('lets a route already out of order be reordered and tidied, not made worse', async () => {
      const { route, a, b, c } = await threeStops();
      await prisma.routeStop.update({ where: { id: c.id }, data: { priority: 'HIGH' } });
      const send = (ids: string[]) =>
        routes.reorderStops(orgId, route.id, {
          stops: ids.map((stopId, i) => ({ stopId, sequence: i + 1 })),
        });
      await send([b.id, a.id, c.id]); // same mistake, no worse
      await send([b.id, c.id, a.id]); // better
      await expect(send([a.id, b.id, c.id])).rejects.toThrow(/must stay above/); // worse
      await send([c.id, b.id, a.id]);
      expect(await order(route.id)).toEqual([c.id, b.id, a.id]);
    });

    it('sorts a route when it is reopened', async () => {
      const { route, a, b, c } = await threeStops();
      await prisma.route.update({ where: { id: route.id }, data: { status: RouteStatus.CANCELLED } });
      await prisma.routeStop.update({ where: { id: c.id }, data: { priority: 'HIGH' } });
      expect(await order(route.id)).toEqual([a.id, b.id, c.id]);

      await routes.updateRoute(orgId, route.id, { status: RouteStatus.PLANNED });

      expect(await order(route.id)).toEqual([c.id, a.id, b.id]);
    });

    it('takes reorders of one route one at a time', async () => {
      const { route, a, b, c } = await threeStops();
      const send = (ids: string[]) =>
        routes.reorderStops(orgId, route.id, {
          stops: ids.map((stopId, i) => ({ stopId, sequence: i + 1 })),
        });
      await Promise.all([send([c.id, b.id, a.id]), send([b.id, a.id, c.id]), send([a.id, c.id, b.id])]);
      const sequences = (await prisma.routeStop.findMany({ where: { routeId: route.id } })).map((s) => s.sequence);
      expect(sequences.sort()).toEqual([1, 2, 3]);
    });

    it('never fails the saved change if the re-sort does', async () => {
      const { route, a } = await threeStops();
      const tx = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('deadlock'));
      await expect(routes.applyPriorityOrder(orgId, route.id)).resolves.toBe(false);
      tx.mockRestore();
      expect((await order(route.id))[0]).toBe(a.id);
    });

    it('clears a window with null and keeps it when left out', async () => {
      const { route, a } = await threeStops();
      const end = new Date('2031-03-01T10:00:00.000Z');
      await routes.updateCustomerStopDetails(orgId, route.id, a.id, { deliveryWindowEnd: end.toISOString() });
      await routes.updateCustomerStopDetails(orgId, route.id, a.id, { priority: 'NORMAL' });
      const kept = await prisma.routeStop.findUniqueOrThrow({ where: { id: a.id } });
      expect(kept.deliveryWindowEnd).toEqual(end);
      await routes.updateCustomerStopDetails(orgId, route.id, a.id, { deliveryWindowEnd: null });
      const cleared = await prisma.routeStop.findUniqueOrThrow({ where: { id: a.id } });
      expect(cleared.deliveryWindowEnd).toBeNull();
    });

    it("follows a delivery order's details on its live stop only", async () => {
      const { route, a, b } = await threeStops();
      const mkDo = (status: DeliveryOrderStatus) =>
        prisma.deliveryOrder.create({
          data: { organizationId: orgId, customerName: 'HP DO', status, priority: 'HIGH' },
        });
      const order1 = await mkDo(DeliveryOrderStatus.SHIPPED);
      await prisma.deliveryOrder.update({ where: { id: order1.id }, data: { priority: 'NORMAL' } });
      const stop = await routes.addStop(orgId, route.id, { deliveryOrderId: order1.id });
      await prisma.routeStop.update({
        where: { id: stop.id },
        data: { atRiskNotifiedAt: new Date(), lateNotifiedAt: new Date() },
      });

      await prisma.deliveryOrder.update({ where: { id: order1.id }, data: { priority: 'HIGH' } });
      await routes.afterDeliveryOrderDetailsChanged(orgId, order1.id, { priority: true, window: false });
      expect((await order(route.id))[0]).toBe(stop.id);
      expect((await order(route.id)).slice(1, 3)).toEqual([a.id, b.id]);
      const unchanged = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } });
      expect(unchanged.atRiskNotifiedAt).not.toBeNull();

      await routes.afterDeliveryOrderDetailsChanged(orgId, order1.id, { priority: false, window: true });
      const rearmed = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } });
      expect(rearmed.atRiskNotifiedAt).toBeNull();
      expect(rearmed.lateNotifiedAt).toBeNull();
    });

    it('refuses a reorder that mixes the groups, allows one within a group', async () => {
      const { route, a, b, c } = await threeStops();
      await routes.updateCustomerStopDetails(orgId, route.id, b.id, { priority: 'HIGH' });
      await routes.updateCustomerStopDetails(orgId, route.id, c.id, { priority: 'HIGH' });
      const send = (ids: string[]) =>
        routes.reorderStops(orgId, route.id, {
          stops: ids.map((stopId, i) => ({ stopId, sequence: i + 1 })),
        });
      await expect(send([b.id, a.id, c.id])).rejects.toThrow(/must stay above/);
      await expect(send([a.id, b.id, c.id])).rejects.toThrow(/must stay above/);
      await send([c.id, b.id, a.id]);
      expect(await order(route.id)).toEqual([c.id, b.id, a.id]);
    });
  });

  it('lists finished stops in the order they were done, with their route numbers, for monitoring', async () => {
    const route = await mkRoute();
    const stops: { id: string; sequence: number }[] = [];
    for (const n of ['Tl1', 'Tl2', 'Tl3']) {
      stops.push(await routes.addStop(orgId, route.id, { customerId: (await mkCustomer(n)).id }));
    }
    const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 9, minute));
    await prisma.route.update({ where: { id: route.id }, data: { plannedDepartureAt: at(0) } });
    // Stop 3 first, stop 1 failed next, stop 2 still to do.
    await prisma.routeStop.update({ where: { id: stops[2].id }, data: { signedAt: at(20) } });
    await prisma.routeStop.update({ where: { id: stops[0].id }, data: { failedAt: at(50) } });

    const date = route.routeDate.toISOString().slice(0, 10);
    const row = (await routes.monitoringByTeam(orgId, date)).find((r) => r.routeId === route.id)!;
    expect(row.timeline.map((e) => [e.stopId, e.sequence, e.status, e.durationSeconds])).toEqual([
      [stops[2].id, stops[2].sequence, 'DELIVERED', 20 * 60],
      [stops[0].id, stops[0].sequence, 'FAILED', 30 * 60],
    ]);
  });

  it("times a rescheduled stop by its own attempt, not the delivery's later failure", async () => {
    const route = await mkRoute();
    const order = await prisma.deliveryOrder.create({
      data: {
        organizationId: orgId,
        customerName: 'Retry DO',
        status: DeliveryOrderStatus.SHIPPED,
      },
    });
    const stop = await routes.addStop(orgId, route.id, { deliveryOrderId: order.id });
    await prisma.deliveryOrder.update({
      where: { id: order.id },
      data: {
        status: DeliveryOrderStatus.FAILED,
        failedAt: new Date(Date.UTC(2026, 0, 2, 9)), // the later attempt, on another route
      },
    });
    const supersededAt = new Date(Date.UTC(2026, 0, 1, 9));
    await prisma.routeStop.update({
      where: { id: stop.id },
      data: { supersededAt, activeDeliveryOrderId: null },
    });

    const date = route.routeDate.toISOString().slice(0, 10);
    const row = (await routes.monitoringByTeam(orgId, date)).find((r) => r.routeId === route.id)!;
    expect(row.timeline[0].at).toEqual(supersededAt);
  });

  describe('resetting a stop', () => {
    const storage = () => (proofs as unknown as { storage: { exists(k: string): Promise<boolean> } }).storage;
    const savedStop = (id: string) => prisma.routeStop.findUniqueOrThrow({ where: { id } });
    const statusOf = async (routeId: string, id: string) =>
      (await routes.getRoute(orgId, routeId)).stops.find((s) => s.id === id)!.status;
    const delivered = async (routeId: string) => {
      const customer = await mkCustomer(`Reset ${randomUUID()}`);
      const stop = await routes.addStop(orgId, routeId, { customerId: customer.id });
      await proofs.uploadPhoto(orgId, routeId, stop.id, photo, admin(), {}, photo);
      await routes.recordCustomerStopProof(orgId, routeId, stop.id, { receivedBy: 'Ani' }, admin());
      return { stop, customer };
    };

    it('puts a delivered stop back to pending, removing its photo and the landmark made from it', async () => {
      const route = await mkStartedRoute();
      const { stop, customer } = await delivered(route.id);
      const { proofPhotoKey } = await savedStop(stop.id);
      const landmark = await prisma.customerLocationPhoto.findFirst({ where: { customerId: customer.id } });
      expect(landmark?.fromProofOf).toBe(stop.id);

      const view = await proofs.resetStop(orgId, route.id, stop.id, admin());

      expect(view.stops.find((s) => s.id === stop.id)!.status).toBe('PENDING');
      const after = await savedStop(stop.id);
      expect(after).toMatchObject({ signedAt: null, receivedBy: null, proofPhotoKey: null, completedLatitude: null });
      expect(await storage().exists(proofPhotoKey!)).toBe(false);
      expect(await storage().exists(landmark!.storageKey)).toBe(false);
      expect(await prisma.customerLocationPhoto.count({ where: { customerId: customer.id } })).toBe(0);
      const event = await prisma.routeHistoryEvent.findFirst({
        where: { routeId: route.id, type: 'STOP_RESET' },
      });
      expect(event?.createdByUserId).toBe(adminId);
      expect(event?.metadata).toMatchObject({ previousStatus: 'DELIVERED', receivedBy: 'Ani', photosDeleted: 1 });
    });

    it('lets the stop be delivered again afterwards', async () => {
      const route = await mkStartedRoute();
      const { stop } = await delivered(route.id);
      await proofs.resetStop(orgId, route.id, stop.id, admin());
      await proofs.uploadPhoto(orgId, route.id, stop.id, photo, admin());
      await routes.recordCustomerStopProof(orgId, route.id, stop.id, { receivedBy: 'Budi' }, admin());
      expect(await statusOf(route.id, stop.id)).toBe('DELIVERED');
    });

    it('resets a failed delivery order to shipped, on the delivery order itself', async () => {
      const route = await mkStartedRoute();
      const order = await prisma.deliveryOrder.create({
        data: { organizationId: orgId, customerName: 'Reset DO', status: DeliveryOrderStatus.SHIPPED },
      });
      const stop = await routes.addStop(orgId, route.id, { deliveryOrderId: order.id });
      await prisma.deliveryOrder.update({
        where: { id: order.id },
        data: { status: DeliveryOrderStatus.FAILED, failedAt: new Date(), failureReason: 'Closed' },
      });

      await proofs.resetStop(orgId, route.id, stop.id, admin());

      const after = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(after).toMatchObject({ status: DeliveryOrderStatus.SHIPPED, failedAt: null, failureReason: null });
      expect(await statusOf(route.id, stop.id)).toBe('PENDING');
    });

    it('refuses a returned delivery, a rescheduled stop and a stop with nothing recorded', async () => {
      const route = await mkStartedRoute();
      const order = await prisma.deliveryOrder.create({
        data: { organizationId: orgId, customerName: 'Returned DO', status: DeliveryOrderStatus.SHIPPED },
      });
      const doStop = await routes.addStop(orgId, route.id, { deliveryOrderId: order.id });
      await prisma.deliveryOrder.update({
        where: { id: order.id },
        data: { status: DeliveryOrderStatus.RETURNED, signedAt: new Date() },
      });
      await expect(proofs.resetStop(orgId, route.id, doStop.id, admin())).rejects.toThrow(/returned or closed/);

      const empty = await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('Reset empty')).id });
      await expect(proofs.resetStop(orgId, route.id, empty.id, admin())).rejects.toThrow(/nothing to reset/);

      await prisma.routeStop.update({
        where: { id: empty.id },
        data: { failedAt: new Date(), supersededAt: new Date() },
      });
      await expect(proofs.resetStop(orgId, route.id, empty.id, admin())).rejects.toThrow(/rescheduled/);
    });

    it("holds a driver to their own team's open route, and tells the office", async () => {
      const route = await mkStartedRoute();
      const { stop } = await delivered(route.id);
      await expect(
        proofs.resetStop(orgId, route.id, stop.id, { sub: otherDriverId, role: 'DRIVER' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      await prisma.route.update({ where: { id: route.id }, data: { status: RouteStatus.COMPLETED } });
      await expect(proofs.resetStop(orgId, route.id, stop.id, driver())).rejects.toThrow(/ask the office/);
      await prisma.route.update({ where: { id: route.id }, data: { status: RouteStatus.ACTIVE } });

      const notify = jest.spyOn(
        (routes as unknown as { notifications: { notifyOrgStaff: () => Promise<unknown> } }).notifications,
        'notifyOrgStaff',
      );
      await proofs.resetStop(orgId, route.id, stop.id, driver());
      expect(await statusOf(route.id, stop.id)).toBe('PENDING');
      expect(notify).toHaveBeenCalledWith(orgId, 'ROUTE_STOPS_CHANGED', expect.stringContaining('reset'), expect.anything());
      notify.mockRestore();
    });

    it('reopens a completed route for the office, and puts a HIGH stop back above normal ones', async () => {
      const route = await mkStartedRoute();
      const { stop } = await delivered(route.id);
      await prisma.routeStop.update({ where: { id: stop.id }, data: { priority: 'HIGH' } });
      const before = await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('Reset N1')).id });
      await prisma.routeStop.update({ where: { id: before.id }, data: { sequence: 0 } });
      await prisma.route.update({ where: { id: route.id }, data: { status: RouteStatus.COMPLETED } });

      const view = await proofs.resetStop(orgId, route.id, stop.id, admin());

      expect(view.status).toBe(RouteStatus.ACTIVE);
      expect(view.stops[0].id).toBe(stop.id);
    });
  });

  describe('keeping ETAs up to date', () => {
    const MIN = 60_000;
    const dwell = STOP_DWELL_SECONDS * 1000;
    const leg = 600;

    // A planned route: every stop 10 minutes from the one before.
    const mkPlanned = async (names: string[]) => {
      const route = await mkStartedRoute();
      const stops: { id: string }[] = [];
      for (const name of names) {
        stops.push(await routes.addStop(orgId, route.id, { customerId: (await mkCustomer(name)).id }));
      }
      // Only once they're all on, or adding the next would refresh these.
      for (const [i, stop] of stops.entries()) {
        await prisma.routeStop.update({
          where: { id: stop.id },
          data: {
            plannedEta: new Date(Date.now() + (i + 1) * 3600_000),
            travelSecondsFromPrevious: leg,
            travelMetersFromPrevious: 5000,
          },
        });
      }
      return { route, stops };
    };
    const saved = (id: string) => prisma.routeStop.findUniqueOrThrow({ where: { id } });
    const fail = (routeId: string, stopId: string) =>
      routes.recordCustomerStopFailure(orgId, routeId, stopId, { reason: 'Closed', latitude: 1.3, longitude: 104.3 }, admin());
    const optimizer = () => (routes as unknown as { optimizer: RouteOptimizerService }).optimizer;
    // OSRM stubbed: 100s to every stop, in the order given, from the time given.
    const spySchedule = () =>
      jest.spyOn(optimizer(), 'scheduleFixedOrder').mockImplementation(async (_from, departAt, jobs) =>
        jobs.map((j, i) => ({
          key: j.key,
          eta: new Date(departAt.getTime() + (i + 1) * 100_000),
          leg: { durationSeconds: 100, distanceMeters: 1000 },
        })),
      );

    afterEach(() => jest.restoreAllMocks());

    it('keeps the solved ETAs and a finished stop in place when optimizing HIGH stops', async () => {
      const { route, stops } = await mkPlanned(['HpEta1', 'HpEta2', 'HpEta3']);
      await fail(route.id, stops[0].id);
      await prisma.routeStop.update({ where: { id: stops[2].id }, data: { priority: 'HIGH' } });
      const later = new Date(Date.now() + 2 * 3600_000);
      // HIGH first, as the real optimizer returns them.
      jest.spyOn(optimizer(), 'optimize').mockImplementation(async (input) => ({
        routes: new Map([
          [
            input.vehicles[0].key,
            [...input.jobs]
              .sort((x, y) => (x.priority === 'HIGH' ? 0 : 1) - (y.priority === 'HIGH' ? 0 : 1))
              .map((j, i) => ({
                key: j.key,
                eta: new Date(input.vehicles[0].availableFrom.getTime() + (i + 1) * MIN),
                leg: { durationSeconds: 60, distanceMeters: 500 },
              })),
          ],
        ]),
        unassigned: [],
      }));
      const schedule = spySchedule();
      schedule.mockClear();

      await routes.optimize(orgId, route.id, { departureAt: later.toISOString() });

      expect(schedule).not.toHaveBeenCalled();
      expect((await saved(stops[0].id)).sequence).toBe(1);
      const high = await saved(stops[2].id);
      expect(high.sequence).toBe(2);
      expect(high.plannedEta!.getTime()).toBeGreaterThan(later.getTime());
    });

    it('walks the cached legs without OSRM when stops are done in order', async () => {
      const { route, stops } = await mkPlanned(['Ord1', 'Ord2', 'Ord3']);
      const spy = spySchedule();

      await fail(route.id, stops[0].id);

      expect(spy).not.toHaveBeenCalled();
      const failedAt = (await saved(stops[0].id)).failedAt!.getTime();
      expect((await saved(stops[1].id)).plannedEta!.getTime()).toBe(failedAt + leg * 1000);
      expect((await saved(stops[2].id)).plannedEta!.getTime()).toBe(failedAt + 2 * leg * 1000 + dwell);
    });

    it('gets new legs for the skipped stops when the driver jumps ahead, from where they are', async () => {
      const { route, stops } = await mkPlanned(['Jmp1', 'Jmp2', 'Jmp3', 'Jmp4']);
      const spy = spySchedule();

      await fail(route.id, stops[2].id);

      const [from, departAt, jobs] = spy.mock.calls[0];
      expect(from).toEqual({ lat: 1.3, lng: 104.3 });
      expect(jobs.map((j) => j.key)).toEqual([stops[0].id, stops[1].id, stops[3].id]);
      const skipped = await saved(stops[0].id);
      expect(skipped.plannedEta).toEqual(new Date(departAt.getTime() + 100_000));
      expect(skipped.travelSecondsFromPrevious).toBe(100);
      // The driver's order stays what the office set.
      expect(skipped.sequence).toBeLessThan((await saved(stops[2].id)).sequence);
    });

    it('still updates skipped stops from the cached legs when OSRM is down', async () => {
      const { route, stops } = await mkPlanned(['Dwn1', 'Dwn2', 'Dwn3']);
      jest.spyOn(optimizer(), 'scheduleFixedOrder').mockRejectedValue(new Error('down'));

      await fail(route.id, stops[1].id);

      const failedAt = (await saved(stops[1].id)).failedAt!.getTime();
      expect((await saved(stops[0].id)).plannedEta!.getTime()).toBe(failedAt + leg * 1000);
      expect((await saved(stops[2].id)).plannedEta!.getTime()).toBe(failedAt + 2 * leg * 1000 + dwell);
    });

    it('waits for a delivery window to open', async () => {
      const { route, stops } = await mkPlanned(['Win1', 'Win2', 'Win3']);
      const opens = new Date(Date.now() + 120 * MIN);
      await prisma.routeStop.update({ where: { id: stops[1].id }, data: { deliveryWindowStart: opens } });

      await fail(route.id, stops[0].id);

      expect((await saved(stops[1].id)).plannedEta).toEqual(opens);
      expect((await saved(stops[2].id)).plannedEta!.getTime()).toBe(opens.getTime() + dwell + leg * 1000);
    });

    it('does not re-send an alert that is still true, and re-arms one that no longer is', async () => {
      const { route, stops } = await mkPlanned(['Alr1', 'Alr2', 'Alr3']);
      const notifiedAt = new Date(Date.now() - 30 * MIN);
      await prisma.routeStop.update({
        where: { id: stops[1].id },
        data: { deliveryWindowEnd: new Date(Date.now() - 60 * MIN), lateNotifiedAt: notifiedAt, atRiskNotifiedAt: notifiedAt },
      });
      await prisma.routeStop.update({
        where: { id: stops[2].id },
        data: { plannedEta: new Date(Date.now() - 300 * MIN), lateNotifiedAt: notifiedAt, atRiskNotifiedAt: notifiedAt },
      });

      await fail(route.id, stops[0].id);

      // Its window closed: still late whatever the ETA says.
      expect((await saved(stops[1].id)).lateNotifiedAt).toEqual(notifiedAt);
      // Late only by its old ETA, which has moved on.
      expect((await saved(stops[2].id)).lateNotifiedAt).toBeNull();
    });

    it('refreshes after the office changes the route', async () => {
      const { route, stops } = await mkPlanned(['Edt1', 'Edt2', 'Edt3']);
      const spy = spySchedule();

      await routes.reorderStops(orgId, route.id, {
        stops: [
          { stopId: stops[2].id, sequence: 1 },
          { stopId: stops[0].id, sequence: 2 },
          { stopId: stops[1].id, sequence: 3 },
        ],
      });
      expect(spy.mock.calls.at(-1)![2].map((j) => j.key)).toEqual([stops[2].id, stops[0].id, stops[1].id]);
      expect((await saved(stops[2].id)).travelSecondsFromPrevious).toBe(100);

      await routes.removeStop(orgId, route.id, stops[0].id);
      expect(spy.mock.calls.at(-1)![2].map((j) => j.key)).toEqual([stops[2].id, stops[1].id]);

      const added = await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('Edt4')).id });
      expect((await saved(added.id)).plannedEta).not.toBeNull();

      await routes.setStopDestination(orgId, route.id, stops[1].id, { latitude: 1.4, longitude: 104.4 });
      expect(spy.mock.calls.at(-1)![2].find((j) => j.key === stops[1].id)!.location).toEqual({ lat: 1.4, lng: 104.4 });
    });

    it('leaves a route built by hand without ETAs', async () => {
      const route = await mkRoute();
      const a = await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('Hnd1')).id });
      const b = await routes.addStop(orgId, route.id, { customerId: (await mkCustomer('Hnd2')).id });
      const spy = spySchedule();

      await routes.reorderStops(orgId, route.id, {
        stops: [
          { stopId: b.id, sequence: 1 },
          { stopId: a.id, sequence: 2 },
        ],
      });

      expect(spy).not.toHaveBeenCalled();
      expect((await saved(a.id)).plannedEta).toBeNull();
    });
  });

  it('needs a reason for a failed visit from a driver, not from the office', async () => {
    const route = await mkStartedRoute();
    const mk = async (name: string) =>
      routes.addStop(orgId, route.id, { customerId: (await mkCustomer(name)).id });
    const byDriver = await mk('No Reason Co');
    await expect(
      routes.recordCustomerStopFailure(orgId, route.id, byDriver.id, { reason: '  ' }, driver()),
    ).rejects.toThrow(/reason/);

    const byOffice = await mk('Office Fail Co');
    const view = await routes.recordCustomerStopFailure(orgId, route.id, byOffice.id, {}, admin());
    expect(view.stops.find((s) => s.id === byOffice.id)!.status).toBe('FAILED');
  });

  it("gives a location set in the office to the customer's stops still to be driven", async () => {
    const customer = await mkCustomer('Pinned Later', false);
    const route = await mkRoute();
    const plain = await routes.addStop(orgId, route.id, { customerId: customer.id });
    const own = await routes.addStop(orgId, (await mkRoute()).id, { customerId: customer.id });
    await prisma.routeStop.update({
      where: { id: own.id },
      data: { destinationLatitude: 1.9, destinationLongitude: 104.9 },
    });
    const pinOf = async (id: string) =>
      Number((await prisma.routeStop.findUniqueOrThrow({ where: { id } })).destinationLatitude);

    await customers.update(orgId, customer.id, { latitude: 1.3, longitude: 104.3 });
    expect(await pinOf(plain.id)).toBeCloseTo(1.3);
    await customers.update(orgId, customer.id, { latitude: 1.4, longitude: 104.4 });
    expect(await pinOf(plain.id)).toBeCloseTo(1.4);
    // Saving the customer without moving them keeps a pin corrected on the route...
    await prisma.routeStop.update({
      where: { id: own.id },
      data: { destinationLatitude: 1.9, destinationLongitude: 104.9 },
    });
    await customers.update(orgId, customer.id, { latitude: 1.4, longitude: 104.4, phone: '0812' });
    expect(await pinOf(own.id)).toBeCloseTo(1.9);
    // ...until the customer's own location actually changes.
    await customers.update(orgId, customer.id, { latitude: 1.45, longitude: 104.45 });
    expect(await pinOf(own.id)).toBeCloseTo(1.45);
  });

  describe('following customer edits', () => {
    const optimizer = () => (routes as unknown as { optimizer: RouteOptimizerService }).optimizer;
    afterEach(() => jest.restoreAllMocks());

    const mkOrder = (customerId: string, data: Record<string, unknown> = {}) =>
      prisma.deliveryOrder.create({
        data: {
          organizationId: orgId,
          doNumber: `DO-${randomUUID()}`,
          status: DeliveryOrderStatus.SHIPPED,
          customerId,
          customerName: 'Old Name',
          deliveryAddress: 'Old Name street',
          destinationLatitude: 1.1,
          destinationLongitude: 104.1,
          ...data,
        } as Prisma.DeliveryOrderUncheckedCreateInput,
      });

    it('carries name and address onto open customer stops added before the edit', async () => {
      const customer = await mkCustomer('Old Name');
      const stop = await routes.addStop(orgId, (await mkRoute()).id, { customerId: customer.id });
      const done = await routes.addStop(orgId, (await mkRoute()).id, { customerId: customer.id });
      await prisma.routeStop.update({ where: { id: done.id }, data: { signedAt: new Date() } });

      await customers.update(orgId, customer.id, { name: 'New Name', address: 'Jl. Baru 1' });

      const after = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } });
      expect(after.customerName).toBe('New Name');
      expect(after.address).toBe('Jl. Baru 1');
      // A finished stop is a record of what happened.
      const record = await prisma.routeStop.findUniqueOrThrow({ where: { id: done.id } });
      expect(record.customerName).toBe('Old Name');
      expect(record.address).toBe('Old Name street');
    });

    it('moves a stop off a pin the customer no longer has when the location is cleared', async () => {
      const customer = await mkCustomer('Cleared');
      const stop = await routes.addStop(orgId, (await mkRoute()).id, { customerId: customer.id });
      await customers.update(orgId, customer.id, { latitude: null, longitude: null } as never);
      expect((await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } })).destinationLatitude).toBeNull();
    });

    it('carries a saved address edit onto its stops, and leaves other sites alone', async () => {
      const customer = await mkCustomer('Two Sites');
      const site = await customers.createAddress(orgId, customer.id, { label: 'Gudang', address: 'Jl. Gudang 1' });
      const atSite = await routes.addStop(orgId, (await mkRoute()).id, {
        customerId: customer.id,
        customerAddressId: site.id,
      });
      const atMain = await routes.addStop(orgId, (await mkRoute()).id, { customerId: customer.id });

      await customers.updateAddress(orgId, customer.id, site.id, {
        label: 'Gudang Timur',
        address: 'Jl. Gudang 2',
        latitude: 1.7,
        longitude: 104.7,
      });

      const after = await prisma.routeStop.findUniqueOrThrow({ where: { id: atSite.id } });
      expect(after.addressLabel).toBe('Gudang Timur');
      expect(after.address).toBe('Jl. Gudang 2');
      expect(Number(after.destinationLatitude)).toBeCloseTo(1.7);
      const main = await prisma.routeStop.findUniqueOrThrow({ where: { id: atMain.id } });
      expect(main.address).toBe('Two Sites street');
      expect(Number(main.destinationLatitude)).toBeCloseTo(1.1);
    });

    it('keeps a stop at a deleted saved address where it was going', async () => {
      const customer = await mkCustomer('Closed Site');
      const site = await customers.createAddress(orgId, customer.id, { label: 'Lama', address: 'Jl. Lama' });
      const stop = await routes.addStop(orgId, (await mkRoute()).id, {
        customerId: customer.id,
        customerAddressId: site.id,
      });
      await customers.removeAddress(orgId, customer.id, site.id);

      await customers.update(orgId, customer.id, { address: 'Jl. Pusat', latitude: 1.2, longitude: 104.2 });

      const after = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } });
      expect(after.address).toBe('Jl. Lama');
    });

    it('updates delivery orders still to be delivered, not signed or one-off ones', async () => {
      const customer = await mkCustomer('Old Name');
      const open = await mkOrder(customer.id);
      const signed = await mkOrder(customer.id, { signedAt: new Date() });
      const jobSite = await mkOrder(customer.id, { deliveryAddress: 'Proyek Lain', destinationLatitude: 1.9 });

      await customers.update(orgId, customer.id, {
        name: 'New Name',
        address: 'Jl. Baru 2',
        latitude: 1.6,
        longitude: 104.6,
      });

      const a = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: open.id } });
      expect(a.customerName).toBe('New Name');
      expect(a.deliveryAddress).toBe('Jl. Baru 2');
      expect(Number(a.destinationLatitude)).toBeCloseTo(1.6);

      const b = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: signed.id } });
      expect(b.customerName).toBe('Old Name');
      expect(b.deliveryAddress).toBe('Old Name street');

      const c = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: jobSite.id } });
      expect(c.customerName).toBe('New Name'); // who they are follows; where this one goes doesn't
      expect(c.deliveryAddress).toBe('Proyek Lain');
      expect(Number(c.destinationLatitude)).toBeCloseTo(1.9);
    });

    it('refreshes ETAs and tells the driver on an active route when a destination moves', async () => {
      const customer = await mkCustomer('Moved');
      const route = await mkRoute();
      const stop = await routes.addStop(orgId, route.id, { customerId: customer.id });
      await prisma.route.update({ where: { id: route.id }, data: { status: RouteStatus.ACTIVE } });
      await prisma.routeStop.update({ where: { id: stop.id }, data: { plannedEta: new Date(Date.now() + 3600_000) } });
      const schedule = jest.spyOn(optimizer(), 'scheduleFixedOrder').mockResolvedValue([]);
      const before = await prisma.notification.count({ where: { userId: driverId, type: 'ROUTE_STOPS_CHANGED' } });

      await customers.update(orgId, customer.id, { latitude: 1.8, longitude: 104.8 });

      expect(schedule.mock.calls[0][2][0].location).toEqual({ lat: 1.8, lng: 104.8 });
      expect(await prisma.notification.count({ where: { userId: driverId, type: 'ROUTE_STOPS_CHANGED' } })).toBe(before + 1);
    });

    it('does not touch routes or drivers when nothing about the destination changed', async () => {
      const customer = await mkCustomer('Same Place');
      const route = await mkRoute();
      const stop = await routes.addStop(orgId, route.id, { customerId: customer.id });
      await prisma.route.update({ where: { id: route.id }, data: { status: RouteStatus.ACTIVE } });
      await prisma.routeStop.update({ where: { id: stop.id }, data: { plannedEta: new Date(Date.now() + 3600_000) } });
      const schedule = jest.spyOn(optimizer(), 'scheduleFixedOrder').mockResolvedValue([]);
      const versionBefore = (await prisma.route.findUniqueOrThrow({ where: { id: route.id } })).version;

      // The form resends everything, including the same location.
      await customers.update(orgId, customer.id, { phone: '0813', address: 'Same Place street', latitude: 1.1, longitude: 104.1 });

      expect(schedule).not.toHaveBeenCalled();
      expect((await prisma.route.findUniqueOrThrow({ where: { id: route.id } })).version).toBe(versionBefore);
    });
  });

  it('still finds the stops when the office changes the address and location together', async () => {
    const customer = await mkCustomer('Moved Shop', false);
    const stop = await routes.addStop(orgId, (await mkRoute()).id, { customerId: customer.id });
    await customers.update(orgId, customer.id, {
      address: 'Jl. Baru 9',
      latitude: 1.35,
      longitude: 104.35,
    });
    const after = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } });
    expect(Number(after.destinationLatitude)).toBeCloseTo(1.35);
  });

  it('fills in a landmark photo from the proof photo, only for a customer without one', async () => {
    const route = await mkStartedRoute();
    const customer = await mkCustomer('No Landmark Co');
    const stop = await routes.addStop(orgId, route.id, { customerId: customer.id });
    const landmarks = () =>
      prisma.customerLocationPhoto.findMany({ where: { customerId: customer.id } });

    await proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver(), shotAt, photo);
    const first = await landmarks();
    expect(first).toHaveLength(1);
    expect(first[0].fromProofOf).toBe(stop.id);
    expect(Number(first[0].latitude)).toBeCloseTo(1.2);

    // A retake replaces the one it filled in.
    await proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver(), shotAt, photo);
    const retaken = await landmarks();
    expect(retaken).toHaveLength(1);
    expect(retaken[0].id).not.toBe(first[0].id);

    // A customer whose landmark came from the office keeps it as it is.
    const other = await mkCustomer('Has Landmark Co');
    await prisma.customerLocationPhoto.create({
      data: { organizationId: orgId, customerId: other.id, storageKey: 'customer-locations/x/office.webp' },
    });
    const stop2 = await routes.addStop(orgId, route.id, { customerId: other.id });
    await proofs.uploadPhoto(orgId, route.id, stop2.id, photo, driver(), shotAt, photo);
    const kept = await prisma.customerLocationPhoto.findMany({ where: { customerId: other.id } });
    expect(kept).toHaveLength(1);
    expect(kept[0].fromProofOf).toBeNull();
  });

  it('pulls a phone clock running ahead back to now', async () => {
    const route = await mkStartedRoute();
    const stop = await routes.addStop(orgId, route.id, {
      customerId: (await mkCustomer('Fast Clock Co')).id,
    });
    await proofs.uploadPhoto(orgId, route.id, stop.id, photo, driver(), shotAt);
    const before = Date.now();
    await routes.recordCustomerStopProof(
      orgId,
      route.id,
      stop.id,
      {
        receivedBy: 'Ani',
        latitude: 1.1,
        longitude: 104.1,
        signedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      driver(),
    );
    const saved = await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } });
    expect(saved.signedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(saved.signedAt!.getTime()).toBeLessThanOrEqual(Date.now());
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

  it("gives a driver today's route in the org's timezone, before UTC's day turns", async () => {
    const date = nextDate();
    const mine = await routes.createRoute(orgId, adminId, { teamId, routeDate: date });
    // 23:30 UTC the day before = 06:30 the same day in Jakarta (the default).
    const dayBefore = new Date(`${date}T00:00:00.000Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    jest.useFakeTimers({
      now: new Date(`${dayBefore.toISOString().slice(0, 10)}T23:30:00.000Z`),
      // Only Date is faked; Prisma needs real timers.
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
    });
    try {
      const list = await routes.listMyRoutes(orgId, driverId);
      expect(list.map((r) => r.id)).toEqual([mine.id]);
    } finally {
      jest.useRealTimers();
    }
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
