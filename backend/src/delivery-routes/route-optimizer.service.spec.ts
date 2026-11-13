import { DeliveryPriority } from '@prisma/client';
import {
  RouteOptimizerService,
  STOP_DWELL_SECONDS,
  addWorkingTime,
  farPins,
  type OptimizerJob,
} from './route-optimizer.service';
import { UnreachablePointsError, type LatLng } from '../routing/osrm.service';
import type { VroomService } from '../routing/vroom.service';

// OSRM and VROOM are stubbed: these tests cover what WareSys itself does
// around them — building the VROOM problem, turning its answer into ETAs,
// and explaining what didn't fit.

const T0 = new Date('2026-10-01T01:00:00.000Z'); // 08:00 in Jakarta
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

// Points are identified by their lat; travel between any two = |Δlat| × 100s.
const depot: LatLng = { lat: 0, lng: 0 };
const job = (key: string, lat: number, extra: Partial<OptimizerJob> = {}): OptimizerJob => ({
  key,
  location: { lat, lng: 0 },
  priority: DeliveryPriority.NORMAL,
  windowStart: null,
  windowEnd: null,
  ...extra,
});

function makeService(opts: {
  solve: VroomService['solve'];
  unreachableLats?: number[];
}) {
  const osrm = {
    table: jest.fn(async (points: LatLng[]) => {
      const bad = points
        .map((p, i) => (opts.unreachableLats?.includes(p.lat) ? i : -1))
        .filter((i) => i > 0);
      if (bad.length) throw new UnreachablePointsError(bad);
      const m = points.map((a) => points.map((b) => Math.abs(a.lat - b.lat) * 100));
      return { durations: m, distances: m.map((r) => r.map((v) => v * 10)) };
    }),
  };
  const vroom = { solve: jest.fn(opts.solve) };
  const service = new RouteOptimizerService({} as never, osrm as never, vroom as never);
  return { service, osrm, vroom };
}

describe('RouteOptimizerService.optimize', () => {
  it('schedules VROOM order from the earliest departure, waiting for a window to open', async () => {
    const { service, vroom } = makeService({
      // Visit the second job, then the first.
      solve: async () => ({ routes: [{ vehicleId: 1, jobIds: [2, 1] }], unassignedJobIds: [] }),
    });

    const { routes, unassigned } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: at(8 * 3600) }],
      jobs: [
        job('a', 3),
        job('b', 1, { windowStart: at(3600) }), // can't deliver before 09:00
      ],
    });

    expect(unassigned).toEqual([]);
    const stops = routes.get('d1')!;
    expect(stops.map((s) => s.key)).toEqual(['b', 'a']);
    // b: 100s away but waits for its window.
    expect(stops[0].eta).toEqual(at(3600));
    expect(stops[0].leg).toEqual({ durationSeconds: 100, distanceMeters: 1000 });
    // a: after b's dwell, 200s further.
    expect(stops[1].eta).toEqual(at(3600 + STOP_DWELL_SECONDS + 200));

    const problem = vroom.solve.mock.calls[0][0];
    expect(problem.vehicles).toEqual([{ id: 1, startIndex: 0, timeWindow: [0, 8 * 3600] }]);
    expect(problem.jobs[1].timeWindow).toEqual([3600, 7 * 24 * 3600]);
  });

  it('solves HIGH stops on their own, then normal stops from the last HIGH stop', async () => {
    const { service, vroom } = makeService({
      solve: async ({ jobs }) => ({
        routes: [{ vehicleId: 1, jobIds: jobs.map((j) => j.id) }],
        unassignedJobIds: [],
      }),
    });

    const { routes } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: null }],
      jobs: [
        job('n1', 1),
        job('h1', 5, { priority: DeliveryPriority.HIGH }),
        job('n2', 2),
        job('h2', 3, { priority: DeliveryPriority.HIGH }),
      ],
    });

    const [highCall, normalCall] = vroom.solve.mock.calls.map(([problem]) => problem);
    expect(vroom.solve).toHaveBeenCalledTimes(2);
    expect(highCall.jobs.map((j) => j.id)).toEqual([2, 4]);
    expect(highCall.vehicles[0].startIndex).toBe(0);
    expect(normalCall.jobs.map((j) => j.id)).toEqual([1, 3]);

    // h1 at 500s, h2 200s after its dwell; the driver is free after h2's dwell.
    const h2Eta = 500 + STOP_DWELL_SECONDS + 200;
    const free = h2Eta + STOP_DWELL_SECONDS;
    expect(normalCall.vehicles[0].startIndex).toBe(4);
    expect(normalCall.vehicles[0].timeWindow?.[0]).toBe(free);

    const stops = routes.get('d1')!;
    expect(stops.map((s) => s.key)).toEqual(['h1', 'h2', 'n1', 'n2']);
    expect(stops[1].eta).toEqual(at(h2Eta));
    // n1 is reached from h2 (lat 3 → 1), not from the depot.
    expect(stops[2].leg).toEqual({ durationSeconds: 200, distanceMeters: 2000 });
    expect(stops[2].eta).toEqual(at(free + 200));
  });

  it('starts normal stops from the depot for a driver who got no HIGH stops', async () => {
    const { service, vroom } = makeService({
      solve: async ({ jobs }) => ({
        routes: [{ vehicleId: 1, jobIds: jobs.map((j) => j.id) }],
        unassignedJobIds: [],
      }),
    });

    await service.optimize({
      depot,
      vehicles: [
        { key: 'd1', availableFrom: T0, availableUntil: null },
        { key: 'd2', availableFrom: T0, availableUntil: null },
      ],
      jobs: [job('h', 2, { priority: DeliveryPriority.HIGH }), job('n', 1)],
    });

    const normalCall = vroom.solve.mock.calls[1][0];
    expect(normalCall.vehicles.map((v) => v.startIndex)).toEqual([1, 0]);
    expect(normalCall.vehicles[1].timeWindow?.[0]).toBe(0);
  });

  it('asks VROOM once when every stop has the same priority', async () => {
    const { service, vroom } = makeService({
      solve: async ({ jobs }) => ({
        routes: [{ vehicleId: 1, jobIds: jobs.map((j) => j.id) }],
        unassignedJobIds: [],
      }),
    });
    await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: null }],
      jobs: [
        job('a', 1, { priority: DeliveryPriority.HIGH }),
        job('b', 2, { priority: DeliveryPriority.HIGH }),
      ],
    });
    expect(vroom.solve).toHaveBeenCalledTimes(1);
  });

  it('keepUnassigned keeps a HIGH stop that did not fit ahead of the normal stops', async () => {
    const { service } = makeService({
      solve: async ({ jobs }) =>
        jobs.some((j) => j.id === 3)
          ? { routes: [{ vehicleId: 1, jobIds: [3] }], unassignedJobIds: [1] }
          : { routes: [{ vehicleId: 1, jobIds: [2] }], unassignedJobIds: [] },
      unreachableLats: [9],
    });

    const { routes, unassigned } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: at(3600) }],
      jobs: [
        job('late', 4, { priority: DeliveryPriority.HIGH }),
        job('normal', 1),
        job('fits', 2, { priority: DeliveryPriority.HIGH }),
        job('island', 9, { priority: DeliveryPriority.HIGH }),
      ],
      keepUnassigned: true,
    });

    const stops = routes.get('d1')!;
    expect(stops.map((s) => s.key)).toEqual(['fits', 'late', 'island', 'normal']);
    expect(stops[2]).toEqual({ key: 'island', eta: null, leg: null });
    // normal continues from late (lat 4 → 1), skipping the unreachable stop.
    expect(stops[3].leg).toEqual({ durationSeconds: 300, distanceMeters: 3000 });
    expect(unassigned.map((u) => u.key).sort()).toEqual(['island', 'late']);
  });

  it('explains a normal stop missed because the HIGH stops took the time', async () => {
    const { service } = makeService({
      solve: async ({ jobs }) =>
        jobs[0].id === 1
          ? { routes: [{ vehicleId: 1, jobIds: [1] }], unassignedJobIds: [] }
          : { routes: [], unassignedJobIds: [2] },
    });
    const { unassigned } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: null }],
      jobs: [
        job('h', 5, { priority: DeliveryPriority.HIGH }),
        // Reachable from the depot in time, but not once h is done.
        job('n', 1, { windowEnd: at(400) }),
      ],
    });
    expect(unassigned).toEqual([{ key: 'n', reason: 'OUTSIDE_WINDOW' }]);
  });

  it('reports missing pins, unreachable pins and past windows without sending them to VROOM', async () => {
    const { service, vroom } = makeService({
      solve: async () => ({ routes: [{ vehicleId: 1, jobIds: [1] }], unassignedJobIds: [] }),
      unreachableLats: [9],
    });

    const { routes, unassigned } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: null }],
      jobs: [
        job('ok', 1),
        { ...job('nopin', 0), location: null },
        job('island', 9),
        job('late', 2, { windowEnd: at(-60) }),
      ],
    });

    expect(routes.get('d1')!.map((s) => s.key)).toEqual(['ok']);
    expect(unassigned).toEqual(
      expect.arrayContaining([
        { key: 'nopin', reason: 'NO_PIN' },
        { key: 'island', reason: 'UNREACHABLE' },
        { key: 'late', reason: 'OUTSIDE_WINDOW' },
      ]),
    );
    expect(vroom.solve.mock.calls[0][0].jobs).toHaveLength(1);
  });

  it('calls it the driver\'s time, not the window, when a job was reachable before the run', async () => {
    const { service } = makeService({
      solve: async () => ({ routes: [{ vehicleId: 1, jobIds: [1] }], unassignedJobIds: [2] }),
    });
    const { unassigned } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: null }],
      jobs: [
        job('far', 8),
        // Reachable straight from the depot, not once 'far' is done.
        job('near', 2, { windowEnd: at(300) }),
      ],
    });
    expect(unassigned).toEqual([{ key: 'near', reason: 'NO_TIME' }]);
  });

  it('explains VROOM-unassigned jobs: window unreachable vs. hours full', async () => {
    const { service } = makeService({
      solve: async () => ({ routes: [], unassignedJobIds: [1, 2] }),
    });
    const { unassigned } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: at(3600) }],
      jobs: [
        // 500s away but the window closes after 60s — nobody can make it.
        job('tight', 5, { windowEnd: at(60) }),
        job('plain', 1),
      ],
    });
    expect(unassigned).toEqual([
      { key: 'tight', reason: 'OUTSIDE_WINDOW' },
      { key: 'plain', reason: 'NO_TIME' },
    ]);
  });

  it('keepUnassigned appends what did not fit after the optimized stops, in original order', async () => {
    const { service } = makeService({
      solve: async () => ({ routes: [{ vehicleId: 1, jobIds: [2] }], unassignedJobIds: [1, 3] }),
      unreachableLats: [9],
    });

    const { routes, unassigned } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: at(3600) }],
      jobs: [job('x', 4), job('y', 1), job('island', 9), job('z', 2)],
      keepUnassigned: true,
    });

    const stops = routes.get('d1')!;
    expect(stops.map((s) => s.key)).toEqual(['y', 'x', 'z', 'island']);
    // x continues from y (lat 1 → 4): 300s after y's dwell.
    expect(stops[1].eta).toEqual(at(100 + STOP_DWELL_SECONDS + 300));
    expect(stops[3]).toEqual({ key: 'island', eta: null, leg: null });
    expect(unassigned.map((u) => u.key).sort()).toEqual(['island', 'x', 'z']);
  });
});

describe('RouteOptimizerService — trip timing, breaks and far pins', () => {
  const solveInOrder: VroomService['solve'] = async ({ jobs }) => ({
    routes: [{ vehicleId: 1, jobIds: jobs.map((j) => j.id) }],
    unassignedJobIds: [],
  });

  it('scales road time by the business factor and uses its stop minutes', async () => {
    const { service, vroom } = makeService({ solve: solveInOrder });
    const { routes } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: null }],
      jobs: [job('a', 1), job('b', 3)],
      timing: { travelFactor: 1.5, dwellSeconds: 120 },
    });
    const stops = routes.get('d1')!;
    expect(stops[0].eta).toEqual(at(150));
    expect(stops[0].leg).toEqual({ durationSeconds: 150, distanceMeters: 1000 });
    expect(stops[1].eta).toEqual(at(150 + 120 + 300));
    expect(vroom.solve.mock.calls[0][0].jobs.every((j) => j.serviceSeconds === 120)).toBe(true);
    expect(vroom.solve.mock.calls[0][0].matrix.durations[0][1]).toBe(150);
  });

  it('sits out a lunch break, mid-leg and while waiting, and gives VROOM the break', async () => {
    const { service, vroom } = makeService({ solve: solveInOrder });
    const lunch = { start: at(1000), end: at(1000 + 3600) };
    const { routes } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: at(8 * 3600), breaks: [lunch] }],
      // a: 900s away, then 5 min there runs into lunch at 1000s.
      jobs: [job('a', 9), job('b', 10)],
      timing: { travelFactor: 1, dwellSeconds: 300 },
    });
    const [a, b] = routes.get('d1')!;
    expect(a.eta).toEqual(at(900));
    // 100s of a's stop before lunch, 200s after it, then 100s to b.
    expect(b.eta).toEqual(at(1000 + 3600 + 200 + 100));
    expect(vroom.solve.mock.calls[0][0].vehicles[0].breaks).toEqual([{ start: 1000, end: 4600 }]);
  });

  it('leaves out a break VROOM would refuse (already over, or past the shift end)', async () => {
    const { service, vroom } = makeService({ solve: solveInOrder });
    await service.optimize({
      depot,
      vehicles: [
        {
          key: 'd1',
          availableFrom: T0,
          availableUntil: at(3600),
          breaks: [
            { start: at(-600), end: at(-60) },
            { start: at(4000), end: at(5000) },
          ],
        },
      ],
      jobs: [job('a', 1)],
    });
    expect(vroom.solve.mock.calls[0][0].vehicles[0].breaks).toBeUndefined();
  });

  it('reports a pin far out compared with the rest, still routing it', async () => {
    // distance = |Δlat| × 1000 m in the stub: 4, 5, 6 km and one at 80 km.
    const { service } = makeService({ solve: solveInOrder });
    const { routes, far } = await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: null }],
      jobs: [job('a', 4), job('b', 5), job('c', 6), job('typo', 80)],
    });
    expect(far).toEqual([{ key: 'typo', meters: 80_000 }]);
    expect(routes.get('d1')!.map((s) => s.key)).toContain('typo');
  });
});

describe('addWorkingTime', () => {
  const lunch = [{ start: 100, end: 200 }];
  it('passes straight through when no break is in the way', () => {
    expect(addWorkingTime(0, 50, lunch)).toBe(50);
    expect(addWorkingTime(300, 50, lunch)).toBe(350);
  });
  it('pauses a stretch that runs into a break', () => {
    expect(addWorkingTime(80, 50, lunch)).toBe(230);
  });
  it('waits out a break it starts in', () => {
    expect(addWorkingTime(150, 0, lunch)).toBe(200);
    expect(addWorkingTime(150, 10, lunch)).toBe(210);
  });
});

describe('farPins', () => {
  it('needs both the absolute floor and several times the median', () => {
    expect(farPins(['a', 'b', 'c'], [10_000, 12_000, 35_000])).toEqual([]);
    expect(farPins(['a', 'b', 'c'], [10_000, 12_000, 40_000])).toEqual([{ key: 'c', meters: 40_000 }]);
  });
  it('flags a lone pin only when very far', () => {
    expect(farPins(['a'], [100_000])).toEqual([]);
    expect(farPins(['a', 'b'], [5_000, 470_000])).toEqual([{ key: 'b', meters: 470_000 }]);
  });
});

describe('RouteOptimizerService.driverAvailability — split shifts', () => {
  const service = (windows: { startTime: string; endTime: string }[]) =>
    new RouteOptimizerService(
      {
        organization: { findUnique: async () => ({ timezone: 'Asia/Jakarta' }) },
        driverAccessSchedule: {
          findMany: async () => windows.map((w) => ({ userId: 'u1', dayOfWeek: 'THU', ...w })),
        },
      } as never,
      {} as never,
      {} as never,
    );
  // A Thursday well in the future, so "now" never moves the start.
  const day = '2030-10-03';
  const wib = (hhmm: string) => new Date(`${day}T${hhmm}:00+07:00`);

  it('turns the gap between windows into a break, joining overlapping ones', async () => {
    const a = (
      await service([
        { startTime: '13:00', endTime: '17:00' },
        { startTime: '08:00', endTime: '11:00' },
        { startTime: '10:30', endTime: '12:00' },
      ]).driverAvailability('org', ['u1'], day)
    ).get('u1')!;
    expect(a.availableFrom).toEqual(wib('08:00'));
    expect(a.availableUntil).toEqual(wib('17:00'));
    expect(a.breaks).toEqual([{ start: wib('12:00'), end: wib('13:00') }]);
    expect(a.hoursLabel).toBe('08:00–12:00, 13:00–17:00');
  });

  it('leaves after the break when asked to leave during it', async () => {
    const a = (
      await service([
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '13:00', endTime: '17:00' },
      ]).driverAvailability('org', ['u1'], day, wib('12:30'))
    ).get('u1')!;
    expect(a.availableFrom).toEqual(wib('13:00'));
    expect(a.breaks).toEqual([]);
  });
});
