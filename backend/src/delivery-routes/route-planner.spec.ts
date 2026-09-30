import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DeliveryOrderStatus, RouteStatus } from '@prisma/client';
import { DeliveryRoutesModule } from './delivery-routes.module';
import { RoutePlannerService } from './route-planner.service';
import { PrismaService } from '../prisma/prisma.service';
import { OsrmService, type LatLng } from '../routing/osrm.service';
import { VroomService, type VroomSolution } from '../routing/vroom.service';

// "Optimize all teams" against the real database, with OSRM and VROOM
// stubbed: the stub VROOM assigns by pin latitude, so each test decides
// exactly who gets what, and the assertions are about what WareSys does
// with that — which routes are rebuilt, shrunk, cancelled or left alone.
describe('RoutePlannerService — optimize all teams', () => {
  let prisma: PrismaService;
  let planner: RoutePlannerService;
  let orgId: string;
  let adminId: string;
  // One team = one driver; the key names the team.
  const team: Record<'d1' | 'd2' | 'd3' | 'd4', string> = { d1: '', d2: '', d3: '', d4: '' };
  let customerId: string;
  const routeDate = '2030-01-15';

  // lat → team key; anything unmapped comes back unassigned.
  let assign: Record<number, 'd1' | 'd2'> = {};
  let lastPoints: LatLng[] = [];

  const osrmStub = {
    table: async (points: LatLng[]) => {
      lastPoints = points;
      const m = points.map((a) => points.map((b) => Math.round(Math.abs(a.lat - b.lat) * 1000)));
      return { durations: m, distances: m };
    },
  };
  const vroomStub = {
    solve: async ({ vehicles, jobs }): Promise<VroomSolution> => {
      const keyOf = (vehicleId: number) => (vehicleId === 1 ? 'd1' : 'd2');
      const routes = vehicles.map((v) => ({
        vehicleId: v.id,
        jobIds: jobs
          .filter((j) => assign[lastPoints[j.locationIndex].lat] === keyOf(v.id))
          .sort((a, b) => lastPoints[a.locationIndex].lat - lastPoints[b.locationIndex].lat)
          .map((j) => j.id),
      }));
      const assigned = new Set(routes.flatMap((r) => r.jobIds));
      return { routes, unassignedJobIds: jobs.filter((j) => !assigned.has(j.id)).map((j) => j.id) };
    },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [DeliveryRoutesModule] })
      .overrideProvider(OsrmService)
      .useValue(osrmStub)
      .overrideProvider(VroomService)
      .useValue(vroomStub)
      .compile();
    prisma = module.get(PrismaService);
    planner = module.get(RoutePlannerService);

    const org = await prisma.organization.create({ data: { name: `Plan Org ${randomUUID()}` } });
    orgId = org.id;
    adminId = (
      await prisma.user.create({
        data: { email: `admin-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    for (const key of Object.keys(team) as (keyof typeof team)[]) {
      team[key] = (await prisma.team.create({ data: { organizationId: orgId, name: key } })).id;
      await prisma.user.create({
        data: {
          email: `${key}-${randomUUID()}@example.com`,
          password: 'x',
          role: 'DRIVER',
          organizationId: orgId,
          teamId: team[key],
        },
      });
    }
    customerId = (
      await prisma.customer.create({ data: { organizationId: orgId, name: 'Cust', latitude: 1.9, longitude: 104 } })
    ).id;
  });

  afterAll(async () => {
    await prisma.routeHistoryEvent.deleteMany({ where: { route: { organizationId: orgId } } });
    await prisma.routeStop.deleteMany({ where: { route: { organizationId: orgId } } });
    await prisma.route.deleteMany({ where: { organizationId: orgId } });
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.deliveryOrder.deleteMany({ where: { organizationId: orgId } });
    await prisma.customer.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.team.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  const makeDo = (name: string, lat: number | null, extra: object = {}) =>
    prisma.deliveryOrder.create({
      data: {
        organizationId: orgId,
        customerName: name,
        status: DeliveryOrderStatus.SHIPPED,
        destinationLatitude: lat,
        destinationLongitude: lat == null ? null : 104,
        ...extra,
      },
    });

  const makeRoute = async (teamId: string, stops: { id: string }[]) => {
    const route = await prisma.route.create({
      data: {
        organizationId: orgId,
        teamId,
        routeDate: new Date(`${routeDate}T00:00:00.000Z`),
      },
    });
    for (const [i, o] of stops.entries()) {
      await prisma.routeStop.create({
        data: { routeId: route.id, deliveryOrderId: o.id, activeDeliveryOrderId: o.id, sequence: i + 1 },
      });
    }
    return route;
  };

  const stopsOf = (routeId: string) =>
    prisma.routeStop.findMany({
      where: { routeId },
      orderBy: { sequence: 'asc' },
      select: { sequence: true, plannedEta: true, customerName: true, deliveryOrder: { select: { customerName: true } } },
    }).then((rows) =>
      rows.map((r) => ({ ...r, name: r.deliveryOrder?.customerName ?? r.customerName })),
    );

  it('previews, then saves exactly the preview — leaving started routes alone', async () => {
    const A = await makeDo('A', 1.1);
    const B = await makeDo('B', 1.2);
    const C = await makeDo('C', 1.3);
    const D = await makeDo('D', 1.4);
    const F = await makeDo('F', 1.5);
    const G = await makeDo('G', 1.6);
    const H = await makeDo('H', 1.7, { signedAt: new Date() }); // delivered
    const I = await makeDo('I', 1.8);
    const noPin = await makeDo('NoPin', null);

    // d1's not-started route: D gets dropped from the plan; its customer
    // stop stays, after the planned stops.
    const r1 = await makeRoute(team.d1, [D]);
    await prisma.routeStop.create({
      data: { routeId: r1.id, sequence: 2, customerId, customerName: 'Cust', destinationLatitude: 1.9, destinationLongitude: 104 },
    });
    // d3 isn't planned, but F is taken from its route; G stays.
    const r2 = await makeRoute(team.d3, [F, G]);
    // d4's route has started (H delivered) — locked.
    const r3 = await makeRoute(team.d4, [H, I]);

    assign = { 1.1: 'd1', 1.5: 'd1', 1.2: 'd2' }; // C left over
    const input = {
      routeDate,
      departureAt: '2030-01-15T01:00:00.000Z',
      depot: { latitude: 1.0, longitude: 104 },
      teamIds: [team.d1, team.d2],
      deliveryOrderIds: [A.id, B.id, C.id, F.id, noPin.id],
    };

    const preview = await planner.preview(orgId, input);
    const byTeam = Object.fromEntries(preview.routes.map((r) => [r.team.id, r]));
    expect(byTeam[team.d1].existingRouteId).toBe(r1.id);
    expect(byTeam[team.d1].stops.map((s) => s.customerName)).toEqual(['A', 'F']);
    expect(byTeam[team.d1].stops[1].movedFromRouteId).toBe(r2.id);
    expect(byTeam[team.d2].existingRouteId).toBeNull(); // no route yet
    expect(byTeam[team.d2].stops.map((s) => s.customerName)).toEqual(['B']);
    expect(preview.unassigned.map((u) => [u.label, u.reason]).sort()).toEqual([
      ['C', 'NO_TIME'],
      ['NoPin', 'NO_PIN'],
    ]);
    expect(preview.removedDeliveryOrderIds).toEqual([D.id]);
    expect(preview.cancelledRouteIds).toEqual([]);
    expect(Object.keys(preview.expectedVersions).sort()).toEqual([r1.id, r2.id].sort());

    const saved = await planner.apply(orgId, adminId, {
      ...input,
      routes: preview.routes.map((r) => ({
        teamId: r.team.id,
        deliveryOrderIds: r.stops.map((s) => s.deliveryOrderId),
      })),
      expectedVersions: preview.expectedVersions,
    });

    // d1's existing route rebuilt from the plan, with ETAs; the customer
    // stop kept at the end.
    const r1Stops = await stopsOf(r1.id);
    expect(r1Stops.map((s) => [s.sequence, s.name])).toEqual([
      [1, 'A'],
      [2, 'F'],
      [3, 'Cust'],
    ]);
    // Depot → A: 0.1° × 1000 = 100s after departure.
    expect(r1Stops[0].plannedEta).toEqual(new Date('2030-01-15T01:01:40.000Z'));

    // d2 got a new route; the started one is untouched.
    const newRoute = saved.routes.find((r) => r.teamId === team.d2)!;
    expect(newRoute.created).toBe(true);
    expect((await stopsOf(newRoute.routeId)).map((s) => s.name)).toEqual(['B']);
    expect((await stopsOf(r3.id)).map((s) => s.name)).toEqual(['H', 'I']);

    // d3's route kept G, renumbered.
    expect((await stopsOf(r2.id)).map((s) => [s.sequence, s.name])).toEqual([[1, 'G']]);

    // D (dropped) and C (didn't fit) are off every route.
    for (const o of [C, D]) {
      expect(await prisma.routeStop.findUnique({ where: { activeDeliveryOrderId: o.id } })).toBeNull();
    }

    // The same preview can't be saved twice — the routes moved on.
    await expect(
      planner.apply(orgId, adminId, {
        ...input,
        routes: [],
        expectedVersions: preview.expectedVersions,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Deliveries on a started route can't be planned.
    await expect(
      planner.preview(orgId, { ...input, deliveryOrderIds: [I.id] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A team whose route already started can't get a second one that day.
    await expect(
      planner.preview(orgId, { ...input, teamIds: [team.d4], deliveryOrderIds: [C.id] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancels a not-started route the plan empties', async () => {
    const P = await makeDo('P', 2.1);
    const Q = await makeDo('Q', 2.2);
    const r = await makeRoute(team.d3, [P, Q]);

    assign = { 2.1: 'd1', 2.2: 'd1' };
    const input = {
      routeDate: '2030-01-16',
      depot: { latitude: 2.0, longitude: 104 },
      teamIds: [team.d1],
      deliveryOrderIds: [P.id, Q.id],
    };
    // makeRoute used the first test's date — move this route to the 16th.
    await prisma.route.update({
      where: { id: r.id },
      data: { routeDate: new Date('2030-01-16T00:00:00.000Z') },
    });

    const preview = await planner.preview(orgId, input);
    expect(preview.cancelledRouteIds).toEqual([r.id]);

    await planner.apply(orgId, adminId, {
      ...input,
      routes: preview.routes.map((x) => ({
        teamId: x.team.id,
        deliveryOrderIds: x.stops.map((s) => s.deliveryOrderId),
      })),
      expectedVersions: preview.expectedVersions,
    });
    const after = await prisma.route.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe(RouteStatus.CANCELLED);
    expect(await stopsOf(r.id)).toEqual([]);
  });
});
