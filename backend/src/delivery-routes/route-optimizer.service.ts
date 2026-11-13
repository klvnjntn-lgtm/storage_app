// src/delivery-routes/route-optimizer.service.ts
import { Injectable } from '@nestjs/common';
import { DayOfWeek, DeliveryPriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  OsrmService,
  UnreachablePointsError,
  type LatLng,
  type TravelMatrix,
  type TripLeg,
} from '../routing/osrm.service';
import { VroomService, type VroomJob } from '../routing/vroom.service';
import {
  resolveTimezone,
  wallTimeOnBusinessDay,
} from '../accounting/business-date';

// A fixed dwell time added per stop when computing ETAs — how long the
// driver is assumed to spend at each stop before departing for the next.
// Not configurable in this pass; a flat estimate, not a promise.
export const STOP_DWELL_SECONDS = 5 * 60;

// Default departure when neither the request nor the driver's working
// hours say when the day starts.
const DEFAULT_DAY_START = '08:00';

// Upper bound for "no end" time windows — VROOM needs a finite number.
const OPEN_ENDED_SECONDS = 7 * 24 * 60 * 60;

export type UnscheduledReason =
  // No destination pin — nothing to route to.
  | 'NO_PIN'
  // OSRM has no road to/from the pin (wrong island, pin in the sea, ...).
  | 'UNREACHABLE'
  // The customer's delivery window can't be met by any driver.
  | 'OUTSIDE_WINDOW'
  // Feasible on its own, but the drivers' working hours are full.
  | 'NO_TIME';

export type OptimizerJob = {
  key: string;
  location: LatLng | null;
  priority: DeliveryPriority;
  windowStart: Date | null;
  windowEnd: Date | null;
};

export type OptimizerVehicle = {
  key: string;
  availableFrom: Date;
  availableUntil: Date | null;
};

export type ScheduledStop = {
  key: string;
  // Null only for a stop appended despite being unreachable (keepUnassigned).
  eta: Date | null;
  leg: TripLeg | null;
};

export type OptimizeResult = {
  routes: Map<string, ScheduledStop[]>;
  unassigned: { key: string; reason: UnscheduledReason }[];
};

export type DriverAvailability = {
  availableFrom: Date;
  availableUntil: Date | null;
  // Driver has access hours configured at all.
  restricted: boolean;
  // Has access hours, but none on this day.
  offDuty: boolean;
  // "08:00–17:00" on this day, for display; null when unrestricted/off.
  hoursLabel: string | null;
};

type DriverCursor = {
  vehicle: OptimizerVehicle;
  at: Date;
  matrixIndex: number;
};

const DAY_OF_WEEK_BY_UTC_DAY: DayOfWeek[] = [
  DayOfWeek.SUN,
  DayOfWeek.MON,
  DayOfWeek.TUE,
  DayOfWeek.WED,
  DayOfWeek.THU,
  DayOfWeek.FRI,
  DayOfWeek.SAT,
];

// VROOM decides who goes where and in what order, solving HIGH stops and
// normal stops separately; OSRM supplies the
// travel matrix it decides over. ETAs are then computed here from that
// same matrix — earliest departure, waiting at a stop whose delivery
// window hasn't opened yet — rather than taken from VROOM, which may
// shift a driver's departure later to avoid waiting. Same honest framing
// as before: travel time from road data, not live traffic.
@Injectable()
export class RouteOptimizerService {
  constructor(
    private prisma: PrismaService,
    private osrm: OsrmService,
    private vroom: VroomService,
  ) {}

  // Working hours from DriverAccessSchedule for `routeDate` (YYYY-MM-DD,
  // the business-calendar date), intersected with the requested
  // departure. Several windows on one day are merged into first-start →
  // last-end (VROOM gets one window per driver).
  async driverAvailability(
    organizationId: string,
    driverIds: string[],
    routeDate: string,
    departureAt?: Date,
  ): Promise<Map<string, DriverAvailability>> {
    const [org, schedules] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { timezone: true },
      }),
      this.prisma.driverAccessSchedule.findMany({
        where: { userId: { in: driverIds } },
        select: { userId: true, dayOfWeek: true, startTime: true, endTime: true },
      }),
    ]);
    const tz = resolveTimezone(org);
    const dateOnly = new Date(`${routeDate}T00:00:00.000Z`);
    const day = DAY_OF_WEEK_BY_UTC_DAY[dateOnly.getUTCDay()];

    const now = new Date();
    // A departure already gone (the route page re-sends the old plan's time,
    // or a preview saved later) would give ETAs in the past, and every stop
    // would look late at once and set off the late alerts.
    if (departureAt && departureAt < now) departureAt = now;
    const defaultStart = wallTimeOnBusinessDay(dateOnly, DEFAULT_DAY_START, tz);
    const fallbackDeparture =
      departureAt ?? new Date(Math.max(now.getTime(), defaultStart.getTime()));

    const result = new Map<string, DriverAvailability>();
    for (const driverId of driverIds) {
      const mine = schedules.filter((s) => s.userId === driverId);
      const today = mine.filter((s) => s.dayOfWeek === day);
      if (today.length === 0) {
        result.set(driverId, {
          availableFrom: fallbackDeparture,
          availableUntil: null,
          restricted: mine.length > 0,
          offDuty: mine.length > 0,
          hoursLabel: null,
        });
        continue;
      }
      const startHHmm = today.map((s) => s.startTime).sort()[0];
      const endHHmm = today.map((s) => s.endTime).sort().reverse()[0];
      const shiftStart = wallTimeOnBusinessDay(dateOnly, startHHmm, tz);
      const shiftEnd = wallTimeOnBusinessDay(dateOnly, endHHmm, tz);
      const departure =
        departureAt ?? new Date(Math.max(now.getTime(), shiftStart.getTime()));
      result.set(driverId, {
        availableFrom: new Date(Math.max(departure.getTime(), shiftStart.getTime())),
        availableUntil: shiftEnd,
        restricted: true,
        offDuty: false,
        hoursLabel: `${startHHmm}–${endHHmm}`,
      });
    }
    return result;
  }

  // Assigns and sequences `jobs` across `vehicles`, all starting at
  // `depot`, with every HIGH stop ahead of every normal one. With
  // `keepUnassigned` (single-vehicle re-optimize of an existing route), jobs
  // VROOM couldn't fit are still appended to the end of their priority group
  // on the one vehicle's route — they're already on it — and still reported
  // in `unassigned` so the caller can warn about them.
  async optimize(input: {
    depot: LatLng;
    vehicles: OptimizerVehicle[];
    jobs: OptimizerJob[];
    keepUnassigned?: boolean;
  }): Promise<OptimizeResult> {
    const unassigned: OptimizeResult['unassigned'] = [];
    const routes = new Map<string, ScheduledStop[]>();
    for (const v of input.vehicles) routes.set(v.key, []);

    let routable = input.jobs.filter((j) => {
      if (j.location) return true;
      unassigned.push({ key: j.key, reason: 'NO_PIN' });
      return false;
    });

    // Unreachable pins are dropped and the matrix re-fetched without them,
    // so one bad pin doesn't block planning everything else.
    // Nothing to route (every stop without a pin): no need to ask OSRM.
    let matrix: TravelMatrix = { durations: [[0]], distances: [[0]] };
    const unreachable: OptimizerJob[] = [];
    while (routable.length > 0) {
      try {
        matrix = await this.osrm.table([
          input.depot,
          ...routable.map((j) => j.location!),
        ]);
        break;
      } catch (err) {
        if (!(err instanceof UnreachablePointsError)) throw err;
        const bad = new Set(err.indices.map((i) => i - 1));
        unreachable.push(...routable.filter((_, i) => bad.has(i)));
        routable = routable.filter((_, i) => !bad.has(i));
      }
    }
    for (const j of unreachable) unassigned.push({ key: j.key, reason: 'UNREACHABLE' });

    const base = Math.min(...input.vehicles.map((v) => v.availableFrom.getTime()));
    const sec = (d: Date) => Math.max(0, Math.round((d.getTime() - base) / 1000));

    const vroomJobs: VroomJob[] = [];
    routable.forEach((j, i) => {
      const window: [number, number] | undefined =
        j.windowStart || j.windowEnd
          ? [
              j.windowStart ? sec(j.windowStart) : 0,
              j.windowEnd ? sec(j.windowEnd) : OPEN_ENDED_SECONDS,
            ]
          : undefined;
      // Window already over (or malformed): VROOM would reject the whole
      // problem on start > end, so it never goes in.
      if (window && (window[0] > window[1] || (j.windowEnd && j.windowEnd.getTime() <= base))) {
        unassigned.push({ key: j.key, reason: 'OUTSIDE_WINDOW' });
        return;
      }
      vroomJobs.push({
        id: i + 1,
        locationIndex: i + 1,
        serviceSeconds: STOP_DWELL_SECONDS,
        timeWindow: window,
      });
    });

    // Where and when each driver is free next; moves on as stops are added.
    const cursors: DriverCursor[] = input.vehicles.map((vehicle) => ({
      vehicle,
      at: vehicle.availableFrom,
      matrixIndex: 0,
    }));
    const addStops = (cursor: DriverCursor, order: { job: OptimizerJob; index: number }[]) => {
      if (order.length === 0) return;
      const stops = this.schedule(cursor.at, order, matrix!, cursor.matrixIndex);
      routes.get(cursor.vehicle.key)!.push(...stops);
      cursor.at = new Date(stops[stops.length - 1].eta!.getTime() + STOP_DWELL_SECONDS * 1000);
      cursor.matrixIndex = order[order.length - 1].index;
    };

    // Each tier is its own solve: HIGH from the start point, then normal stops
    // from wherever the HIGH run ended, so neither order bends around the other.
    for (const tier of [DeliveryPriority.HIGH, DeliveryPriority.NORMAL]) {
      const tierJobs = vroomJobs.filter((j) => routable[j.id - 1].priority === tier);
      if (tierJobs.length > 0) {
        // Where this tier started: "could a driver reach it directly?" must not
        // be asked from the end of the run it was left out of.
        const tierStart = cursors.map((c) => ({ ...c }));
        const solution = await this.vroom.solve({
          vehicles: cursors.map((c, i) => ({
            id: i + 1,
            startIndex: c.matrixIndex,
            timeWindow: [
              sec(c.at),
              c.vehicle.availableUntil
                ? Math.max(sec(c.at), sec(c.vehicle.availableUntil))
                : sec(c.at) + OPEN_ENDED_SECONDS,
            ],
          })),
          jobs: tierJobs,
          matrix: matrix!,
        });

        for (const r of solution.routes) {
          addStops(
            cursors[r.vehicleId - 1],
            r.jobIds.map((id) => ({ job: routable[id - 1], index: id })),
          );
        }
        for (const id of solution.unassignedJobIds) {
          const job = routable[id - 1];
          unassigned.push({ key: job.key, reason: this.unassignedReason(job, id, tierStart, matrix!) });
        }
      }

      // Stays inside its own tier: a HIGH stop that can't fit still goes ahead
      // of the normal stops.
      if (input.keepUnassigned && input.vehicles.length === 1) {
        const left = input.jobs.filter(
          (j) => j.priority === tier && unassigned.some((u) => u.key === j.key),
        );
        addStops(
          cursors[0],
          routable.flatMap((job, i) => (left.includes(job) ? [{ job, index: i + 1 }] : [])),
        );
        routes.get(cursors[0].vehicle.key)!.push(
          ...left
            .filter((j) => !routable.includes(j))
            .map((j) => ({ key: j.key, eta: null, leg: null })),
        );
      }
    }

    return { routes, unassigned };
  }

  // ETAs for a fixed visiting order (a previewed plan being saved): same
  // arithmetic as optimize(), no re-sequencing.
  async scheduleFixedOrder(
    depot: LatLng,
    departAt: Date,
    jobs: (OptimizerJob & { location: LatLng })[],
  ): Promise<ScheduledStop[]> {
    if (jobs.length === 0) return [];
    const matrix = await this.osrm.table([depot, ...jobs.map((j) => j.location)]);
    return this.schedule(
      departAt,
      jobs.map((job, i) => ({ job, index: i + 1 })),
      matrix,
    );
  }

  // Walks the order from `startIndex` (matrix index, 0 = depot), arriving
  // after each leg and waiting for the delivery window to open if early.
  // plannedEta = when the delivery can actually happen.
  private schedule(
    departAt: Date,
    order: { job: OptimizerJob; index: number }[],
    matrix: TravelMatrix,
    startIndex = 0,
  ): ScheduledStop[] {
    let t = departAt.getTime();
    let prev = startIndex;
    return order.map(({ job, index }) => {
      const leg = {
        durationSeconds: matrix.durations[prev][index],
        distanceMeters: matrix.distances[prev][index],
      };
      t += leg.durationSeconds * 1000;
      if (job.windowStart && job.windowStart.getTime() > t) t = job.windowStart.getTime();
      const eta = new Date(t);
      t += STOP_DWELL_SECONDS * 1000;
      prev = index;
      return { key: job.key, eta, leg };
    });
  }

  // VROOM doesn't say why a job was left out. Best-effort: if no driver
  // could reach it inside its window even driving straight there, it's
  // the window; otherwise the drivers' hours ran out.
  private unassignedReason(
    job: OptimizerJob,
    matrixIndex: number,
    cursors: DriverCursor[],
    matrix: TravelMatrix,
  ): UnscheduledReason {
    if (!job.windowStart && !job.windowEnd) return 'NO_TIME';
    const anyFits = cursors.some((c) => {
      const earliest = Math.max(
        c.at.getTime() + matrix.durations[c.matrixIndex][matrixIndex] * 1000,
        job.windowStart?.getTime() ?? 0,
      );
      const latest = Math.min(
        job.windowEnd?.getTime() ?? Infinity,
        c.vehicle.availableUntil?.getTime() ?? Infinity,
      );
      return earliest <= latest;
    });
    return anyFits ? 'NO_TIME' : 'OUTSIDE_WINDOW';
  }
}
