import { DeliveryPriority } from '@prisma/client';
import {
  RouteOptimizerService,
  STOP_DWELL_SECONDS,
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

  it('sends HIGH as VROOM priority 100 and NORMAL as 0', async () => {
    const { service, vroom } = makeService({
      solve: async () => ({ routes: [], unassignedJobIds: [1, 2] }),
    });
    await service.optimize({
      depot,
      vehicles: [{ key: 'd1', availableFrom: T0, availableUntil: null }],
      jobs: [job('a', 1, { priority: DeliveryPriority.HIGH }), job('b', 2)],
    });
    expect(vroom.solve.mock.calls[0][0].jobs.map((j) => j.priority)).toEqual([100, 0]);
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
