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

// Default time spent at each stop before departing for the next — a
// business sets its own (Organization.deliveryStopMinutes, see TripTiming).
export const STOP_DWELL_SECONDS = 5 * 60;

// How a business's real trips compare with the road data: OSRM's travel
// times × travelFactor, and dwellSeconds at every stop.
export type TripTiming = { travelFactor: number; dwellSeconds: number };
export const DEFAULT_TIMING: TripTiming = { travelFactor: 1, dwellSeconds: STOP_DWELL_SECONDS };

// A gap between a driver's working windows on one day (lunch, prayers):
// no driving and no deliveries during it.
export type DriverBreak = { start: Date; end: Date };

// A pin this far by road from the start point, and several times further
// than the day's typical stop, is most likely a typo or a pin dropped in the
// wrong town: still routed, but reported so someone checks it. Below
// FAR_PIN_MIN_METERS nothing is far; with too few stops to compare against,
// only FAR_PIN_ALONE_METERS is.
const FAR_PIN_MIN_METERS = 30_000;
const FAR_PIN_TIMES_MEDIAN = 3;
const FAR_PIN_ALONE_METERS = 150_000;

// Moves `t` forward by `ms` of working time, sitting out any break it runs
// into (a leg cut by lunch resumes after it). A `t` inside a break first
// waits for it to end. `breaks` sorted, not overlapping.
export function addWorkingTime(t: number, ms: number, breaks: { start: number; end: number }[]): number {
  for (const b of breaks) {
    if (b.end <= t) continue;
    if (t >= b.start) {
      t = b.end;
      continue;
    }
    if (t + ms <= b.start) return t + ms;
    ms -= b.start - t;
    t = b.end;
  }
  return t + ms;
}

const breakTimes = (breaks: DriverBreak[] | undefined) =>
  (breaks ?? [])
    .map((b) => ({ start: b.start.getTime(), end: b.end.getTime() }))
    .sort((a, b) => a.start - b.start);

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

// Keys of jobs whose pin is suspiciously far from the start (see
// FAR_PIN_MIN_METERS), with the road distance.
export type FarPin = { key: string; meters: number };

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
  breaks?: DriverBreak[];
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
  far: FarPin[];
};

export type DriverAvailability = {
  availableFrom: Date;
  availableUntil: Date | null;
  // Driver has access hours configured at all.
  restricted: boolean;
  // Has access hours, but none on this day.
  offDuty: boolean;
  // "08:00–12:00, 13:00–17:00" on this day, for display; null when unrestricted/off.
  hoursLabel: string | null;
  // Gaps between this day's windows still ahead of availableFrom.
  breaks: DriverBreak[];
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

  // The business's trip timing (see TripTiming), clamped to sane values.
  async timing(organizationId: string): Promise<TripTiming> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { deliveryTravelTimeFactor: true, deliveryStopMinutes: true },
    });
    if (!org) return DEFAULT_TIMING;
    return {
      travelFactor: Math.min(5, Math.max(0.5, org.deliveryTravelTimeFactor || 1)),
      dwellSeconds: Math.min(120, Math.max(0, org.deliveryStopMinutes)) * 60,
    };
  }

  // Working hours from DriverAccessSchedule for `routeDate` (YYYY-MM-DD,
  // the business-calendar date), intersected with the requested
  // departure. Several windows on one day become first-start → last-end
  // with the gaps between them as breaks.
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
          breaks: [],
        });
        continue;
      }
      // Overlapping or touching windows join up; what's left between them are breaks.
      const windows: { start: string; end: string }[] = [];
      for (const w of today
        .map((s) => ({ start: s.startTime, end: s.endTime }))
        .sort((a, b) => a.start.localeCompare(b.start))) {
        const last = windows[windows.length - 1];
        if (last && w.start <= last.end) {
          if (w.end > last.end) last.end = w.end;
        } else {
          windows.push({ ...w });
        }
      }
      const shiftStart = wallTimeOnBusinessDay(dateOnly, windows[0].start, tz);
      const shiftEnd = wallTimeOnBusinessDay(dateOnly, windows[windows.length - 1].end, tz);
      const departure =
        departureAt ?? new Date(Math.max(now.getTime(), shiftStart.getTime()));
      let availableFrom = new Date(Math.max(departure.getTime(), shiftStart.getTime()));
      const breaks = windows
        .slice(1)
        .map((w, i) => ({
          start: wallTimeOnBusinessDay(dateOnly, windows[i].end, tz),
          end: wallTimeOnBusinessDay(dateOnly, w.start, tz),
        }))
        .filter((b) => b.end > availableFrom);
      // Leaving during a break means leaving when it's over.
      availableFrom = new Date(addWorkingTime(availableFrom.getTime(), 0, breakTimes(breaks)));
      result.set(driverId, {
        availableFrom,
        availableUntil: shiftEnd,
        restricted: true,
        offDuty: false,
        hoursLabel: windows.map((w) => `${w.start}–${w.end}`).join(', '),
        breaks: breaks.filter((b) => b.start >= availableFrom),
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
    timing?: TripTiming;
  }): Promise<OptimizeResult> {
    const timing = input.timing ?? DEFAULT_TIMING;
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
    matrix = scaleTravel(matrix, timing.travelFactor);
    const far = farPins(
      routable.map((j) => j.key),
      matrix.distances[0]?.slice(1) ?? [],
    );

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
        serviceSeconds: timing.dwellSeconds,
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
      const stops = this.schedule(cursor.at, order, matrix!, {
        startIndex: cursor.matrixIndex,
        dwellSeconds: timing.dwellSeconds,
        breaks: cursor.vehicle.breaks,
      });
      routes.get(cursor.vehicle.key)!.push(...stops);
      cursor.at = new Date(
        addWorkingTime(
          stops[stops.length - 1].eta!.getTime(),
          timing.dwellSeconds * 1000,
          breakTimes(cursor.vehicle.breaks),
        ),
      );
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
          vehicles: cursors.map((c, i) => {
            const from = sec(c.at);
            const until = c.vehicle.availableUntil
              ? Math.max(from, sec(c.vehicle.availableUntil))
              : from + OPEN_ENDED_SECONDS;
            // VROOM refuses a break outside the vehicle's window, so only
            // those still ahead and inside the shift go in.
            const breaks = (c.vehicle.breaks ?? [])
              .filter((b) => b.start >= c.at && b.end > b.start)
              .map((b) => ({ start: sec(b.start), end: sec(b.end) }))
              .filter((b) => b.end <= until);
            return {
              id: i + 1,
              startIndex: c.matrixIndex,
              timeWindow: [from, until] as [number, number],
              ...(breaks.length ? { breaks } : {}),
            };
          }),
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

    return { routes, unassigned, far };
  }

  // ETAs for a fixed visiting order (a previewed plan being saved): same
  // arithmetic as optimize(), no re-sequencing.
  async scheduleFixedOrder(
    depot: LatLng,
    departAt: Date,
    jobs: (OptimizerJob & { location: LatLng })[],
    opts: { timing?: TripTiming; breaks?: DriverBreak[] } = {},
  ): Promise<ScheduledStop[]> {
    if (jobs.length === 0) return [];
    const timing = opts.timing ?? DEFAULT_TIMING;
    const matrix = scaleTravel(
      await this.osrm.table([depot, ...jobs.map((j) => j.location)]),
      timing.travelFactor,
    );
    return this.schedule(
      departAt,
      jobs.map((job, i) => ({ job, index: i + 1 })),
      matrix,
      { dwellSeconds: timing.dwellSeconds, breaks: opts.breaks },
    );
  }

  // Walks the order from `startIndex` (matrix index, 0 = depot), arriving
  // after each leg and waiting for the delivery window to open if early,
  // sitting out the driver's breaks. plannedEta = when the delivery can
  // actually happen.
  private schedule(
    departAt: Date,
    order: { job: OptimizerJob; index: number }[],
    matrix: TravelMatrix,
    opts: { startIndex?: number; dwellSeconds?: number; breaks?: DriverBreak[] } = {},
  ): ScheduledStop[] {
    const breaks = breakTimes(opts.breaks);
    const dwellMs = (opts.dwellSeconds ?? STOP_DWELL_SECONDS) * 1000;
    let t = addWorkingTime(departAt.getTime(), 0, breaks);
    let prev = opts.startIndex ?? 0;
    return order.map(({ job, index }) => {
      const leg = {
        durationSeconds: matrix.durations[prev][index],
        distanceMeters: matrix.distances[prev][index],
      };
      t = addWorkingTime(t, leg.durationSeconds * 1000, breaks);
      if (job.windowStart && job.windowStart.getTime() > t) {
        t = addWorkingTime(job.windowStart.getTime(), 0, breaks);
      }
      const eta = new Date(t);
      t = addWorkingTime(t, dwellMs, breaks);
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

// Road travel times × the business's factor; distances stay as they are.
export function scaleTravel(matrix: TravelMatrix, factor: number): TravelMatrix {
  if (factor === 1) return matrix;
  return {
    durations: matrix.durations.map((row) => row.map((v) => Math.round(v * factor))),
    distances: matrix.distances,
  };
}

// Which of these pins sit suspiciously far from the start, given each one's
// road distance from it (see FAR_PIN_MIN_METERS).
export function farPins(keys: string[], metersFromStart: number[]): FarPin[] {
  const sorted = [...metersFromStart].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  const limit =
    sorted.length >= 3
      ? Math.max(FAR_PIN_MIN_METERS, median * FAR_PIN_TIMES_MEDIAN)
      : FAR_PIN_ALONE_METERS;
  return keys
    .map((key, i) => ({ key, meters: Math.round(metersFromStart[i]) }))
    .filter((p) => p.meters > limit);
}
