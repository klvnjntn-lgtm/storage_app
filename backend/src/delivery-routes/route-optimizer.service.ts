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

const DAY_OF_WEEK_BY_UTC_DAY: DayOfWeek[] = [
  DayOfWeek.SUN,
  DayOfWeek.MON,
  DayOfWeek.TUE,
  DayOfWeek.WED,
  DayOfWeek.THU,
  DayOfWeek.FRI,
  DayOfWeek.SAT,
];

// VROOM decides who goes where and in what order; OSRM supplies the
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
  // `depot`. With `keepUnassigned` (single-vehicle re-optimize of an
  // existing route), jobs VROOM couldn't fit are still appended to the
  // end of the one vehicle's route — they're already on it — and still
  // reported in `unassigned` so the caller can warn about them.
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
    let matrix: TravelMatrix;
    const unreachable: OptimizerJob[] = [];
    for (;;) {
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
        priority: j.priority === DeliveryPriority.HIGH ? 100 : 0,
        timeWindow: window,
      });
    });

    const solution = await this.vroom.solve({
      vehicles: input.vehicles.map((v, i) => ({
        id: i + 1,
        startIndex: 0,
        timeWindow: [
          sec(v.availableFrom),
          v.availableUntil
            ? Math.max(sec(v.availableFrom), sec(v.availableUntil))
            : sec(v.availableFrom) + OPEN_ENDED_SECONDS,
        ],
      })),
      jobs: vroomJobs,
      matrix: matrix!,
    });

    for (const r of solution.routes) {
      const vehicle = input.vehicles[r.vehicleId - 1];
      const order = r.jobIds.map((id) => ({ job: routable[id - 1], index: id }));
      routes.set(vehicle.key, this.schedule(vehicle.availableFrom, order, matrix!));
    }

    for (const id of solution.unassignedJobIds) {
      const job = routable[id - 1];
      unassigned.push({ key: job.key, reason: this.unassignedReason(job, id, input.vehicles, matrix!) });
    }

    if (input.keepUnassigned && input.vehicles.length === 1) {
      const vehicle = input.vehicles[0];
      const scheduled = routes.get(vehicle.key)!;
      const lastIndex = scheduled.length
        ? routable.findIndex((j) => j.key === scheduled[scheduled.length - 1].key) + 1
        : 0;
      const stillRoutable = unassigned
        .map((u) => routable.findIndex((j) => j.key === u.key))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b) // keep their current relative order
        .map((i) => ({ job: routable[i], index: i + 1 }));
      const lastEta = scheduled.length ? scheduled[scheduled.length - 1].eta : null;
      const resumeAt = lastEta
        ? new Date(lastEta.getTime() + STOP_DWELL_SECONDS * 1000)
        : vehicle.availableFrom;
      const tail = this.schedule(resumeAt, stillRoutable, matrix!, lastIndex);
      const unroutable = input.jobs
        .filter((j) => unassigned.some((u) => u.key === j.key))
        .filter((j) => !stillRoutable.some((s) => s.job.key === j.key))
        .map((j) => ({ key: j.key, eta: null, leg: null }));
      routes.set(vehicle.key, [...scheduled, ...tail, ...unroutable]);
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
    vehicles: OptimizerVehicle[],
    matrix: TravelMatrix,
  ): UnscheduledReason {
    if (!job.windowStart && !job.windowEnd) return 'NO_TIME';
    const direct = matrix.durations[0][matrixIndex] * 1000;
    const anyFits = vehicles.some((v) => {
      const earliest = Math.max(
        v.availableFrom.getTime() + direct,
        job.windowStart?.getTime() ?? 0,
      );
      const latest = Math.min(
        job.windowEnd?.getTime() ?? Infinity,
        v.availableUntil?.getTime() ?? Infinity,
      );
      return earliest <= latest;
    });
    return anyFits ? 'NO_TIME' : 'OUTSIDE_WINDOW';
  }
}
