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
  teamId: string;
  status: RouteStatus;
  version: number;
  createdAt: Date;
  // Started (not PLANNED, or a stop already delivered/failed) — never
  // touched by the planner.
  locked: boolean;
  deliveryOrderIds: string[];
  // Customer stops (no DO) — the planner never moves them, but keeps them
  // on the route after its planned stops.
  customerStopCount: number;
};

type PlanTeam = {
  id: string;
  name: string;
  driver: { id: string; email: string; displayName: string | null } | null;
};

// Everything preview and save both need to agree on.
type PlanContext = {
  teams: PlanTeam[];
  deliveryOrders: PlanDeliveryOrder[];
  availability: Map<string, DriverAvailability>;
  // Unlocked PLANNED routes on the date that the plan rebuilds or takes
  // stops from, with their versions for the stale-preview check.
  affectedRoutes: RouteSummary[];
  // DOs currently on a selected team's route but left out of the plan —
  // saving takes them off (back to unrouted).
  removedDeliveryOrderIds: string[];
  // Per team: its existing route that day, which the plan reuses (one
  // route per team per day).
  targetRouteIdByTeam: Map<string, string | null>;
};

const label = (d: { customerName: string | null; doNumber: string | null; id: string }) =>
  d.customerName ?? d.doNumber ?? d.id;

// "Optimize all teams": VROOM splits a day's deliveries across teams (one
// team = one driver = one vehicle = one route per day).
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
        teamId: true,
        status: true,
        version: true,
        createdAt: true,
        stops: {
          select: {
            activeDeliveryOrderId: true,
            deliveryOrderId: true,
            supersededAt: true,
            signedAt: true,
            failedAt: true,
            deliveryOrder: { select: { status: true, signedAt: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      teamId: r.teamId,
      status: r.status,
      version: r.version,
      createdAt: r.createdAt,
      locked:
        r.status !== RouteStatus.PLANNED ||
        r.stops.some((s) => this.routes.stopStatus(s) !== 'PENDING'),
      deliveryOrderIds: r.stops
        .map((s) => s.activeDeliveryOrderId)
        .filter((id): id is string => id != null),
      customerStopCount: r.stops.filter((s) => s.deliveryOrderId == null).length,
    }));
  }

  private async loadTeams(organizationId: string, teamIds?: string[]): Promise<PlanTeam[]> {
    const teams = await this.prisma.team.findMany({
      where: { organizationId, ...(teamIds ? { id: { in: teamIds } } : {}) },
      select: {
        id: true,
        name: true,
        members: {
          where: { role: 'DRIVER', active: true, removedAt: null },
          select: { id: true, email: true, displayName: true },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
    return teams.map((t) => ({ id: t.id, name: t.name, driver: t.members[0] ?? null }));
  }

  // Deliveries still to be sent: packed, or shipped but not yet signed for.
  private openDeliveryWhere(organizationId: string): Prisma.DeliveryOrderWhereInput {
    return {
      organizationId,
      signedAt: null,
      status: { in: [DeliveryOrderStatus.PACKED, DeliveryOrderStatus.SHIPPED] },
    };
  }

  // What the planner page offers: teams (with their driver's hours and
  // their route that day) and deliveries that can be planned — not on any
  // route yet, or on a not-yet-started route that day.
  async candidates(organizationId: string, routeDate: string) {
    this.routes.dayRange(routeDate); // validates the date
    const [teams, dayRoutes, lastStart] = await Promise.all([
      this.loadTeams(organizationId),
      this.routesOnDate(organizationId, routeDate),
      this.prisma.route.findFirst({
        where: { organizationId, startLatitude: { not: null } },
        select: { startLatitude: true, startLongitude: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const unlockedRouteIds = dayRoutes.filter((r) => !r.locked).map((r) => r.id);
    const availability = await this.routes.teamAvailability(
      organizationId,
      teams.map((t) => t.id),
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
      teams: teams.map((t) => {
        const a = availability.get(t.id)!;
        const mine = dayRoutes.filter((r) => r.teamId === t.id);
        return {
          ...t,
          hours: a.hoursLabel,
          restricted: a.restricted,
          offDuty: a.offDuty,
          routes: mine.map((r) => ({
            id: r.id,
            status: r.status,
            locked: r.locked,
            stopCount: r.deliveryOrderIds.length + r.customerStopCount,
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
          currentRoute: route ? { id: route.id, teamId: route.teamId } : null,
        };
      }),
    };
  }

  private async loadContext(
    organizationId: string,
    dto: PlanRoutesDto,
  ): Promise<PlanContext> {
    this.routes.dayRange(dto.routeDate);

    const teams = await this.loadTeams(organizationId, dto.teamIds);
    if (teams.length !== dto.teamIds.length) {
      throw new NotFoundException('One or more teams not found');
    }
    const noDriver = teams.filter((t) => !t.driver);
    if (noDriver.length > 0) {
      throw new BadRequestException(
        `These teams have no driver: ${noDriver.map((t) => t.name).join(', ')}`,
      );
    }

    const dayRoutes = await this.routesOnDate(organizationId, dto.routeDate);
    const routeById = new Map(dayRoutes.map((r) => [r.id, r]));
    // One route per team per day: a team whose route already started can't
    // get a second one.
    const started = teams.filter((t) =>
      dayRoutes.some((r) => r.teamId === t.id && r.locked),
    );
    if (started.length > 0) {
      throw new BadRequestException(
        `These teams' routes for the day have already started: ${started.map((t) => t.name).join(', ')}`,
      );
    }

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

    const selectedTeams = new Set(dto.teamIds);
    const selectedOrders = new Set(dto.deliveryOrderIds);
    const affectedRoutes = dayRoutes.filter(
      (r) =>
        !r.locked &&
        (selectedTeams.has(r.teamId) ||
          r.deliveryOrderIds.some((id) => selectedOrders.has(id))),
    );
    const removedDeliveryOrderIds = affectedRoutes
      .filter((r) => selectedTeams.has(r.teamId))
      .flatMap((r) => r.deliveryOrderIds)
      .filter((id) => !selectedOrders.has(id));

    const targetRouteIdByTeam = new Map<string, string | null>();
    for (const teamId of dto.teamIds) {
      targetRouteIdByTeam.set(
        teamId,
        affectedRoutes.find((r) => r.teamId === teamId)?.id ?? null,
      );
    }

    const availability = await this.routes.teamAvailability(
      organizationId,
      dto.teamIds,
      dto.routeDate,
      dto.departureAt ? new Date(dto.departureAt) : undefined,
    );

    return {
      teams,
      deliveryOrders,
      availability,
      affectedRoutes,
      removedDeliveryOrderIds,
      targetRouteIdByTeam,
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
  // team's plan: it loses the stops the plan takes, and is cancelled if
  // that leaves it empty (customer stops count — they stay).
  private leftoverRoutes(
    ctx: PlanContext,
    plannedTeamIds: Set<string>,
    takenOff: Set<string>,
  ) {
    const rebuilt = (r: RouteSummary) =>
      plannedTeamIds.has(r.teamId) &&
      ctx.targetRouteIdByTeam.get(r.teamId) === r.id;
    const leftovers = ctx.affectedRoutes.filter((r) => !rebuilt(r));
    const emptied = leftovers.filter(
      (r) =>
        r.customerStopCount === 0 &&
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

    // Teams whose driver has hours configured but none on this day aren't planned.
    const onDuty = dto.teamIds.filter((id) => !ctx.availability.get(id)!.offDuty);
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
    const plannedTeamIds = new Set(
      [...routes.entries()].filter(([, stops]) => stops.length > 0).map(([id]) => id),
    );
    const currentRouteOf = (o: PlanDeliveryOrder) => o.routeStop?.routeId ?? null;

    return {
      routeDate: dto.routeDate,
      depot: dto.depot,
      routes: ctx.teams.map((team) => {
        const a = ctx.availability.get(team.id)!;
        const stops = routes.get(team.id) ?? [];
        const last = stops[stops.length - 1];
        return {
          team,
          hours: a.hoursLabel,
          offDuty: a.offDuty,
          departureAt: a.availableFrom,
          existingRouteId: ctx.targetRouteIdByTeam.get(team.id) ?? null,
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
                currentRouteOf(o) && currentRouteOf(o) !== ctx.targetRouteIdByTeam.get(team.id)
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
        plannedTeamIds,
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
      if (!ctx.targetRouteIdByTeam.has(r.teamId)) {
        throw new BadRequestException('Plan contains a team that was not selected');
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
          const departAt = ctx.availability.get(r.teamId)!.availableFrom;
          const jobs = r.deliveryOrderIds.map((id) => {
            const job = this.toJob(orderById.get(id)!);
            return { ...job, location: job.location! };
          });
          const stops = await this.optimizer.scheduleFixedOrder(depot, departAt, jobs);
          return { teamId: r.teamId, departAt, stops };
        }),
    );
    const plannedTeamIds = new Set(planned.map((p) => p.teamId));
    // Every selected delivery comes off its current route (even ones the
    // plan left unassigned), plus those dropped from a selected team's.
    const takenOff = [...dto.deliveryOrderIds, ...ctx.removedDeliveryOrderIds];
    const { cancelledRouteIds, shrunkRouteIds } = this.leftoverRoutes(
      ctx,
      plannedTeamIds,
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

      const saved: { routeId: string; teamId: string; created: boolean }[] = [];
      for (const p of planned) {
        let routeId = ctx.targetRouteIdByTeam.get(p.teamId) ?? null;
        const created = routeId == null;
        if (routeId == null) {
          routeId = (
            await tx.route.create({
              data: {
                organizationId,
                teamId: p.teamId,
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
        // Customer stops left on a reused route go after the planned ones
        // (moved out of the way first — @@unique([routeId, sequence])).
        const kept = created
          ? []
          : await tx.routeStop.findMany({
              where: { routeId },
              select: { id: true },
              orderBy: { sequence: 'asc' },
            });
        for (const [i, stop] of kept.entries()) {
          await tx.routeStop.update({ where: { id: stop.id }, data: { sequence: -(i + 1) } });
        }
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
        for (const [i, stop] of kept.entries()) {
          await tx.routeStop.update({
            where: { id: stop.id },
            data: { sequence: p.stops.length + i + 1 },
          });
        }
        saved.push({ routeId, teamId: p.teamId, created });
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
      const driverId = ctx.teams.find((t) => t.id === r.teamId)?.driver?.id;
      if (driverId) {
        await this.notifications.create(
          organizationId,
          driverId,
          r.created ? 'DELIVERY_ASSIGNED' : 'ROUTE_REOPTIMIZED',
          r.created ? 'A new route was assigned to your team' : 'Your route was re-optimized',
          { link: '/driver', payload: { routeId: r.routeId } },
        );
      }
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
      routes: result.map((r) => ({ routeId: r.routeId, teamId: r.teamId, created: r.created })),
      cancelledRouteIds,
    };
  }
}
