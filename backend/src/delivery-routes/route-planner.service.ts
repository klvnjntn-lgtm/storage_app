// src/delivery-routes/route-planner.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryOrderStatus,
  Prisma,
  RouteHistoryEventType,
  RouteStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runSerializable } from '../prisma/serializable';
import { NotificationsService } from '../notifications/notifications.service';
import { DeliveryRoutesService } from './delivery-routes.service';
import {
  RouteOptimizerService,
  type DriverAvailability,
  type OptimizerJob,
  type UnscheduledReason,
} from './route-optimizer.service';
import { ApplyRoutePlanDto, PlanRoutesDto } from './dto/plan-routes.dto';

const planDeliveryOrderSelect = {
  id: true,
  doNumber: true,
  status: true,
  signedAt: true,
  customerName: true,
  deliveryAddress: true,
  destinationLatitude: true,
  destinationLongitude: true,
  priority: true,
  deliveryWindowStart: true,
  deliveryWindowEnd: true,
  createdAt: true,
  routeStop: { select: { id: true, routeId: true } },
} satisfies Prisma.DeliveryOrderSelect;

type PlanDeliveryOrder = Prisma.DeliveryOrderGetPayload<{
  select: typeof planDeliveryOrderSelect;
}>;

type RouteSummary = {
  id: string;
  driverId: string;
  status: RouteStatus;
  version: number;
  createdAt: Date;
  // Started (not PLANNED, or a stop already delivered/failed) — never
  // touched by the planner.
  locked: boolean;
  deliveryOrderIds: string[];
};

// Everything preview and save both need to agree on.
type PlanContext = {
  drivers: { id: string; email: string; displayName: string | null }[];
  deliveryOrders: PlanDeliveryOrder[];
  availability: Map<string, DriverAvailability>;
  // Unlocked PLANNED routes on the date that the plan rebuilds or takes
  // stops from, with their versions for the stale-preview check.
  affectedRoutes: RouteSummary[];
  // DOs currently on a selected driver's route but left out of the plan —
  // saving takes them off (back to unrouted).
  removedDeliveryOrderIds: string[];
  // Per driver: the existing route the plan reuses, if any.
  targetRouteIdByDriver: Map<string, string | null>;
};

const label = (d: { customerName: string | null; doNumber: string | null; id: string }) =>
  d.customerName ?? d.doNumber ?? d.id;

// "Optimize all drivers": VROOM splits a day's deliveries across drivers.
// Preview first, save second — nothing moves until the dispatcher has seen
// the result. Only routes that haven't started are ever changed; started
// ones are locked.
@Injectable()
export class RoutePlannerService {
  constructor(
    private prisma: PrismaService,
    private routes: DeliveryRoutesService,
    private optimizer: RouteOptimizerService,
    private notifications: NotificationsService,
  ) {}

  private async routesOnDate(
    organizationId: string,
    routeDate: string,
  ): Promise<RouteSummary[]> {
    const rows = await this.prisma.route.findMany({
      where: {
        organizationId,
        routeDate: this.routes.dayRange(routeDate),
        status: { not: RouteStatus.CANCELLED },
      },
      select: {
        id: true,
        driverId: true,
        status: true,
        version: true,
        createdAt: true,
        stops: {
          select: {
            activeDeliveryOrderId: true,
            supersededAt: true,
            deliveryOrder: { select: { status: true, signedAt: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      driverId: r.driverId,
      status: r.status,
      version: r.version,
      createdAt: r.createdAt,
      locked:
        r.status !== RouteStatus.PLANNED ||
        r.stops.some((s) => this.routes.stopStatus(s) !== 'PENDING'),
      deliveryOrderIds: r.stops
        .map((s) => s.activeDeliveryOrderId)
        .filter((id): id is string => id != null),
    }));
  }

  // Deliveries still to be sent: packed, or shipped but not yet signed for.
  private openDeliveryWhere(organizationId: string): Prisma.DeliveryOrderWhereInput {
    return {
      organizationId,
      signedAt: null,
      status: { in: [DeliveryOrderStatus.PACKED, DeliveryOrderStatus.SHIPPED] },
    };
  }

  // What the planner page offers: drivers (with their hours and existing
  // routes that day) and deliveries that can be planned — not on any route
  // yet, or on a not-yet-started route that day.
  async candidates(organizationId: string, routeDate: string) {
    this.routes.dayRange(routeDate); // validates the date
    const [drivers, dayRoutes, lastStart] = await Promise.all([
      this.routes.listDrivers(organizationId),
      this.routesOnDate(organizationId, routeDate),
      this.prisma.route.findFirst({
        where: { organizationId, startLatitude: { not: null } },
        select: { startLatitude: true, startLongitude: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const unlockedRouteIds = dayRoutes.filter((r) => !r.locked).map((r) => r.id);
    const availability = await this.optimizer.driverAvailability(
      organizationId,
      drivers.map((d) => d.id),
      routeDate,
    );

    const deliveryOrders = await this.prisma.deliveryOrder.findMany({
      where: {
        ...this.openDeliveryWhere(organizationId),
        OR: [
          { routeStop: null },
          { routeStop: { routeId: { in: unlockedRouteIds } } },
        ],
      },
      select: planDeliveryOrderSelect,
      orderBy: [{ deliveryWindowStart: 'asc' }, { createdAt: 'asc' }],
    });
    const routeById = new Map(dayRoutes.map((r) => [r.id, r]));

    return {
      routeDate,
      defaultDepot: lastStart
        ? {
            latitude: Number(lastStart.startLatitude),
            longitude: Number(lastStart.startLongitude),
          }
        : null,
      drivers: drivers.map((d) => {
        const a = availability.get(d.id)!;
        const mine = dayRoutes.filter((r) => r.driverId === d.id);
        return {
          ...d,
          hours: a.hoursLabel,
          restricted: a.restricted,
          offDuty: a.offDuty,
          routes: mine.map((r) => ({
            id: r.id,
            status: r.status,
            locked: r.locked,
            stopCount: r.deliveryOrderIds.length,
          })),
        };
      }),
      deliveryOrders: deliveryOrders.map((o) => {
        const route = o.routeStop ? routeById.get(o.routeStop.routeId) : undefined;
        return {
          id: o.id,
          doNumber: o.doNumber,
          customerName: o.customerName,
          deliveryAddress: o.deliveryAddress,
          priority: o.priority,
          deliveryWindowStart: o.deliveryWindowStart,
          deliveryWindowEnd: o.deliveryWindowEnd,
          hasPin: o.destinationLatitude != null && o.destinationLongitude != null,
          currentRoute: route ? { id: route.id, driverId: route.driverId } : null,
        };
      }),
    };
  }

  private async loadContext(
    organizationId: string,
    dto: PlanRoutesDto,
  ): Promise<PlanContext> {
    this.routes.dayRange(dto.routeDate);

    const drivers = await this.prisma.user.findMany({
      where: {
        id: { in: dto.driverIds },
        organizationId,
        role: 'DRIVER',
        active: true,
      },
      select: { id: true, email: true, displayName: true },
    });
    if (drivers.length !== dto.driverIds.length) {
      throw new NotFoundException(
        'One or more drivers not found (must be active users with the DRIVER role)',
      );
    }

    const dayRoutes = await this.routesOnDate(organizationId, dto.routeDate);
    const routeById = new Map(dayRoutes.map((r) => [r.id, r]));

    const deliveryOrders = await this.prisma.deliveryOrder.findMany({
      where: { id: { in: dto.deliveryOrderIds }, organizationId },
      select: planDeliveryOrderSelect,
    });
    if (deliveryOrders.length !== dto.deliveryOrderIds.length) {
      throw new NotFoundException('One or more delivery orders not found');
    }
    const notPlannable = deliveryOrders.filter((o) => {
      const open =
        o.signedAt == null &&
        (o.status === DeliveryOrderStatus.PACKED ||
          o.status === DeliveryOrderStatus.SHIPPED);
      if (!open) return true;
      if (!o.routeStop) return false;
      const route = routeById.get(o.routeStop.routeId);
      return !route || route.locked;
    });
    if (notPlannable.length > 0) {
      throw new BadRequestException(
        `These deliveries can't be planned (already delivered, or on a route that has started or is on another date): ${notPlannable.map(label).join(', ')}`,
      );
    }

    const selectedDrivers = new Set(dto.driverIds);
    const selectedOrders = new Set(dto.deliveryOrderIds);
    const affectedRoutes = dayRoutes.filter(
      (r) =>
        !r.locked &&
        (selectedDrivers.has(r.driverId) ||
          r.deliveryOrderIds.some((id) => selectedOrders.has(id))),
    );
    const removedDeliveryOrderIds = affectedRoutes
      .filter((r) => selectedDrivers.has(r.driverId))
      .flatMap((r) => r.deliveryOrderIds)
      .filter((id) => !selectedOrders.has(id));

    const targetRouteIdByDriver = new Map<string, string | null>();
    for (const driverId of dto.driverIds) {
      targetRouteIdByDriver.set(
        driverId,
        affectedRoutes.find((r) => r.driverId === driverId)?.id ?? null,
      );
    }

    const availability = await this.optimizer.driverAvailability(
      organizationId,
      dto.driverIds,
      dto.routeDate,
      dto.departureAt ? new Date(dto.departureAt) : undefined,
    );

    return {
      drivers,
      deliveryOrders,
      availability,
      affectedRoutes,
      removedDeliveryOrderIds,
      targetRouteIdByDriver,
    };
  }

  private toJob(o: PlanDeliveryOrder): OptimizerJob {
    return {
      key: o.id,
      location:
        o.destinationLatitude != null && o.destinationLongitude != null
          ? { lat: Number(o.destinationLatitude), lng: Number(o.destinationLongitude) }
          : null,
      priority: o.priority,
      windowStart: o.deliveryWindowStart,
      windowEnd: o.deliveryWindowEnd,
    };
  }

  // What happens to each affected route that isn't being rebuilt as some
  // driver's plan: it loses the stops the plan takes, and is cancelled if
  // that leaves it empty.
  private leftoverRoutes(
    ctx: PlanContext,
    plannedDriverIds: Set<string>,
    takenOff: Set<string>,
  ) {
    const rebuilt = (r: RouteSummary) =>
      plannedDriverIds.has(r.driverId) &&
      ctx.targetRouteIdByDriver.get(r.driverId) === r.id;
    const leftovers = ctx.affectedRoutes.filter((r) => !rebuilt(r));
    const emptied = leftovers.filter((r) =>
      r.deliveryOrderIds.every((id) => takenOff.has(id)),
    );
    return {
      cancelledRouteIds: emptied.map((r) => r.id),
      shrunkRouteIds: leftovers
        .filter((r) => !emptied.includes(r))
        .map((r) => r.id),
    };
  }

  async preview(organizationId: string, dto: PlanRoutesDto) {
    const ctx = await this.loadContext(organizationId, dto);

    // Drivers with hours configured but none on this day aren't planned.
    const onDuty = dto.driverIds.filter((id) => !ctx.availability.get(id)!.offDuty);
    const { routes, unassigned } = onDuty.length
      ? await this.optimizer.optimize({
          depot: { lat: dto.depot.latitude, lng: dto.depot.longitude },
          vehicles: onDuty.map((id) => ({
            key: id,
            availableFrom: ctx.availability.get(id)!.availableFrom,
            availableUntil: ctx.availability.get(id)!.availableUntil,
          })),
          jobs: ctx.deliveryOrders.map((o) => this.toJob(o)),
        })
      : {
          routes: new Map(),
          unassigned: ctx.deliveryOrders.map((o) => ({
            key: o.id,
            reason: (o.destinationLatitude == null ? 'NO_PIN' : 'NO_TIME') as UnscheduledReason,
          })),
        };

    const orderById = new Map(ctx.deliveryOrders.map((o) => [o.id, o]));
    const plannedDriverIds = new Set(
      [...routes.entries()].filter(([, stops]) => stops.length > 0).map(([id]) => id),
    );
    const currentRouteOf = (o: PlanDeliveryOrder) => o.routeStop?.routeId ?? null;

    return {
      routeDate: dto.routeDate,
      depot: dto.depot,
      routes: ctx.drivers.map((driver) => {
        const a = ctx.availability.get(driver.id)!;
        const stops = routes.get(driver.id) ?? [];
        const last = stops[stops.length - 1];
        return {
          driver,
          hours: a.hoursLabel,
          offDuty: a.offDuty,
          departureAt: a.availableFrom,
          existingRouteId: ctx.targetRouteIdByDriver.get(driver.id) ?? null,
          totalMeters: stops.reduce((sum, s) => sum + (s.leg?.distanceMeters ?? 0), 0),
          totalSeconds: stops.reduce((sum, s) => sum + (s.leg?.durationSeconds ?? 0), 0),
          finishEta: last?.eta ?? null,
          stops: stops.map((s, i) => {
            const o = orderById.get(s.key)!;
            return {
              sequence: i + 1,
              deliveryOrderId: o.id,
              doNumber: o.doNumber,
              customerName: o.customerName,
              deliveryAddress: o.deliveryAddress,
              priority: o.priority,
              deliveryWindowStart: o.deliveryWindowStart,
              deliveryWindowEnd: o.deliveryWindowEnd,
              latitude: Number(o.destinationLatitude),
              longitude: Number(o.destinationLongitude),
              eta: s.eta,
              travelSeconds: s.leg?.durationSeconds ?? null,
              travelMeters: s.leg?.distanceMeters ?? null,
              movedFromRouteId:
                currentRouteOf(o) && currentRouteOf(o) !== ctx.targetRouteIdByDriver.get(driver.id)
                  ? currentRouteOf(o)
                  : null,
            };
          }),
        };
      }),
      unassigned: unassigned.map((u) => {
        const o = orderById.get(u.key)!;
        return {
          deliveryOrderId: o.id,
          label: label(o),
          priority: o.priority,
          reason: u.reason,
          currentRouteId: currentRouteOf(o),
        };
      }),
      removedDeliveryOrderIds: ctx.removedDeliveryOrderIds,
      cancelledRouteIds: this.leftoverRoutes(
        ctx,
        plannedDriverIds,
        new Set([...dto.deliveryOrderIds, ...ctx.removedDeliveryOrderIds]),
      ).cancelledRouteIds,
      expectedVersions: Object.fromEntries(
        ctx.affectedRoutes.map((r) => [r.id, r.version]),
      ),
    };
  }

  async apply(organizationId: string, userId: string, dto: ApplyRoutePlanDto) {
    const ctx = await this.loadContext(organizationId, dto);

    const expected = dto.expectedVersions ?? {};
    const stale =
      Object.keys(expected).length !== ctx.affectedRoutes.length ||
      ctx.affectedRoutes.some((r) => expected[r.id] !== r.version);
    if (stale) {
      throw new ConflictException(
        'Routes for this day changed since the preview — preview again before saving',
      );
    }

    const orderById = new Map(ctx.deliveryOrders.map((o) => [o.id, o]));
    const seen = new Set<string>();
    for (const r of dto.routes) {
      if (!ctx.targetRouteIdByDriver.has(r.driverId)) {
        throw new BadRequestException('Plan contains a driver that was not selected');
      }
      for (const id of r.deliveryOrderIds) {
        const o = orderById.get(id);
        if (!o || seen.has(id)) {
          throw new BadRequestException('Plan contains a delivery that was not selected, or one twice');
        }
        if (o.destinationLatitude == null || o.destinationLongitude == null) {
          throw new BadRequestException(`Delivery has no destination pin: ${label(o)}`);
        }
        seen.add(id);
      }
    }

    const depot = { lat: dto.depot.latitude, lng: dto.depot.longitude };
    const planned = await Promise.all(
      dto.routes
        .filter((r) => r.deliveryOrderIds.length > 0)
        .map(async (r) => {
          const departAt = ctx.availability.get(r.driverId)!.availableFrom;
          const jobs = r.deliveryOrderIds.map((id) => {
            const job = this.toJob(orderById.get(id)!);
            return { ...job, location: job.location! };
          });
          const stops = await this.optimizer.scheduleFixedOrder(depot, departAt, jobs);
          return { driverId: r.driverId, departAt, stops };
        }),
    );
    const plannedDriverIds = new Set(planned.map((p) => p.driverId));
    // Every selected delivery comes off its current route (even ones the
    // plan left unassigned), plus those dropped from a selected driver's.
    const takenOff = [...dto.deliveryOrderIds, ...ctx.removedDeliveryOrderIds];
    const { cancelledRouteIds, shrunkRouteIds } = this.leftoverRoutes(
      ctx,
      plannedDriverIds,
      new Set(takenOff),
    );
    const affectedIds = ctx.affectedRoutes.map((r) => r.id);

    const result = await runSerializable(this.prisma, async (tx) => {
      // Stale check again inside the transaction — the one that counts.
      const current = await tx.route.findMany({
        where: { id: { in: affectedIds } },
        select: { id: true, version: true, status: true },
      });
      if (
        current.length !== affectedIds.length ||
        current.some((r) => r.version !== expected[r.id] || r.status !== RouteStatus.PLANNED)
      ) {
        throw new ConflictException(
          'Routes for this day changed since the preview — preview again before saving',
        );
      }

      // Pending stops only: every affected route is unlocked.
      await tx.routeStop.deleteMany({
        where: { routeId: { in: affectedIds }, activeDeliveryOrderId: { in: takenOff } },
      });

      const saved: { routeId: string; driverId: string; created: boolean }[] = [];
      for (const p of planned) {
        let routeId = ctx.targetRouteIdByDriver.get(p.driverId) ?? null;
        const created = routeId == null;
        if (routeId == null) {
          routeId = (
            await tx.route.create({
              data: {
                organizationId,
                driverId: p.driverId,
                routeDate: new Date(`${dto.routeDate}T00:00:00.000Z`),
                createdByUserId: userId,
              },
              select: { id: true },
            })
          ).id;
        }
        await tx.route.update({
          where: { id: routeId },
          data: {
            startLatitude: dto.depot.latitude,
            startLongitude: dto.depot.longitude,
            plannedDepartureAt: p.departAt,
          },
        });
        await tx.routeStop.createMany({
          data: p.stops.map((s, i) => ({
            routeId: routeId!,
            deliveryOrderId: s.key,
            activeDeliveryOrderId: s.key,
            sequence: i + 1,
            plannedEta: s.eta,
            travelMetersFromPrevious: s.leg?.distanceMeters ?? null,
            travelSecondsFromPrevious:
              s.leg != null ? Math.round(s.leg.durationSeconds) : null,
          })),
        });
        saved.push({ routeId, driverId: p.driverId, created });
      }

      // Close the gaps left in routes that kept some stops (two-phase, same
      // @@unique([routeId, sequence]) reasoning as reorderStops()).
      for (const routeId of shrunkRouteIds) {
        const left = await tx.routeStop.findMany({
          where: { routeId },
          select: { id: true },
          orderBy: { sequence: 'asc' },
        });
        for (const [i, stop] of left.entries()) {
          await tx.routeStop.update({ where: { id: stop.id }, data: { sequence: -(i + 1) } });
        }
        for (const [i, stop] of left.entries()) {
          await tx.routeStop.update({ where: { id: stop.id }, data: { sequence: i + 1 } });
        }
      }

      if (cancelledRouteIds.length > 0) {
        await tx.route.updateMany({
          where: { id: { in: cancelledRouteIds } },
          data: { status: RouteStatus.CANCELLED },
        });
      }
      return saved;
    });

    // History + notifications after commit, best-effort like elsewhere.
    const savedIds = new Set(result.map((r) => r.routeId));
    for (const r of result) {
      if (r.created) {
        await this.routes.recordHistory(r.routeId, RouteHistoryEventType.CREATED, userId, {
          plan: true,
        });
      } else {
        await this.routes.recordHistory(r.routeId, RouteHistoryEventType.OPTIMIZED, userId, {
          plan: true,
        });
      }
      await this.notifications.create(
        organizationId,
        r.driverId,
        r.created ? 'DELIVERY_ASSIGNED' : 'ROUTE_REOPTIMIZED',
        r.created ? 'A new route was assigned to you' : 'Your route was re-optimized',
        { link: '/driver', payload: { routeId: r.routeId } },
      );
    }
    for (const r of ctx.affectedRoutes) {
      if (savedIds.has(r.id)) continue;
      const cancelled = cancelledRouteIds.includes(r.id);
      await this.routes.recordHistory(
        r.id,
        cancelled ? RouteHistoryEventType.STATUS_CHANGED : RouteHistoryEventType.STOP_REMOVED,
        userId,
        cancelled ? { plan: true, to: RouteStatus.CANCELLED } : { plan: true },
      );
    }

    return {
      routes: result.map((r) => ({ routeId: r.routeId, driverId: r.driverId, created: r.created })),
      cancelledRouteIds,
    };
  }
}
