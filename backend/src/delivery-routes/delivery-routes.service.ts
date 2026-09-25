// src/delivery-routes/delivery-routes.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryOrderStatus,
  DeliveryPriority,
  Prisma,
  RouteHistoryEventType,
  RouteStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  OsrmService,
  type LatLng,
  type TripLeg,
} from '../routing/osrm.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { AddRouteStopDto } from './dto/add-route-stop.dto';
import { ReorderRouteStopsDto } from './dto/reorder-route-stops.dto';
import { SetRouteStartDto } from './dto/set-route-start.dto';
import { OptimizeRouteDto } from './dto/optimize-route.dto';

export type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

// A fixed dwell time added per stop when computing ETAs — how long the
// driver is assumed to spend at each stop before departing for the next.
// Not configurable in this pass; a flat estimate, not a promise.
const STOP_DWELL_SECONDS = 5 * 60;

// How far past its own ETA a still-PENDING stop has to be before it's
// flagged "at risk" — a grace window so an ETA that's off by a couple of
// minutes doesn't immediately read as a delay.
const AT_RISK_GRACE_MINUTES = 15;

const stopSelect = {
  id: true,
  sequence: true,
  plannedEta: true,
  travelSecondsFromPrevious: true,
  deliveryOrder: {
    select: {
      id: true,
      doNumber: true,
      status: true,
      signedAt: true,
      customerName: true,
      deliveryAddress: true,
      completedLatitude: true,
      completedLongitude: true,
      failedAt: true,
      failureReason: true,
      failureLatitude: true,
      failureLongitude: true,
      destinationLatitude: true,
      destinationLongitude: true,
      priority: true,
      deliveryWindowStart: true,
      deliveryWindowEnd: true,
    },
  },
} satisfies Prisma.RouteStopSelect;

type StopRow = Prisma.RouteStopGetPayload<{ select: typeof stopSelect }>;

@Injectable()
export class DeliveryRoutesService {
  constructor(
    private prisma: PrismaService,
    private osrm: OsrmService,
    private notifications: NotificationsService,
  ) {}

  // Delivery status is the source of truth (spec's own rule) — a stop's
  // state is always derived here, never stored, so it can never drift
  // from the delivery order it wraps.
  deriveStopStatus(deliveryOrder: {
    status: DeliveryOrderStatus;
    signedAt: Date | null;
  }): StopStatus {
    if (deliveryOrder.status === DeliveryOrderStatus.FAILED) return 'FAILED';
    if (
      deliveryOrder.status === DeliveryOrderStatus.SHIPPED &&
      deliveryOrder.signedAt != null
    )
      return 'DELIVERED';
    return 'PENDING';
  }

  // Never a physical-position check — purely "is it past the time we
  // expected to be there" (or past the customer's own requested window),
  // recomputed at read time. Matches the module's "status/event-based,
  // not live-tracking" rule. Two independent triggers, either is enough:
  // - plannedEta blown past its grace window (schedule slipping)
  // - the ETA itself now lands after the customer's requested window end
  //   (even a "perfectly on schedule" ETA can already be a broken promise)
  private isAtRisk(
    status: StopStatus,
    plannedEta: Date | null,
    deliveryWindowEnd: Date | null,
  ): boolean {
    if (status !== 'PENDING') return false;
    if (
      plannedEta &&
      Date.now() > plannedEta.getTime() + AT_RISK_GRACE_MINUTES * 60 * 1000
    )
      return true;
    if (
      plannedEta &&
      deliveryWindowEnd &&
      plannedEta.getTime() > deliveryWindowEnd.getTime()
    )
      return true;
    return false;
  }

  private presentStop(stop: StopRow) {
    const status = this.deriveStopStatus(stop.deliveryOrder);
    return {
      id: stop.id,
      sequence: stop.sequence,
      plannedEta: stop.plannedEta,
      status,
      atRisk: this.isAtRisk(
        status,
        stop.plannedEta,
        stop.deliveryOrder.deliveryWindowEnd,
      ),
      deliveryOrder: stop.deliveryOrder,
    };
  }

  private dayRange(date: string): { gte: Date; lt: Date } {
    const start = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD value');
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { gte: start, lt: end };
  }

  private async assertDriver(organizationId: string, driverId: string) {
    const driver = await this.prisma.user.findFirst({
      where: { id: driverId, organizationId, role: 'DRIVER' },
      select: { id: true },
    });
    if (!driver)
      throw new NotFoundException(
        'Driver not found (must be a user with the DRIVER role)',
      );
  }

  async listDrivers(organizationId: string) {
    return this.prisma.user.findMany({
      where: { organizationId, role: 'DRIVER', active: true },
      select: {
        id: true,
        email: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: { email: 'asc' },
    });
  }

  private async assertDeliveryOrderAvailable(
    organizationId: string,
    deliveryOrderId: string,
  ) {
    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id: deliveryOrderId, organizationId },
      select: { id: true, status: true, routeStop: { select: { id: true } } },
    });
    if (!deliveryOrder) throw new NotFoundException('Delivery order not found');
    if (deliveryOrder.routeStop) {
      throw new BadRequestException(
        'This delivery order is already on a route',
      );
    }
    if (
      deliveryOrder.status !== DeliveryOrderStatus.PACKED &&
      deliveryOrder.status !== DeliveryOrderStatus.SHIPPED
    ) {
      throw new BadRequestException(
        'Only a packed or shipped delivery order can be added to a route',
      );
    }
  }

  // Append-only audit log — best-effort, like ETA recalculation: a
  // logging hiccup must never block the mutation it's describing.
  private async recordHistory(
    routeId: string,
    type: RouteHistoryEventType,
    createdByUserId: string | undefined,
    metadata?: Record<string, unknown>,
  ) {
    try {
      await this.prisma.routeHistoryEvent.create({
        data: {
          routeId,
          type,
          createdByUserId,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch {
      // ignore
    }
  }

  async getHistory(organizationId: string, routeId: string) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId },
      select: { id: true },
    });
    if (!route) throw new NotFoundException('Route not found');

    return this.prisma.routeHistoryEvent.findMany({
      where: { routeId },
      include: { createdBy: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createRoute(
    organizationId: string,
    createdByUserId: string,
    dto: CreateRouteDto,
  ) {
    await this.assertDriver(organizationId, dto.driverId);
    const route = await this.prisma.route.create({
      data: {
        organizationId,
        driverId: dto.driverId,
        routeDate: new Date(`${dto.routeDate}T00:00:00.000Z`),
        name: dto.name,
        createdByUserId,
      },
    });
    await this.recordHistory(
      route.id,
      RouteHistoryEventType.CREATED,
      createdByUserId,
    );
    await this.notifications.create(
      organizationId,
      dto.driverId,
      'DELIVERY_ASSIGNED',
      'A new route was assigned to you',
      {
        link: '/driver',
        payload: { routeId: route.id },
      },
    );
    return route;
  }

  // A DRIVER may only ever see routes assigned to them — same "deny
  // unless it's yours" scoping as assertRequesterCanActOnDeliveryOrder in
  // delivery-order.service.ts, just applied to reads instead of writes.
  // ADMIN/USER are unrestricted. `mine` already enforced this for drivers;
  // this closes the same gap on the general list/get-by-id endpoints,
  // which a DRIVER JWT could otherwise use to read any route in the org.
  async listRoutes(
    organizationId: string,
    filters: { driverId?: string; date?: string; status?: RouteStatus },
    requester?: { sub: string; role: string },
  ) {
    const driverId =
      requester?.role === 'DRIVER' ? requester.sub : filters.driverId;
    return this.prisma.route.findMany({
      where: {
        organizationId,
        driverId,
        status: filters.status,
        ...(filters.date ? { routeDate: this.dayRange(filters.date) } : {}),
      },
      include: {
        driver: { select: { id: true, email: true } },
        _count: { select: { stops: true } },
      },
      orderBy: [{ routeDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getRoute(
    organizationId: string,
    id: string,
    requester?: { sub: string; role: string },
  ) {
    const route = await this.prisma.route.findFirst({
      where: {
        id,
        organizationId,
        ...(requester?.role === 'DRIVER' ? { driverId: requester.sub } : {}),
      },
      include: {
        driver: { select: { id: true, email: true } },
        stops: { select: stopSelect, orderBy: { sequence: 'asc' } },
      },
    });
    // Same 404 (not 403) whether the route doesn't exist or belongs to
    // another driver — doesn't confirm to a DRIVER that a given route id
    // is real, only that it isn't theirs.
    if (!route) throw new NotFoundException('Route not found');

    const stops = route.stops.map((stop) => this.presentStop(stop));
    const currentStop = stops.find((stop) => stop.status === 'PENDING') ?? null;

    return { ...route, stops, currentStop };
  }

  async updateRoute(
    organizationId: string,
    id: string,
    dto: UpdateRouteDto,
    userId?: string,
  ) {
    const route = await this.prisma.route.findFirst({
      where: { id, organizationId },
    });
    if (!route) throw new NotFoundException('Route not found');
    if (dto.driverId) await this.assertDriver(organizationId, dto.driverId);

    const updated = await this.prisma.route.update({
      where: { id },
      data: { name: dto.name, status: dto.status, driverId: dto.driverId },
    });
    if (dto.driverId && dto.driverId !== route.driverId) {
      await this.recordHistory(
        id,
        RouteHistoryEventType.DRIVER_CHANGED,
        userId,
        {
          from: route.driverId,
          to: dto.driverId,
        },
      );
      await this.notifications.create(
        organizationId,
        dto.driverId,
        'ROUTE_REASSIGNED',
        'A route was reassigned to you',
        {
          link: '/driver',
          payload: { routeId: id },
        },
      );
    }
    return updated;
  }

  async setStart(
    organizationId: string,
    routeId: string,
    dto: SetRouteStartDto,
    userId?: string,
  ) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId },
    });
    if (!route) throw new NotFoundException('Route not found');

    const updated = await this.prisma.route.update({
      where: { id: routeId },
      data: { startLatitude: dto.latitude, startLongitude: dto.longitude },
    });
    await this.recordHistory(routeId, RouteHistoryEventType.START_SET, userId, {
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
    return updated;
  }

  // Re-sequences and re-ETAs only the still-PENDING stops via OSRM's trip
  // (TSP-heuristic) service — resolved (delivered/failed) stops keep their
  // existing sequence untouched (spec: "only remaining deliveries should
  // be re-optimized"). Caches each stop's travel leg so later ETA
  // recalculation (recalculateEtasAfterResolution) is pure arithmetic.
  private coordsOf(stop: {
    deliveryOrder: {
      destinationLatitude: Prisma.Decimal | null;
      destinationLongitude: Prisma.Decimal | null;
    };
  }): LatLng {
    return {
      lat: Number(stop.deliveryOrder.destinationLatitude),
      lng: Number(stop.deliveryOrder.destinationLongitude),
    };
  }

  // One OSRM Trip call: `start` first, then `stops` re-sequenced for
  // shortest total travel. Returns the stops in that visiting order,
  // paired with the leg arriving at each one — a plain wrapper around
  // OsrmService.trip() that resolves indices back to the actual stops.
  private async optimizeGroup<
    T extends {
      deliveryOrder: {
        destinationLatitude: Prisma.Decimal | null;
        destinationLongitude: Prisma.Decimal | null;
      };
    },
  >(
    start: LatLng,
    stops: T[],
  ): Promise<{ orderedStops: T[]; legs: TripLeg[] }> {
    const { order, legs } = await this.osrm.trip([
      start,
      ...stops.map((s) => this.coordsOf(s)),
    ]);
    return { orderedStops: order.map((i) => stops[i]), legs };
  }

  // Re-sequences and re-ETAs only the still-PENDING stops via OSRM's trip
  // (TSP-heuristic) service — resolved (delivered/failed) stops keep their
  // existing sequence untouched (spec: "only remaining deliveries should
  // be re-optimized"). Caches each stop's travel leg so later ETA
  // recalculation (recalculateEtasAfterResolution) is pure arithmetic.
  //
  // Priority-weighted: HIGH-priority stops are visited first as their own
  // optimized sub-sequence, then NORMAL stops as a second sub-sequence
  // chained from wherever the HIGH sub-sequence ends. This is a heuristic
  // — optimal *within* each tier, not a true globally-optimal
  // priority-constrained TSP solve — same honest framing as
  // STOP_DWELL_SECONDS/AT_RISK_GRACE_MINUTES above. When every pending
  // stop shares one priority tier (the common case), this costs exactly
  // one OSRM call, identical to before priority existed.
  async optimize(
    organizationId: string,
    routeId: string,
    dto: OptimizeRouteDto,
    userId?: string,
  ) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId },
      include: {
        stops: {
          include: { deliveryOrder: true },
          orderBy: { sequence: 'asc' },
        },
      },
    });
    if (!route) throw new NotFoundException('Route not found');
    if (route.startLatitude == null || route.startLongitude == null) {
      throw new BadRequestException(
        "Set the route's start point before optimizing",
      );
    }

    const pendingStops = route.stops.filter(
      (s) => this.deriveStopStatus(s.deliveryOrder) === 'PENDING',
    );
    const missingDestination = pendingStops.filter(
      (s) =>
        s.deliveryOrder.destinationLatitude == null ||
        s.deliveryOrder.destinationLongitude == null,
    );
    if (missingDestination.length > 0) {
      const names = missingDestination
        .map(
          (s) =>
            s.deliveryOrder.customerName ??
            s.deliveryOrder.doNumber ??
            s.deliveryOrder.id,
        )
        .join(', ');
      throw new BadRequestException(
        `These stops need a destination pin before optimizing: ${names}`,
      );
    }
    if (pendingStops.length === 0) {
      return this.getRoute(organizationId, routeId);
    }

    const start = {
      lat: Number(route.startLatitude),
      lng: Number(route.startLongitude),
    };
    const highStops = pendingStops.filter(
      (s) => s.deliveryOrder.priority === DeliveryPriority.HIGH,
    );
    const normalStops = pendingStops.filter(
      (s) => s.deliveryOrder.priority !== DeliveryPriority.HIGH,
    );

    let orderedStops: typeof pendingStops;
    let legs: TripLeg[];
    if (highStops.length === 0 || normalStops.length === 0) {
      // Single tier present — identical cost/behavior to no-priority optimize().
      ({ orderedStops, legs } = await this.optimizeGroup(start, pendingStops));
    } else {
      const high = await this.optimizeGroup(start, highStops);
      const chainStart = this.coordsOf(
        high.orderedStops[high.orderedStops.length - 1],
      );
      const normal = await this.optimizeGroup(chainStart, normalStops);
      orderedStops = [...high.orderedStops, ...normal.orderedStops];
      legs = [...high.legs, ...normal.legs];
    }

    const highestResolvedSequence = route.stops
      .filter((s) => this.deriveStopStatus(s.deliveryOrder) !== 'PENDING')
      .reduce((max, s) => Math.max(max, s.sequence), 0);

    const departureAt = dto.departureAt
      ? new Date(dto.departureAt)
      : (route.plannedDepartureAt ?? new Date());
    let cumulativeMs = departureAt.getTime();

    // Two-phase sequence update, same reasoning as reorderStops(): avoids
    // transiently colliding with @@unique([routeId, sequence]).
    const negativeUpdates = pendingStops.map((s, i) =>
      this.prisma.routeStop.update({
        where: { id: s.id },
        data: { sequence: -(i + 1) },
      }),
    );
    const finalUpdates = orderedStops.map((stop, visitPosition) => {
      const leg = legs[visitPosition];
      cumulativeMs += leg.durationSeconds * 1000;
      const plannedEta = new Date(cumulativeMs);
      cumulativeMs += STOP_DWELL_SECONDS * 1000;

      return this.prisma.routeStop.update({
        where: { id: stop.id },
        data: {
          sequence: highestResolvedSequence + visitPosition + 1,
          travelMetersFromPrevious: leg.distanceMeters,
          travelSecondsFromPrevious: Math.round(leg.durationSeconds),
          plannedEta,
        },
      });
    });

    await this.prisma.$transaction([
      ...negativeUpdates,
      ...finalUpdates,
      this.prisma.route.update({
        where: { id: routeId },
        data: { plannedDepartureAt: departureAt },
      }),
    ]);
    await this.recordHistory(routeId, RouteHistoryEventType.OPTIMIZED, userId, {
      stopCount: pendingStops.length,
      highPriorityCount: highStops.length,
    });
    await this.notifications.create(
      organizationId,
      route.driverId,
      'ROUTE_REOPTIMIZED',
      'Your route was re-optimized',
      {
        link: '/driver',
        payload: { routeId },
      },
    );

    return this.getRoute(organizationId, routeId);
  }

  // Called after a delivery resolves (delivered/failed) — walks the
  // remaining PENDING stops on the same route, re-summing their *cached*
  // travelSecondsFromPrevious from the actual resolution time. Pure
  // arithmetic, no OSRM call: an actual completion time is exactly the
  // kind of "known" data point the spec says ETA should recompute from,
  // and re-hitting OSRM per delivery would be a live-tracking-shaped
  // dependency this module deliberately avoids.
  async recalculateEtasAfterResolution(
    deliveryOrderId: string,
    resolvedAt: Date,
  ) {
    const resolvedStop = await this.prisma.routeStop.findUnique({
      where: { deliveryOrderId },
      select: { routeId: true, sequence: true },
    });
    if (!resolvedStop) return; // not on a route — nothing to recalculate

    const remaining = await this.prisma.routeStop.findMany({
      where: {
        routeId: resolvedStop.routeId,
        sequence: { gt: resolvedStop.sequence },
      },
      include: { deliveryOrder: { select: { status: true, signedAt: true } } },
      orderBy: { sequence: 'asc' },
    });

    let cumulativeMs = resolvedAt.getTime();
    for (const stop of remaining) {
      if (this.deriveStopStatus(stop.deliveryOrder) !== 'PENDING') continue;
      if (stop.travelSecondsFromPrevious == null) break; // never optimized — nothing to walk forward from
      cumulativeMs += stop.travelSecondsFromPrevious * 1000;
      await this.prisma.routeStop.update({
        where: { id: stop.id },
        data: { plannedEta: new Date(cumulativeMs) },
      });
      cumulativeMs += STOP_DWELL_SECONDS * 1000;
    }
  }

  async addStop(
    organizationId: string,
    routeId: string,
    dto: AddRouteStopDto,
    userId?: string,
  ) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId },
    });
    if (!route) throw new NotFoundException('Route not found');
    await this.assertDeliveryOrderAvailable(
      organizationId,
      dto.deliveryOrderId,
    );

    const stop = await this.prisma.$transaction(async (tx) => {
      const sequence =
        dto.sequence ??
        ((
          await tx.routeStop.aggregate({
            where: { routeId },
            _max: { sequence: true },
          })
        )._max.sequence ?? 0) + 1;

      if (dto.sequence != null) {
        // Shift existing stops at/after the target sequence to make room,
        // same "insert with resequence" shape as ReorderRouteStopsDto.
        await tx.routeStop.updateMany({
          where: { routeId, sequence: { gte: dto.sequence } },
          data: { sequence: { increment: 1 } },
        });
      }

      return tx.routeStop.create({
        data: { routeId, deliveryOrderId: dto.deliveryOrderId, sequence },
      });
    });
    await this.recordHistory(
      routeId,
      RouteHistoryEventType.STOP_ADDED,
      userId,
      {
        deliveryOrderId: dto.deliveryOrderId,
      },
    );
    if (route.status === RouteStatus.ACTIVE) {
      await this.notifications.create(
        organizationId,
        route.driverId,
        'ROUTE_STOPS_CHANGED',
        'A stop was added to your route',
        {
          link: '/driver',
          payload: { routeId },
        },
      );
    }
    return stop;
  }

  async reorderStops(
    organizationId: string,
    routeId: string,
    dto: ReorderRouteStopsDto,
    userId?: string,
  ) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId },
      include: { stops: { select: { id: true } } },
    });
    if (!route) throw new NotFoundException('Route not found');

    const routeStopIds = new Set(route.stops.map((s) => s.id));
    const givenIds = new Set(dto.stops.map((s) => s.stopId));
    if (
      routeStopIds.size !== givenIds.size ||
      [...routeStopIds].some((id) => !givenIds.has(id))
    ) {
      throw new BadRequestException(
        'The reorder list must include every stop on this route exactly once',
      );
    }

    // Two-phase update avoids transiently colliding with the
    // @@unique([routeId, sequence]) constraint while stops swap positions.
    await this.prisma.$transaction([
      ...dto.stops.map((s, i) =>
        this.prisma.routeStop.update({
          where: { id: s.stopId },
          data: { sequence: -(i + 1) },
        }),
      ),
      ...dto.stops.map((s) =>
        this.prisma.routeStop.update({
          where: { id: s.stopId },
          data: { sequence: s.sequence },
        }),
      ),
    ]);
    await this.recordHistory(
      routeId,
      RouteHistoryEventType.STOPS_REORDERED,
      userId,
    );
    if (route.status === RouteStatus.ACTIVE) {
      await this.notifications.create(
        organizationId,
        route.driverId,
        'ROUTE_STOPS_CHANGED',
        'Your route order was changed',
        {
          link: '/driver',
          payload: { routeId },
        },
      );
    }

    return this.getRoute(organizationId, routeId);
  }

  async removeStop(
    organizationId: string,
    routeId: string,
    stopId: string,
    userId?: string,
  ) {
    const stop = await this.prisma.routeStop.findFirst({
      where: { id: stopId, routeId, route: { organizationId } },
      include: {
        deliveryOrder: { select: { status: true, signedAt: true } },
        route: { select: { driverId: true, status: true } },
      },
    });
    if (!stop) throw new NotFoundException('Stop not found');
    // Use the same derived status as everywhere else — DeliveryOrder.status
    // alone can't tell "still shipped, awaiting proof" from "delivered"
    // (both are DeliveryOrderStatus.SHIPPED; see deriveStopStatus).
    if (this.deriveStopStatus(stop.deliveryOrder) !== 'PENDING') {
      throw new BadRequestException(
        'Cannot remove a stop once its delivery has been resolved (delivered/failed)',
      );
    }
    await this.prisma.routeStop.delete({ where: { id: stopId } });
    await this.recordHistory(
      routeId,
      RouteHistoryEventType.STOP_REMOVED,
      userId,
      { stopId },
    );
    if (stop.route.status === RouteStatus.ACTIVE) {
      await this.notifications.create(
        organizationId,
        stop.route.driverId,
        'ROUTE_STOPS_CHANGED',
        'A stop was removed from your route',
        {
          link: '/driver',
          payload: { routeId },
        },
      );
    }
  }

  async listMyRoutes(organizationId: string, driverId: string, date?: string) {
    const routeDate = date ?? new Date().toISOString().slice(0, 10);
    const routes = await this.prisma.route.findMany({
      where: { organizationId, driverId, routeDate: this.dayRange(routeDate) },
      include: { stops: { select: stopSelect, orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return routes.map((route) => {
      const stops = route.stops.map((stop) => this.presentStop(stop));
      return {
        ...route,
        stops,
        currentStop: stops.find((stop) => stop.status === 'PENDING') ?? null,
      };
    });
  }

  async monitoringSummary(organizationId: string, date?: string) {
    const routeDate = date ?? new Date().toISOString().slice(0, 10);
    const stops = await this.prisma.routeStop.findMany({
      where: { route: { organizationId, routeDate: this.dayRange(routeDate) } },
      select: stopSelect,
    });

    const counts = {
      total: stops.length,
      delivered: 0,
      pending: 0,
      failed: 0,
      atRisk: 0,
    };
    for (const stop of stops) {
      const status = this.deriveStopStatus(stop.deliveryOrder);
      if (status === 'DELIVERED') counts.delivered++;
      else if (status === 'FAILED') counts.failed++;
      else counts.pending++;
      if (
        this.isAtRisk(
          status,
          stop.plannedEta,
          stop.deliveryOrder.deliveryWindowEnd,
        )
      )
        counts.atRisk++;
    }
    return counts;
  }

  async monitoringByDriver(organizationId: string, date?: string) {
    const routeDate = date ?? new Date().toISOString().slice(0, 10);
    const routes = await this.prisma.route.findMany({
      where: { organizationId, routeDate: this.dayRange(routeDate) },
      include: {
        driver: { select: { id: true, email: true } },
        stops: { select: stopSelect },
      },
    });

    return routes.map((route) => {
      const counts = {
        total: route.stops.length,
        delivered: 0,
        pending: 0,
        failed: 0,
        atRisk: 0,
      };
      for (const stop of route.stops) {
        const status = this.deriveStopStatus(stop.deliveryOrder);
        if (status === 'DELIVERED') counts.delivered++;
        else if (status === 'FAILED') counts.failed++;
        else counts.pending++;
        if (
          this.isAtRisk(
            status,
            stop.plannedEta,
            stop.deliveryOrder.deliveryWindowEnd,
          )
        )
          counts.atRisk++;
      }
      return { routeId: route.id, driver: route.driver, ...counts };
    });
  }

  // Flattened, org-wide "today's stops" for the monitoring map — every
  // stop across every driver's route for the date, not grouped by route.
  // Falls back to the completed/failure pin when no destination pin was
  // ever set, so a resolved stop still shows up on the map even if
  // nobody set its destination beforehand.
  async monitoringMap(organizationId: string, date?: string) {
    const routeDate = date ?? new Date().toISOString().slice(0, 10);
    const stops = await this.prisma.routeStop.findMany({
      where: { route: { organizationId, routeDate: this.dayRange(routeDate) } },
      select: stopSelect,
    });

    return stops
      .map((stop) => {
        const status = this.deriveStopStatus(stop.deliveryOrder);
        const latitude =
          stop.deliveryOrder.destinationLatitude ??
          stop.deliveryOrder.completedLatitude ??
          stop.deliveryOrder.failureLatitude;
        const longitude =
          stop.deliveryOrder.destinationLongitude ??
          stop.deliveryOrder.completedLongitude ??
          stop.deliveryOrder.failureLongitude;
        return {
          id: stop.id,
          status,
          latitude,
          longitude,
          label:
            stop.deliveryOrder.customerName ??
            stop.deliveryOrder.doNumber ??
            stop.deliveryOrder.id,
        };
      })
      .filter((s) => s.latitude != null && s.longitude != null);
  }
}
