// src/delivery-routes/delivery-routes.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryOrderStatus,
  DeliveryPriority,
  ModuleKey,
  NotificationType,
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
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { SignedFileUrlService } from '../storage/signed-file-url.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { AddRouteStopDto } from './dto/add-route-stop.dto';
import { ReorderRouteStopsDto } from './dto/reorder-route-stops.dto';
import { SetRouteStartDto } from './dto/set-route-start.dto';
import { OptimizeRouteDto } from './dto/optimize-route.dto';
import { backfillCustomerPin } from '../customers/customer-pin-backfill';
import {
  RescheduleCustomerStopDto,
  UpdateCustomerStopDetailsDto,
} from './dto/customer-stop-actions.dto';

export type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

type Requester = { sub: string; role: string };

// How far past its own ETA a still-PENDING stop has to be before it's
// flagged "late" — a grace window so an ETA that's off by a few minutes
// doesn't immediately read as a delay.
const LATE_AFTER_MINUTES = 20;

// LATE: already behind (past ETA + grace, or past the customer's window).
// AT_RISK: still on time, but the ETA lands after the customer's window.
export type Lateness = 'LATE' | 'AT_RISK' | null;

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

export const stopSelect = {
  id: true,
  sequence: true,
  plannedEta: true,
  supersededAt: true,
  travelSecondsFromPrevious: true,
  // Customer stop fields (null on DO stops) — see RouteStop's schema comment.
  customerId: true,
  customerName: true,
  address: true,
  destinationLatitude: true,
  destinationLongitude: true,
  priority: true,
  deliveryWindowStart: true,
  deliveryWindowEnd: true,
  receivedBy: true,
  signedAt: true,
  proofPhotoKey: true,
  completedLatitude: true,
  completedLongitude: true,
  completedAccuracy: true,
  failedAt: true,
  failureReason: true,
  failureLatitude: true,
  failureLongitude: true,
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
      completedAccuracy: true,
      failedAt: true,
      failureReason: true,
      failureLatitude: true,
      failureLongitude: true,
      destinationLatitude: true,
      destinationLongitude: true,
      priority: true,
      deliveryWindowStart: true,
      deliveryWindowEnd: true,
      receivedBy: true,
      proofPhotoKey: true,
      proofPhotoUrl: true,
    },
  },
} satisfies Prisma.RouteStopSelect;

type StopRow = Prisma.RouteStopGetPayload<{ select: typeof stopSelect }>;

// The team with its driver (one per team — TeamsService.assignDriver).
export const teamSelect = {
  id: true,
  name: true,
  members: {
    where: { role: 'DRIVER', active: true, removedAt: null },
    select: { id: true, email: true, displayName: true },
  },
} satisfies Prisma.TeamSelect;

type TeamRow = Prisma.TeamGetPayload<{ select: typeof teamSelect }>;

export const presentTeam = (team: TeamRow) => ({
  id: team.id,
  name: team.name,
  driver: team.members[0] ?? null,
});

// What a stop points at, whichever kind it is: a DO stop reads everything
// from its DeliveryOrder, a customer stop from its own columns.
type StopTarget = {
  customerId: string | null;
  customerName: string | null;
  doNumber: string | null;
  address: string | null;
  destinationLatitude: Prisma.Decimal | null;
  destinationLongitude: Prisma.Decimal | null;
  priority: DeliveryPriority;
  deliveryWindowStart: Date | null;
  deliveryWindowEnd: Date | null;
};

type TargetSource = Pick<
  StopTarget,
  | 'customerId'
  | 'customerName'
  | 'destinationLatitude'
  | 'destinationLongitude'
  | 'priority'
  | 'deliveryWindowStart'
  | 'deliveryWindowEnd'
> & {
  id: string;
  address: string | null;
  deliveryOrder: (Omit<StopTarget, 'address'> & {
    id: string;
    deliveryAddress: string | null;
  }) | null;
};

export function stopTarget(stop: TargetSource): StopTarget {
  const d = stop.deliveryOrder;
  if (d) {
    return {
      customerId: d.customerId,
      customerName: d.customerName,
      doNumber: d.doNumber,
      address: d.deliveryAddress,
      destinationLatitude: d.destinationLatitude,
      destinationLongitude: d.destinationLongitude,
      priority: d.priority,
      deliveryWindowStart: d.deliveryWindowStart,
      deliveryWindowEnd: d.deliveryWindowEnd,
    };
  }
  return {
    customerId: stop.customerId,
    customerName: stop.customerName,
    doNumber: null,
    address: stop.address,
    destinationLatitude: stop.destinationLatitude,
    destinationLongitude: stop.destinationLongitude,
    priority: stop.priority,
    deliveryWindowStart: stop.deliveryWindowStart,
    deliveryWindowEnd: stop.deliveryWindowEnd,
  };
}

const stopLabel = (stop: TargetSource) => {
  const t = stopTarget(stop);
  return t.customerName ?? t.doNumber ?? stop.deliveryOrder?.id ?? stop.id;
};

@Injectable()
export class DeliveryRoutesService {
  constructor(
    private prisma: PrismaService,
    private optimizer: RouteOptimizerService,
    private notifications: NotificationsService,
    private modules: OrganizationModulesService,
    private signer: SignedFileUrlService,
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
  //
  // A customer stop has no DO — its own failedAt/signedAt decide.
  stopStatus(stop: {
    supersededAt: Date | null;
    signedAt: Date | null;
    failedAt: Date | null;
    deliveryOrder: { status: DeliveryOrderStatus; signedAt: Date | null } | null;
  }): StopStatus {
    if (stop.supersededAt) return 'FAILED';
    if (stop.deliveryOrder) return this.deriveStopStatus(stop.deliveryOrder);
    if (stop.failedAt) return 'FAILED';
    return stop.signedAt ? 'DELIVERED' : 'PENDING';
  }

  // Never a physical-position check — purely time-based, recomputed at
  // read time. Matches the module's "status/event-based, not
  // live-tracking" rule.
  // - LATE: plannedEta blown past its grace window, or the customer's
  //   requested window has already closed
  // - AT_RISK: not late yet, but the ETA itself lands after the window end
  //   (even a "perfectly on schedule" ETA can already be a broken promise)
  private lateness(
    status: StopStatus,
    plannedEta: Date | null,
    deliveryWindowEnd: Date | null,
  ): Lateness {
    if (status !== 'PENDING') return null;
    const now = Date.now();
    if (deliveryWindowEnd && now > deliveryWindowEnd.getTime()) return 'LATE';
    if (plannedEta && now > plannedEta.getTime() + LATE_AFTER_MINUTES * 60 * 1000) return 'LATE';
    if (plannedEta && deliveryWindowEnd && plannedEta.getTime() > deliveryWindowEnd.getTime()) return 'AT_RISK';
    return null;
  }

  // One shape for both stop kinds, so screens read the top-level fields
  // and only look at `deliveryOrder` for DO-specific actions.
  private presentStop(stop: StopRow) {
    const status = this.stopStatus(stop);
    const target = stopTarget(stop);
    const d = stop.deliveryOrder;
    const { proofPhotoKey: _key, proofPhotoUrl: _url, ...deliveryOrder } =
      d ?? ({} as NonNullable<StopRow['deliveryOrder']>);
    return {
      id: stop.id,
      sequence: stop.sequence,
      plannedEta: stop.plannedEta,
      status,
      // Failed attempt whose DO was rescheduled elsewhere — history only.
      superseded: stop.supersededAt != null,
      ...(() => {
        const l = this.lateness(status, stop.plannedEta, target.deliveryWindowEnd);
        return { late: l === 'LATE', atRisk: l === 'AT_RISK' };
      })(),
      kind: d ? ('DELIVERY_ORDER' as const) : ('CUSTOMER' as const),
      label: stopLabel(stop),
      ...target,
      receivedBy: d ? d.receivedBy : stop.receivedBy,
      signedAt: d ? d.signedAt : stop.signedAt,
      hasProofPhoto: d
        ? d.proofPhotoKey != null || d.proofPhotoUrl != null
        : stop.proofPhotoKey != null,
      completedLatitude: d ? d.completedLatitude : stop.completedLatitude,
      completedLongitude: d ? d.completedLongitude : stop.completedLongitude,
      completedAccuracy: d ? d.completedAccuracy : stop.completedAccuracy,
      failedAt: d ? d.failedAt : stop.failedAt,
      failureReason: d ? d.failureReason : stop.failureReason,
      failureLatitude: d ? d.failureLatitude : stop.failureLatitude,
      failureLongitude: d ? d.failureLongitude : stop.failureLongitude,
      deliveryOrder: d ? deliveryOrder : null,
    };
  }

  // Driver directions + location photos for every customer on these
  // stops (DO stops via the DO's customer). Photos come as short-lived
  // signed links — they're private files.
  private async withCustomerInfo<T extends { customerId: string | null }>(
    organizationId: string,
    stops: T[],
  ) {
    const ids = [
      ...new Set(stops.map((s) => s.customerId).filter((id): id is string => !!id)),
    ];
    const customers = ids.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: ids }, organizationId },
          select: {
            id: true,
            phone: true,
            deliveryNotes: true,
            locationPhotos: {
              select: { id: true, storageKey: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        })
      : [];
    const byId = new Map(
      customers.map((c) => [
        c.id,
        {
          phone: c.phone,
          deliveryNotes: c.deliveryNotes,
          locationPhotos: c.locationPhotos.map((p) => ({
            id: p.id,
            ...this.signer.sign(p.storageKey),
          })),
        },
      ]),
    );
    return stops.map((s) => ({
      ...s,
      customerInfo: (s.customerId && byId.get(s.customerId)) || null,
    }));
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

  private async assertTeam(organizationId: string, teamId: string) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId },
      select: { id: true },
    });
    if (!team) throw new NotFoundException('Team not found');
  }

  // One team = one route per day — a second non-cancelled route for the
  // same team and date is refused.
  private async assertTeamFreeOnDate(
    organizationId: string,
    teamId: string,
    routeDate: Date,
    exceptRouteId?: string,
  ) {
    const existing = await this.prisma.route.findFirst({
      where: {
        organizationId,
        teamId,
        routeDate: this.dayRange(routeDate.toISOString().slice(0, 10)),
        status: { not: RouteStatus.CANCELLED },
        ...(exceptRouteId ? { id: { not: exceptRouteId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'This team already has a route on that date — add stops to it instead',
      );
    }
  }

  // Driver of each team (null when the team has none right now).
  async teamDrivers(organizationId: string, teamIds: string[]) {
    const drivers = await this.prisma.user.findMany({
      where: {
        organizationId,
        teamId: { in: teamIds },
        role: 'DRIVER',
        active: true,
        removedAt: null,
      },
      select: { id: true, teamId: true },
      orderBy: { createdAt: 'asc' },
    });
    const result = new Map<string, string | null>(teamIds.map((id) => [id, null]));
    for (const d of drivers) if (!result.get(d.teamId!)) result.set(d.teamId!, d.id);
    return result;
  }

  // A team's hours are its driver's hours. Keyed by team id; a team with
  // no driver gets unrestricted hours (nothing configured).
  async teamAvailability(
    organizationId: string,
    teamIds: string[],
    routeDate: string,
    departureAt?: Date,
  ) {
    const drivers = await this.teamDrivers(organizationId, teamIds);
    const keyOf = (teamId: string) => drivers.get(teamId) ?? teamId;
    const byKey = await this.optimizer.driverAvailability(
      organizationId,
      teamIds.map(keyOf),
      routeDate,
      departureAt,
    );
    return new Map(teamIds.map((id) => [id, byKey.get(keyOf(id))!]));
  }

  private async notifyTeam(
    organizationId: string,
    teamId: string,
    type: NotificationType,
    title: string,
    routeId: string,
  ) {
    const driverId = (await this.teamDrivers(organizationId, [teamId])).get(teamId);
    if (!driverId) return;
    await this.notifications.create(organizationId, driverId, type, title, {
      link: '/driver',
      payload: { routeId },
    });
  }

  // DRIVER: only routes of their own team. Staff: unrestricted.
  private routeScope(requester?: Requester): Prisma.RouteWhereInput {
    return requester?.role === 'DRIVER'
      ? { team: { members: { some: { id: requester.sub } } } }
      : {};
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

  // Stops that already happened can't be moved or edited.
  private assertRouteOpen(route: { status: RouteStatus }) {
    if (
      route.status === RouteStatus.COMPLETED ||
      route.status === RouteStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'This route is completed or cancelled — it can no longer be changed',
      );
    }
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
            customerId: true,
            customerName: true,
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
            deliveryOrderId: s.deliveryOrder?.id ?? null,
            customerId: s.customerId,
            label: s.deliveryOrder
              ? (s.deliveryOrder.customerName ?? s.deliveryOrder.doNumber)
              : s.customerName,
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
    await this.assertTeam(organizationId, dto.teamId);
    const routeDate = new Date(`${dto.routeDate}T00:00:00.000Z`);
    await this.assertTeamFreeOnDate(organizationId, dto.teamId, routeDate);
    const route = await this.prisma.route.create({
      data: {
        organizationId,
        teamId: dto.teamId,
        routeDate,
        name: dto.name,
        createdByUserId,
      },
    });
    await this.recordHistory(
      route.id,
      RouteHistoryEventType.CREATED,
      createdByUserId,
    );
    await this.notifyTeam(
      organizationId,
      dto.teamId,
      'DELIVERY_ASSIGNED',
      'A new route was assigned to your team',
      route.id,
    );
    return route;
  }

  // A DRIVER may only ever see their own team's routes — same "deny
  // unless it's yours" scoping as assertRequesterCanActOnDeliveryOrder in
  // delivery-order.service.ts, just applied to reads instead of writes.
  // ADMIN/USER are unrestricted.
  async listRoutes(
    organizationId: string,
    filters: { teamId?: string; date?: string; status?: RouteStatus },
    requester?: Requester,
  ) {
    const routes = await this.prisma.route.findMany({
      where: {
        organizationId,
        teamId: filters.teamId,
        status: filters.status,
        ...(filters.date ? { routeDate: this.dayRange(filters.date) } : {}),
        ...this.routeScope(requester),
      },
      include: {
        team: { select: teamSelect },
        _count: { select: { stops: true } },
      },
      orderBy: [{ routeDate: 'desc' }, { createdAt: 'desc' }],
    });
    return routes.map((r) => ({ ...r, team: presentTeam(r.team) }));
  }

  async getRoute(organizationId: string, id: string, requester?: Requester) {
    const route = await this.prisma.route.findFirst({
      where: { id, organizationId, ...this.routeScope(requester) },
      include: {
        team: { select: teamSelect },
        stops: { select: stopSelect, orderBy: { sequence: 'asc' } },
      },
    });
    // Same 404 (not 403) whether the route doesn't exist or belongs to
    // another team — doesn't confirm to a DRIVER that a given route id
    // is real, only that it isn't theirs.
    if (!route) throw new NotFoundException('Route not found');

    const stops = await this.withCustomerInfo(
      organizationId,
      route.stops.map((stop) => this.presentStop(stop)),
    );
    const currentStop = stops.find((stop) => stop.status === 'PENDING') ?? null;

    return { ...route, team: presentTeam(route.team), stops, currentStop };
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
    const teamChanged = dto.teamId != null && dto.teamId !== route.teamId;
    if (teamChanged) {
      await this.assertTeam(organizationId, dto.teamId!);
      await this.assertTeamFreeOnDate(
        organizationId,
        dto.teamId!,
        route.routeDate,
        id,
      );
    }

    const updated = await this.prisma.route.update({
      where: { id },
      data: { name: dto.name, status: dto.status, teamId: dto.teamId },
    });
    if (teamChanged) {
      // DRIVER_CHANGED keeps its name for existing history rows; from/to
      // are team ids now.
      await this.recordHistory(
        id,
        RouteHistoryEventType.DRIVER_CHANGED,
        userId,
        { fromTeamId: route.teamId, toTeamId: dto.teamId },
      );
      await this.notifyTeam(
        organizationId,
        dto.teamId!,
        'ROUTE_REASSIGNED',
        'A route was reassigned to your team',
        id,
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
    const missingDestination = pendingStops.filter((s) => {
      const t = stopTarget(s);
      return t.destinationLatitude == null || t.destinationLongitude == null;
    });
    if (missingDestination.length > 0) {
      const names = missingDestination.map(stopLabel).join(', ');
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
      await this.teamAvailability(
        organizationId,
        [route.teamId],
        route.routeDate.toISOString().slice(0, 10),
        requestedDeparture,
      )
    ).get(route.teamId)!;
    // A driver with no hours on this day was still put on this route by a
    // dispatcher — that's an override, so don't drop every stop over it.
    const vehicle = {
      key: route.teamId,
      availableFrom: availability.availableFrom,
      availableUntil: availability.offDuty ? null : availability.availableUntil,
    };

    const { routes, unassigned } = await this.optimizer.optimize({
      depot: {
        lat: Number(route.startLatitude),
        lng: Number(route.startLongitude),
      },
      vehicles: [vehicle],
      jobs: pendingStops.map((s) => {
        const t = stopTarget(s);
        return {
          key: s.id,
          location: {
            lat: Number(t.destinationLatitude),
            lng: Number(t.destinationLongitude),
          },
          priority: t.priority,
          windowStart: t.deliveryWindowStart,
          windowEnd: t.deliveryWindowEnd,
        };
      }),
      keepUnassigned: true,
    });
    const ordered = routes.get(route.teamId)!;

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
          lateNotifiedAt: null,
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
        (s) => stopTarget(s).priority === DeliveryPriority.HIGH,
      ).length,
      unscheduledCount: unassigned.length,
    });
    await this.notifyTeam(
      organizationId,
      route.teamId,
      'ROUTE_REOPTIMIZED',
      'Your route was re-optimized',
      routeId,
    );

    const stopById = new Map(pendingStops.map((s) => [s.id, s]));
    const unscheduled: {
      stopId: string;
      deliveryOrderId: string | null;
      label: string;
      reason: UnscheduledReason;
    }[] = unassigned.map((u) => {
      const s = stopById.get(u.key)!;
      return {
        stopId: s.id,
        deliveryOrderId: s.deliveryOrder?.id ?? null,
        label: stopLabel(s),
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
    await this.recalculateEtasAfter(resolvedStop, resolvedAt);
  }

  private async recalculateEtasAfter(
    resolvedStop: { routeId: string; sequence: number },
    resolvedAt: Date,
  ) {
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
        data: { plannedEta: new Date(cumulativeMs), atRiskNotifiedAt: null, lateNotifiedAt: null },
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
    this.assertRouteOpen(route);
    const target = await this.resolveNewStopTarget(organizationId, routeId, dto);

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

      return tx.routeStop.create({ data: { routeId, sequence, ...target } });
    });
    await this.recordHistory(
      routeId,
      RouteHistoryEventType.STOP_ADDED,
      userId,
      {
        deliveryOrderId: dto.deliveryOrderId ?? null,
        customerId: dto.customerId ?? null,
      },
    );
    if (route.status === RouteStatus.ACTIVE) {
      await this.notifyTeam(
        organizationId,
        route.teamId,
        'ROUTE_STOPS_CHANGED',
        'A stop was added to your route',
        routeId,
      );
    }
    return stop;
  }

  // What a new stop points at. With INVOICE_POS every delivery goes out
  // on a delivery order, so a stop must be one. Without it, a stop is a
  // customer (with a pin) — or a DO, if the org has them anyway (e.g.
  // from WAREHOUSE_OPS pack sessions).
  private async resolveNewStopTarget(
    organizationId: string,
    routeId: string,
    dto: AddRouteStopDto,
  ): Promise<Omit<Prisma.RouteStopUncheckedCreateInput, 'routeId' | 'sequence'>> {
    if ((dto.deliveryOrderId == null) === (dto.customerId == null)) {
      throw new BadRequestException(
        'Give either a delivery order or a customer for the stop',
      );
    }
    if (dto.deliveryOrderId) {
      await this.assertDeliveryOrderAvailable(organizationId, dto.deliveryOrderId);
      return {
        deliveryOrderId: dto.deliveryOrderId,
        activeDeliveryOrderId: dto.deliveryOrderId,
      };
    }

    if (await this.modules.isModuleEnabled(organizationId, ModuleKey.INVOICE_POS)) {
      throw new BadRequestException(
        'With Invoice/POS enabled, stops must be delivery orders — create a delivery order for this customer first',
      );
    }
    if (
      dto.deliveryWindowStart &&
      dto.deliveryWindowEnd &&
      new Date(dto.deliveryWindowStart) >= new Date(dto.deliveryWindowEnd)
    ) {
      throw new BadRequestException('Delivery window end must be after its start');
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId },
      select: { id: true, name: true, address: true, latitude: true, longitude: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.latitude == null || customer.longitude == null) {
      throw new BadRequestException(
        `${customer.name} has no location pin yet — set it on the customer first`,
      );
    }
    const duplicate = await this.prisma.routeStop.findFirst({
      where: {
        routeId,
        customerId: customer.id,
        signedAt: null,
        failedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(`${customer.name} is already a pending stop on this route`);
    }
    return {
      customerId: customer.id,
      customerName: customer.name,
      address: customer.address,
      destinationLatitude: customer.latitude,
      destinationLongitude: customer.longitude,
      priority: dto.priority ?? DeliveryPriority.NORMAL,
      deliveryWindowStart: dto.deliveryWindowStart
        ? new Date(dto.deliveryWindowStart)
        : null,
      deliveryWindowEnd: dto.deliveryWindowEnd ? new Date(dto.deliveryWindowEnd) : null,
    };
  }

  // Corrects a stop's pin for this route only. A customer stop's pin is
  // its own snapshot — the Customer record is never touched, so the
  // correction ends with the route. A DO stop's pin is the DO's (already
  // per-shipment).
  async setStopDestination(
    organizationId: string,
    routeId: string,
    stopId: string,
    dto: SetRouteStartDto,
    userId?: string,
  ) {
    const stop = await this.prisma.routeStop.findFirst({
      where: { id: stopId, routeId, route: { organizationId } },
      select: {
        id: true,
        deliveryOrderId: true,
        supersededAt: true,
        signedAt: true,
        failedAt: true,
        deliveryOrder: { select: { status: true, signedAt: true } },
        route: { select: { status: true, teamId: true } },
      },
    });
    if (!stop) throw new NotFoundException('Stop not found');
    this.assertRouteOpen(stop.route);
    if (this.stopStatus(stop) !== 'PENDING') {
      throw new BadRequestException('This stop is already resolved');
    }
    const pin = {
      destinationLatitude: dto.latitude,
      destinationLongitude: dto.longitude,
    };
    if (stop.deliveryOrderId) {
      await this.prisma.deliveryOrder.update({
        where: { id: stop.deliveryOrderId },
        data: pin,
      });
    } else {
      await this.prisma.routeStop.update({ where: { id: stopId }, data: pin });
    }
    await this.recordHistory(routeId, RouteHistoryEventType.START_SET, userId, {
      stopId,
      stopDestination: true,
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
    if (stop.route.status === RouteStatus.ACTIVE) {
      await this.notifyTeam(
        organizationId,
        stop.route.teamId,
        'ROUTE_STOPS_CHANGED',
        "A stop's location on your route was corrected",
        routeId,
      );
    }
    return this.getRoute(organizationId, routeId);
  }

  // ─── Customer stop proof / failure ───────────────────────────────────
  // DO stops go through /delivery-orders/:id/... as before; these are the
  // same actions for customer stops. Proof = receiver name + photo, both
  // required.

  // Staff: any stop in the org. DRIVER: only stops on their team's route.
  async findCustomerStopForAction(
    organizationId: string,
    routeId: string,
    stopId: string,
    requester?: Requester,
  ) {
    const stop = await this.prisma.routeStop.findFirst({
      where: {
        id: stopId,
        routeId,
        route: { organizationId, ...this.routeScope(requester) },
      },
      select: {
        id: true,
        routeId: true,
        sequence: true,
        customerName: true,
        customerId: true,
        address: true,
        deliveryOrderId: true,
        signedAt: true,
        failedAt: true,
        proofPhotoKey: true,
        route: { select: { status: true } },
      },
    });
    if (!stop) throw new NotFoundException('Stop not found');
    if (stop.deliveryOrderId) {
      throw new BadRequestException(
        'This stop is a delivery order — record it on the delivery order',
      );
    }
    return stop;
  }

  async recordCustomerStopProof(
    organizationId: string,
    routeId: string,
    stopId: string,
    params: {
      receivedBy: string;
      latitude?: number;
      longitude?: number;
      accuracy?: number;
    },
    requester: Requester,
  ) {
    const stop = await this.findCustomerStopForAction(
      organizationId,
      routeId,
      stopId,
      requester,
    );
    if (stop.route.status === RouteStatus.CANCELLED) {
      throw new BadRequestException('This route was cancelled');
    }
    if (!stop.proofPhotoKey) {
      throw new BadRequestException('Take a proof photo before completing the stop');
    }
    const signedAt = new Date();
    const claim = await this.prisma.routeStop.updateMany({
      where: { id: stopId, signedAt: null, failedAt: null },
      data: {
        receivedBy: params.receivedBy,
        signedAt,
        completedByUserId: requester.sub,
        completedLatitude: params.latitude ?? null,
        completedLongitude: params.longitude ?? null,
        completedAccuracy:
          params.latitude != null ? (params.accuracy ?? null) : null,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException('This stop is already resolved');
    }
    try {
      await backfillCustomerPin(this.prisma, {
        organizationId,
        customerId: stop.customerId,
        deliveryAddress: stop.address,
        latitude: params.latitude,
        longitude: params.longitude,
        accuracy: params.accuracy,
      });
    } catch {
      // best-effort, same as the DO path
    }
    try {
      await this.recalculateEtasAfter(stop, signedAt);
    } catch {
      // best-effort, same as the DO path
    }
    return this.getRoute(organizationId, routeId, requester);
  }

  async recordCustomerStopFailure(
    organizationId: string,
    routeId: string,
    stopId: string,
    params: { reason?: string; latitude?: number; longitude?: number },
    requester: Requester,
  ) {
    const stop = await this.findCustomerStopForAction(
      organizationId,
      routeId,
      stopId,
      requester,
    );
    if (stop.route.status === RouteStatus.CANCELLED) {
      throw new BadRequestException('This route was cancelled');
    }
    const failedAt = new Date();
    const claim = await this.prisma.routeStop.updateMany({
      where: { id: stopId, signedAt: null, failedAt: null },
      data: {
        failedAt,
        failureReason: params.reason ?? null,
        failureLatitude: params.latitude ?? null,
        failureLongitude: params.longitude ?? null,
        completedByUserId: requester.sub,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException('This stop is already resolved');
    }
    try {
      await this.recalculateEtasAfter(stop, failedAt);
    } catch {
      // best-effort
    }
    await this.notifications.notifyOrgStaff(
      organizationId,
      'DELIVERY_FAILED',
      `Delivery failed: ${stop.customerName ?? stopId}`,
      { link: `/delivery/routes/${routeId}`, payload: { routeId, stopId } },
    );
    return this.getRoute(organizationId, routeId, requester);
  }

  private assertWindow(start: Date | null, end: Date | null) {
    if (start && end && start >= end) {
      throw new BadRequestException('Delivery window end must be after its start');
    }
  }

  async updateCustomerStopDetails(
    organizationId: string,
    routeId: string,
    stopId: string,
    dto: UpdateCustomerStopDetailsDto,
  ) {
    const stop = await this.findCustomerStopForAction(organizationId, routeId, stopId);
    this.assertRouteOpen(stop.route);
    if (stop.signedAt || stop.failedAt) {
      throw new BadRequestException('This stop is already resolved');
    }
    const current = await this.prisma.routeStop.findUniqueOrThrow({
      where: { id: stopId },
      select: { deliveryWindowStart: true, deliveryWindowEnd: true },
    });
    const start =
      dto.deliveryWindowStart !== undefined
        ? new Date(dto.deliveryWindowStart)
        : current.deliveryWindowStart;
    const end =
      dto.deliveryWindowEnd !== undefined
        ? new Date(dto.deliveryWindowEnd)
        : current.deliveryWindowEnd;
    this.assertWindow(start, end);
    await this.prisma.routeStop.update({
      where: { id: stopId },
      data: {
        priority: dto.priority,
        deliveryWindowStart: start,
        deliveryWindowEnd: end,
        // Both checks depend on the window — re-arm their alerts.
        atRiskNotifiedAt: null,
        lateNotifiedAt: null,
      },
    });
    return this.getRoute(organizationId, routeId);
  }

  // Same shape as DeliveryOrderService.rescheduleDelivery(): the failed
  // stop stays on its route as superseded history, and a fresh stop with
  // the same snapshot (name, address, pin) goes onto the target route.
  async rescheduleCustomerStop(
    organizationId: string,
    routeId: string,
    stopId: string,
    dto: RescheduleCustomerStopDto,
    userId?: string,
  ) {
    const stop = await this.prisma.routeStop.findFirst({
      where: { id: stopId, routeId, route: { organizationId } },
    });
    if (!stop) throw new NotFoundException('Stop not found');
    if (stop.deliveryOrderId) {
      throw new BadRequestException(
        'This stop is a delivery order — reschedule it on the delivery order',
      );
    }
    if (!stop.failedAt || stop.supersededAt) {
      throw new BadRequestException('Only a failed stop can be rescheduled');
    }
    const target = await this.prisma.route.findFirst({
      where: { id: dto.routeId, organizationId },
      select: { id: true, status: true, teamId: true },
    });
    if (!target) throw new NotFoundException('Route not found');
    this.assertRouteOpen(target);
    const start = dto.deliveryWindowStart
      ? new Date(dto.deliveryWindowStart)
      : stop.deliveryWindowStart;
    const end = dto.deliveryWindowEnd
      ? new Date(dto.deliveryWindowEnd)
      : stop.deliveryWindowEnd;
    this.assertWindow(start, end);
    if (stop.customerId) {
      const duplicate = await this.prisma.routeStop.findFirst({
        where: {
          routeId: target.id,
          customerId: stop.customerId,
          signedAt: null,
          failedAt: null,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException(
          `${stop.customerName} is already a pending stop on that route`,
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.routeStop.updateMany({
        where: { id: stopId, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      if (claim.count === 0) {
        throw new BadRequestException('This stop was already rescheduled');
      }
      const sequence =
        ((
          await tx.routeStop.aggregate({
            where: { routeId: target.id },
            _max: { sequence: true },
          })
        )._max.sequence ?? 0) + 1;
      return tx.routeStop.create({
        data: {
          routeId: target.id,
          sequence,
          customerId: stop.customerId,
          customerName: stop.customerName,
          address: stop.address,
          destinationLatitude: stop.destinationLatitude,
          destinationLongitude: stop.destinationLongitude,
          priority: stop.priority,
          deliveryWindowStart: start,
          deliveryWindowEnd: end,
        },
      });
    });

    await this.recordHistory(routeId, RouteHistoryEventType.STOP_RESCHEDULED, userId, {
      stopId,
      customerId: stop.customerId,
      toRouteId: target.id,
    });
    await this.recordHistory(target.id, RouteHistoryEventType.STOP_ADDED, userId, {
      customerId: stop.customerId,
      rescheduledFromStopId: stopId,
    });
    if (target.status === RouteStatus.ACTIVE) {
      await this.notifyTeam(
        organizationId,
        target.teamId,
        'ROUTE_STOPS_CHANGED',
        'A stop was added to your route',
        target.id,
      );
    }
    return created;
  }

  // Refuses a DRIVER acting outside their team — used by the stop photo
  // service, which does its own lookups.
  async assertCanActOnRoute(
    organizationId: string,
    routeId: string,
    requester?: Requester,
  ) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId, ...this.routeScope(requester) },
      select: { id: true },
    });
    if (!route) throw new ForbiddenException('This route is not your team\'s');
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
      await this.notifyTeam(
        organizationId,
        route.teamId,
        'ROUTE_STOPS_CHANGED',
        'Your route order was changed',
        routeId,
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
        route: { select: { teamId: true, status: true } },
      },
    });
    if (!stop) throw new NotFoundException('Stop not found');
    this.assertRouteOpen(stop.route);
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
      await this.notifyTeam(
        organizationId,
        stop.route.teamId,
        'ROUTE_STOPS_CHANGED',
        'A stop was removed from your route',
        routeId,
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
      select: { teamId: true, status: true },
    });
    if (route?.status === RouteStatus.ACTIVE) {
      await this.notifyTeam(
        organizationId,
        route.teamId,
        'ROUTE_STOPS_CHANGED',
        'A stop was removed from your route',
        routeId,
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
      select: { teamId: true, status: true },
    });
    if (route?.status === RouteStatus.ACTIVE) {
      await this.notifyTeam(
        organizationId,
        route.teamId,
        'ROUTE_STOPS_CHANGED',
        'A failed stop on your route was rescheduled',
        routeId,
      );
    }
  }

  // ─── Late / at-risk alerts ──────────────────────────────────────────
  // lateness() is derived at read time; this sweep turns a stop *becoming*
  // late or at risk into a notification — once each per stop
  // (lateNotifiedAt / atRiskNotifiedAt), reset whenever its ETA or window
  // is recomputed. Dispatch staff and the stop's driver are both told.
  // A stop that goes straight to late never also gets the at-risk alert.
  // Only today's/yesterday's open routes are scanned, so the query stays small.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async notifyLateStops() {
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const candidates = await this.prisma.routeStop.findMany({
      where: {
        OR: [{ atRiskNotifiedAt: null }, { lateNotifiedAt: null }],
        supersededAt: null,
        route: {
          status: { in: [RouteStatus.PLANNED, RouteStatus.ACTIVE] },
          routeDate: { gte: since },
        },
      },
      select: {
        ...stopSelect,
        atRiskNotifiedAt: true,
        lateNotifiedAt: true,
        route: {
          select: { id: true, organizationId: true, teamId: true },
        },
      },
      take: 500,
    });

    for (const stop of candidates) {
      const l = this.lateness(this.stopStatus(stop), stop.plannedEta, stopTarget(stop).deliveryWindowEnd);
      const late = l === 'LATE' && stop.lateNotifiedAt == null;
      const atRisk = l === 'AT_RISK' && stop.atRiskNotifiedAt == null;
      if (!late && !atRisk) continue;

      // Claim first so an overlapping run can't double-notify.
      const now = new Date();
      const claim = await this.prisma.routeStop.updateMany({
        where: late ? { id: stop.id, lateNotifiedAt: null } : { id: stop.id, atRiskNotifiedAt: null },
        data: late ? { lateNotifiedAt: now, atRiskNotifiedAt: stop.atRiskNotifiedAt ?? now } : { atRiskNotifiedAt: now },
      });
      if (claim.count === 0) continue;

      const who = stopLabel(stop);
      const type = late ? 'DELIVERY_LATE' : 'DELIVERY_AT_RISK';
      const payload = {
        routeId: stop.route.id,
        stopId: stop.id,
        deliveryOrderId: stop.deliveryOrder?.id ?? null,
      };
      try {
        await this.notifications.notifyOrgStaff(
          stop.route.organizationId,
          type,
          late ? `Delivery is late: ${who}` : `Delivery at risk of being late: ${who}`,
          { link: `/delivery/routes/${stop.route.id}`, payload },
        );
        const driverId = (
          await this.teamDrivers(stop.route.organizationId, [stop.route.teamId])
        ).get(stop.route.teamId);
        if (driverId) {
          await this.notifications.create(
            stop.route.organizationId,
            driverId,
            type,
            late ? `You are late for ${who}` : `You may be late for ${who}`,
            { link: '/driver', payload },
          );
        }
      } catch {
        // best-effort, like every other notification side effect here
      }
    }
  }

  // The driver's team's route(s) for the day — cancelled ones hidden.
  async listMyRoutes(organizationId: string, driverId: string, date?: string) {
    const routeDate = date ?? new Date().toISOString().slice(0, 10);
    const routes = await this.prisma.route.findMany({
      where: {
        organizationId,
        routeDate: this.dayRange(routeDate),
        status: { not: RouteStatus.CANCELLED },
        ...this.routeScope({ sub: driverId, role: 'DRIVER' }),
      },
      include: {
        team: { select: teamSelect },
        stops: { select: stopSelect, orderBy: { sequence: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      routes.map(async (route) => {
        const stops = await this.withCustomerInfo(
          organizationId,
          route.stops.map((stop) => this.presentStop(stop)),
        );
        return {
          ...route,
          team: presentTeam(route.team),
          stops,
          currentStop: stops.find((stop) => stop.status === 'PENDING') ?? null,
        };
      }),
    );
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
      late: 0,
    };
    for (const stop of stops) {
      const status = this.stopStatus(stop);
      if (status === 'DELIVERED') counts.delivered++;
      else if (status === 'FAILED') counts.failed++;
      else counts.pending++;
      const l = this.lateness(status, stop.plannedEta, stopTarget(stop).deliveryWindowEnd);
      if (l === 'LATE') counts.late++;
      else if (l === 'AT_RISK') counts.atRisk++;
    }
    return counts;
  }

  async monitoringByTeam(organizationId: string, date?: string) {
    const routeDate = date ?? new Date().toISOString().slice(0, 10);
    const routes = await this.prisma.route.findMany({
      where: { organizationId, routeDate: this.dayRange(routeDate) },
      include: {
        team: { select: teamSelect },
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
        late: 0,
      };
      for (const stop of route.stops) {
        const status = this.stopStatus(stop);
        if (status === 'DELIVERED') counts.delivered++;
        else if (status === 'FAILED') counts.failed++;
        else counts.pending++;
        const l = this.lateness(status, stop.plannedEta, stopTarget(stop).deliveryWindowEnd);
        if (l === 'LATE') counts.late++;
        else if (l === 'AT_RISK') counts.atRisk++;
      }
      return { routeId: route.id, team: presentTeam(route.team), ...counts };
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
      // The route's team lets the map filter by team and name it in a popup.
      select: { ...stopSelect, route: { select: { id: true, team: { select: teamSelect } } } },
    });

    return stops
      .map((stop) => {
        const view = this.presentStop(stop);
        return {
          id: stop.id,
          routeId: stop.route.id,
          team: presentTeam(stop.route.team),
          status: view.status,
          latitude:
            view.destinationLatitude ?? view.completedLatitude ?? view.failureLatitude,
          longitude:
            view.destinationLongitude ?? view.completedLongitude ?? view.failureLongitude,
          label: view.label,
        };
      })
      .filter((s) => s.latitude != null && s.longitude != null);
  }
}
