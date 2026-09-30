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
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  RouteOptimizerService,
  STOP_DWELL_SECONDS,
  type UnscheduledReason,
} from './route-optimizer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { AddRouteStopDto } from './dto/add-route-stop.dto';
import { ReorderRouteStopsDto } from './dto/reorder-route-stops.dto';
import { SetRouteStartDto } from './dto/set-route-start.dto';
import { OptimizeRouteDto } from './dto/optimize-route.dto';

export type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

// How far past its own ETA a still-PENDING stop has to be before it's
// flagged "at risk" — a grace window so an ETA that's off by a couple of
// minutes doesn't immediately read as a delay.
const AT_RISK_GRACE_MINUTES = 15;

// History events that change the stop list/order — each produces a new
// route version (see recordHistory).
const VERSIONED_EVENTS = new Set<RouteHistoryEventType>([
  RouteHistoryEventType.CREATED,
  RouteHistoryEventType.STOP_ADDED,
  RouteHistoryEventType.STOP_REMOVED,
  RouteHistoryEventType.STOPS_REORDERED,
  RouteHistoryEventType.OPTIMIZED,
  RouteHistoryEventType.STOP_RESCHEDULED,
]);

const stopSelect = {
  id: true,
  sequence: true,
  plannedEta: true,
  supersededAt: true,
  travelSecondsFromPrevious: true,
  deliveryOrder: {
    select: {
      id: true,
      doNumber: true,
      status: true,
      signedAt: true,
      customerId: true,
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
    private optimizer: RouteOptimizerService,
    private notifications: NotificationsService,
  ) {}

  // Delivery status is the source of truth (spec's own rule) — a stop's
  // state is always derived here, never stored, so it can never drift
  // from the delivery order it wraps.
  //
  // A (partial) return is post-resolution: goods that were signed for and
  // later came back still count as DELIVERED for the route; goods returned
  // without ever being signed for (e.g. brought back after a failed
  // attempt) count as FAILED. Either way the stop must not fall back to
  // PENDING, or it would become the driver's current stop again.
  // CANCELLED never appears here — cancel() detaches the stop.
  deriveStopStatus(deliveryOrder: {
    status: DeliveryOrderStatus;
    signedAt: Date | null;
  }): StopStatus {
    switch (deliveryOrder.status) {
      case DeliveryOrderStatus.FAILED:
        return 'FAILED';
      case DeliveryOrderStatus.SHIPPED:
        return deliveryOrder.signedAt != null ? 'DELIVERED' : 'PENDING';
      case DeliveryOrderStatus.RETURNED:
      case DeliveryOrderStatus.PARTIALLY_RETURNED:
        return deliveryOrder.signedAt != null ? 'DELIVERED' : 'FAILED';
      default:
        return 'PENDING';
    }
  }

  // A superseded stop (its DO was rescheduled onto another route) always
  // reads as FAILED here, whatever the DO's current status — that attempt
  // did fail; the new attempt lives on the new stop.
  stopStatus(stop: {
    supersededAt: Date | null;
    deliveryOrder: { status: DeliveryOrderStatus; signedAt: Date | null };
  }): StopStatus {
    return stop.supersededAt ? 'FAILED' : this.deriveStopStatus(stop.deliveryOrder);
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
    const status = this.stopStatus(stop);
    return {
      id: stop.id,
      sequence: stop.sequence,
      plannedEta: stop.plannedEta,
      status,
      // Failed attempt whose DO was rescheduled elsewhere — history only.
      superseded: stop.supersededAt != null,
      atRisk: this.isAtRisk(
        status,
        stop.plannedEta,
        stop.deliveryOrder.deliveryWindowEnd,
      ),
      deliveryOrder: stop.deliveryOrder,
    };
  }

  dayRange(date: string): { gte: Date; lt: Date } {
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
        displayName: true,
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
  //
  // Events that change the stop list/order also bump Route.version and
  // snapshot the resulting stop order, so the history reads as numbered
  // route versions (v1, v2, …) with the exact sequence at each.
  async recordHistory(
    routeId: string,
    type: RouteHistoryEventType,
    createdByUserId: string | undefined,
    metadata?: Record<string, unknown>,
  ) {
    try {
      let versionData: Record<string, unknown> = {};
      if (VERSIONED_EVENTS.has(type)) {
        const route =
          type === RouteHistoryEventType.CREATED
            ? await this.prisma.route.findUniqueOrThrow({
                where: { id: routeId },
                select: { version: true },
              })
            : await this.prisma.route.update({
                where: { id: routeId },
                data: { version: { increment: 1 } },
                select: { version: true },
              });
        const stops = await this.prisma.routeStop.findMany({
          where: { routeId },
          select: {
            sequence: true,
            supersededAt: true,
            deliveryOrder: {
              select: { id: true, doNumber: true, customerName: true },
            },
          },
          orderBy: { sequence: 'asc' },
        });
        versionData = {
          version: route.version,
          stops: stops.map((s) => ({
            sequence: s.sequence,
            deliveryOrderId: s.deliveryOrder.id,
            label: s.deliveryOrder.customerName ?? s.deliveryOrder.doNumber,
            superseded: s.supersededAt != null,
          })),
        };
      }
      await this.prisma.routeHistoryEvent.create({
        data: {
          routeId,
          type,
          createdByUserId,
          metadata: { ...metadata, ...versionData } as Prisma.InputJsonValue,
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
      include: {
        createdBy: { select: { id: true, email: true, displayName: true } },
      },
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
        driver: { select: { id: true, email: true, displayName: true } },
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
        driver: { select: { id: true, email: true, displayName: true } },
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

  // Re-sequences and re-ETAs only the still-PENDING stops — resolved
  // (delivered/failed) stops keep their existing sequence untouched (spec:
  // "only remaining deliveries should be re-optimized"). VROOM picks the
  // order against the driver's working hours, each delivery's window and
  // priority (see RouteOptimizerService); caches each stop's travel leg so
  // later ETA recalculation (recalculateEtasAfterResolution) is pure
  // arithmetic.
  //
  // HIGH priority means "never left out while it fits", not "visited
  // first" — a delivery window is what pins timing. A stop that can't fit
  // (window already missed, driver's hours full) stays on the route,
  // appended after the optimized ones, and is returned in `unscheduled`
  // so the dispatcher can see it.
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
      (s) => this.stopStatus(s) === 'PENDING',
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
      return { ...(await this.getRoute(organizationId, routeId)), unscheduled: [] };
    }

    const requestedDeparture = dto.departureAt
      ? new Date(dto.departureAt)
      : (route.plannedDepartureAt ?? new Date());
    const availability = (
      await this.optimizer.driverAvailability(
        organizationId,
        [route.driverId],
        route.routeDate.toISOString().slice(0, 10),
        requestedDeparture,
      )
    ).get(route.driverId)!;
    // A driver with no hours on this day was still put on this route by a
    // dispatcher — that's an override, so don't drop every stop over it.
    const vehicle = {
      key: route.driverId,
      availableFrom: availability.availableFrom,
      availableUntil: availability.offDuty ? null : availability.availableUntil,
    };

    const { routes, unassigned } = await this.optimizer.optimize({
      depot: {
        lat: Number(route.startLatitude),
        lng: Number(route.startLongitude),
      },
      vehicles: [vehicle],
      jobs: pendingStops.map((s) => ({
        key: s.id,
        location: {
          lat: Number(s.deliveryOrder.destinationLatitude),
          lng: Number(s.deliveryOrder.destinationLongitude),
        },
        priority: s.deliveryOrder.priority,
        windowStart: s.deliveryOrder.deliveryWindowStart,
        windowEnd: s.deliveryOrder.deliveryWindowEnd,
      })),
      keepUnassigned: true,
    });
    const ordered = routes.get(route.driverId)!;

    const highestResolvedSequence = route.stops
      .filter((s) => this.stopStatus(s) !== 'PENDING')
      .reduce((max, s) => Math.max(max, s.sequence), 0);

    // Two-phase sequence update, same reasoning as reorderStops(): avoids
    // transiently colliding with @@unique([routeId, sequence]).
    const negativeUpdates = pendingStops.map((s, i) =>
      this.prisma.routeStop.update({
        where: { id: s.id },
        data: { sequence: -(i + 1) },
      }),
    );
    const finalUpdates = ordered.map((stop, visitPosition) =>
      this.prisma.routeStop.update({
        where: { id: stop.key },
        data: {
          sequence: highestResolvedSequence + visitPosition + 1,
          travelMetersFromPrevious: stop.leg?.distanceMeters ?? null,
          travelSecondsFromPrevious:
            stop.leg != null ? Math.round(stop.leg.durationSeconds) : null,
          plannedEta: stop.eta,
          // New ETA — a later slip deserves a fresh alert.
          atRiskNotifiedAt: null,
        },
      }),
    );

    await this.prisma.$transaction([
      ...negativeUpdates,
      ...finalUpdates,
      this.prisma.route.update({
        where: { id: routeId },
        data: { plannedDepartureAt: vehicle.availableFrom },
      }),
    ]);
    await this.recordHistory(routeId, RouteHistoryEventType.OPTIMIZED, userId, {
      stopCount: pendingStops.length,
      highPriorityCount: pendingStops.filter(
        (s) => s.deliveryOrder.priority === DeliveryPriority.HIGH,
      ).length,
      unscheduledCount: unassigned.length,
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

    const stopById = new Map(pendingStops.map((s) => [s.id, s]));
    const unscheduled: {
      stopId: string;
      deliveryOrderId: string;
      label: string;
      reason: UnscheduledReason;
    }[] = unassigned.map((u) => {
      const s = stopById.get(u.key)!;
      return {
        stopId: s.id,
        deliveryOrderId: s.deliveryOrder.id,
        label:
          s.deliveryOrder.customerName ??
          s.deliveryOrder.doNumber ??
          s.deliveryOrder.id,
        reason: u.reason,
      };
    });
    return { ...(await this.getRoute(organizationId, routeId)), unscheduled };
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
      where: { activeDeliveryOrderId: deliveryOrderId },
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
      if (this.stopStatus(stop) !== 'PENDING') continue;
      if (stop.travelSecondsFromPrevious == null) break; // never optimized — nothing to walk forward from
      cumulativeMs += stop.travelSecondsFromPrevious * 1000;
      await this.prisma.routeStop.update({
        where: { id: stop.id },
        data: { plannedEta: new Date(cumulativeMs), atRiskNotifiedAt: null },
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
        data: {
          routeId,
          deliveryOrderId: dto.deliveryOrderId,
          activeDeliveryOrderId: dto.deliveryOrderId,
          sequence,
        },
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
    if (this.stopStatus(stop) !== 'PENDING') {
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

  // Follow-up for a stop deleted from outside this service (e.g.
  // DeliveryOrderService.cancel() removing a cancelled DO from its route
  // inside its own transaction) — same history/notification side effects
  // as removeStop(), both best-effort.
  async afterStopDetached(
    organizationId: string,
    routeId: string,
    deliveryOrderId: string,
    userId: string | undefined,
    reason: string,
  ) {
    await this.recordHistory(
      routeId,
      RouteHistoryEventType.STOP_REMOVED,
      userId,
      { deliveryOrderId, reason },
    );
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { driverId: true, status: true },
    });
    if (route?.status === RouteStatus.ACTIVE) {
      await this.notifications.create(
        organizationId,
        route.driverId,
        'ROUTE_STOPS_CHANGED',
        'A stop was removed from your route',
        { link: '/driver', payload: { routeId } },
      );
    }
  }

  // Follow-up for DeliveryOrderService.rescheduleDelivery(): the failed
  // stop stays on this route as superseded history — record it (bumps the
  // route version) and tell the driver if they're mid-route.
  async afterStopRescheduled(
    organizationId: string,
    routeId: string,
    deliveryOrderId: string,
    userId: string | undefined,
    toRouteId?: string,
  ) {
    await this.recordHistory(
      routeId,
      RouteHistoryEventType.STOP_RESCHEDULED,
      userId,
      { deliveryOrderId, toRouteId: toRouteId ?? null },
    );
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { driverId: true, status: true },
    });
    if (route?.status === RouteStatus.ACTIVE) {
      await this.notifications.create(
        organizationId,
        route.driverId,
        'ROUTE_STOPS_CHANGED',
        'A failed stop on your route was rescheduled',
        { link: '/driver', payload: { routeId } },
      );
    }
  }

  // ─── At-risk alerts ─────────────────────────────────────────────────
  // isAtRisk() is derived at read time; this sweep turns a stop *becoming*
  // at risk into a DELIVERY_AT_RISK notification — once per stop
  // (atRiskNotifiedAt), reset whenever its ETA is recomputed. Dispatch
  // staff and the stop's driver are both told. Only today's/yesterday's
  // open routes are scanned, so the query stays small.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async notifyAtRiskStops() {
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const candidates = await this.prisma.routeStop.findMany({
      where: {
        atRiskNotifiedAt: null,
        supersededAt: null,
        plannedEta: { not: null },
        route: {
          status: { in: [RouteStatus.PLANNED, RouteStatus.ACTIVE] },
          routeDate: { gte: since },
        },
      },
      select: {
        ...stopSelect,
        route: {
          select: { id: true, organizationId: true, driverId: true },
        },
      },
      take: 500,
    });

    for (const stop of candidates) {
      const status = this.stopStatus(stop);
      if (
        !this.isAtRisk(status, stop.plannedEta, stop.deliveryOrder.deliveryWindowEnd)
      )
        continue;
      // Claim first so an overlapping run can't double-notify.
      const claim = await this.prisma.routeStop.updateMany({
        where: { id: stop.id, atRiskNotifiedAt: null },
        data: { atRiskNotifiedAt: new Date() },
      });
      if (claim.count === 0) continue;

      const who =
        stop.deliveryOrder.customerName ??
        stop.deliveryOrder.doNumber ??
        stop.deliveryOrder.id;
      const payload = {
        routeId: stop.route.id,
        deliveryOrderId: stop.deliveryOrder.id,
      };
      try {
        await this.notifications.notifyOrgStaff(
          stop.route.organizationId,
          'DELIVERY_AT_RISK',
          `Delivery at risk of being late: ${who}`,
          { link: `/delivery/routes/${stop.route.id}`, payload },
        );
        await this.notifications.create(
          stop.route.organizationId,
          stop.route.driverId,
          'DELIVERY_AT_RISK',
          `You may be late for ${who}`,
          { link: '/driver', payload },
        );
      } catch {
        // best-effort, like every other notification side effect here
      }
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
      const status = this.stopStatus(stop);
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
        driver: { select: { id: true, email: true, displayName: true } },
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
        const status = this.stopStatus(stop);
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
        const status = this.stopStatus(stop);
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
