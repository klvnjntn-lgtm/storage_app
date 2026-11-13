// src/delivery-routes/delivery-routes.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  assertDriverCatchUpWindow,
  assertDriverFailureReason,
  deliveredWithoutGps,
  driverSignedAt,
  onServerClock,
  movePhotoToFailure,
} from './driver-proof';
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
  DEFAULT_TIMING,
  RouteOptimizerService,
  addWorkingTime,
  type DriverBreak,
  type TripTiming,
  type UnscheduledReason,
} from './route-optimizer.service';
import { offPin } from './off-pin';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { SignedFileUrlService } from '../storage/signed-file-url.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { AddRouteStopDto } from './dto/add-route-stop.dto';
import { ReorderRouteStopsDto } from './dto/reorder-route-stops.dto';
import { completionTimeline } from './completion-timeline';
import { highPriorityFirst, priorityInversions } from './priority-order';
import { SetRouteStartDto } from './dto/set-route-start.dto';
import { OptimizeRouteDto } from './dto/optimize-route.dto';
import { backfillCustomerPin, fixIsTimely, releaseCustomerPin } from '../customers/customer-pin-backfill';
import { StartOffRoadError } from '../routing/osrm.service';
import { StopShareTokenService } from './stop-share-token.service';
import {
  RescheduleCustomerStopDto,
  UpdateCustomerStopDetailsDto,
} from './dto/customer-stop-actions.dto';
import {
  resolveTimezone,
  todayBusinessDate,
  wallTimeOnBusinessDay,
} from '../accounting/business-date';

export type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

// Start of a route's day in the org's timezone — nothing on the route can
// have happened before it (driver-proof.ts uses it to catch a phone set to
// the wrong date).
export function routeDayStart(route: {
  routeDate: Date;
  organization: { timezone: string | null };
}): Date {
  return wallTimeOnBusinessDay(
    route.routeDate,
    '00:00',
    resolveTimezone(route.organization),
  );
}

type Requester = { sub: string; role: string };

// How far past its own ETA a still-PENDING stop has to be before it's
// flagged "late" — a grace window so an ETA that's off by a few minutes
// doesn't immediately read as a delay.
const LATE_AFTER_MINUTES = 20;
// Renumbering a long route is many small writes, on top of waiting for the route lock.
const LONG_TX_MS = 20_000;

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
  RouteHistoryEventType.STOP_RESET,
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
  customerAddressId: true,
  addressLabel: true,
  destinationLatitude: true,
  destinationLongitude: true,
  priority: true,
  deliveryWindowStart: true,
  deliveryWindowEnd: true,
  receivedBy: true,
  signedAt: true,
  proofPhotoKey: true,
  proofPhotoTakenAt: true,
  proofPhotoLatitude: true,
  proofPhotoLongitude: true,
  proofPhotoAccuracy: true,
  proofPhotoLocationAt: true,
  pendingReceivedBy: true,
  failurePhotoKey: true,
  completedLatitude: true,
  completedLongitude: true,
  completedAccuracy: true,
  completedLocationAt: true,
  deliveredWithoutGps: true,
  failedAt: true,
  failureReason: true,
  failureLatitude: true,
  failureLongitude: true,
  markedByOfficeAt: true,
  officeNote: true,
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
      deliveredWithoutGps: true,
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
      proofPhotoTakenAt: true,
      proofPhotoLatitude: true,
      proofPhotoLongitude: true,
      proofPhotoAccuracy: true,
      pendingReceivedBy: true,
      failurePhotoKey: true,
    },
  },
} satisfies Prisma.RouteStopSelect;

type StopRow = Prisma.RouteStopGetPayload<{ select: typeof stopSelect }>;

// The team with its driver (one per team — TeamsService.assignDriver).
export const teamSelect = {
  id: true,
  name: true,
  colorIndex: true,
  members: {
    where: { role: 'DRIVER', active: true, removedAt: null },
    select: { id: true, email: true, displayName: true },
  },
} satisfies Prisma.TeamSelect;

type TeamRow = Prisma.TeamGetPayload<{ select: typeof teamSelect }>;

export const presentTeam = (team: TeamRow) => ({
  id: team.id,
  name: team.name,
  colorIndex: team.colorIndex,
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

// In SQL, what stopStatus() calls PENDING.
export const pendingStopWhere = {
  supersededAt: null,
  signedAt: null,
  failedAt: null,
  OR: [
    { deliveryOrderId: null },
    {
      deliveryOrder: {
        signedAt: null,
        status: { in: [DeliveryOrderStatus.PACKED, DeliveryOrderStatus.SHIPPED] },
      },
    },
  ],
} satisfies Prisma.RouteStopWhereInput;

const optimizerJob = (stop: TargetSource) => {
  const t = stopTarget(stop);
  return {
    key: stop.id,
    location:
      t.destinationLatitude != null && t.destinationLongitude != null
        ? { lat: Number(t.destinationLatitude), lng: Number(t.destinationLongitude) }
        : null,
    priority: t.priority,
    windowStart: t.deliveryWindowStart,
    windowEnd: t.deliveryWindowEnd,
  };
};

// What restoreOriginalOrder() goes back to.
type OriginalOrder = {
  stopIds: string[];
  // Whether the route had ETAs yet: optimizing a hand-built route gave it some.
  hadEtas: boolean;
  plannedDepartureAt: string | null;
};

const stopLabel = (stop: TargetSource) => {
  const t = stopTarget(stop);
  return t.customerName ?? t.doNumber ?? stop.deliveryOrder?.id ?? stop.id;
};

// What a delivery attempt recorded, kept in the history when the result is
// reset or moved off a stop: the photo files stay in storage and these keys
// find them again (DeliveryRoutesService.getHistoryPhotoKey).
type EvidenceSource = {
  proofPhotoKey: string | null;
  proofPhotoTakenAt: Date | null;
  proofPhotoLatitude: Prisma.Decimal | null;
  proofPhotoLongitude: Prisma.Decimal | null;
  proofPhotoAccuracy: number | null;
  failurePhotoKey: string | null;
  completedLatitude: Prisma.Decimal | null;
  completedLongitude: Prisma.Decimal | null;
  completedAccuracy: number | null;
  failureLatitude: Prisma.Decimal | null;
  failureLongitude: Prisma.Decimal | null;
};
const num = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));
function keptEvidence(source: EvidenceSource) {
  return {
    proofPhotoKey: source.proofPhotoKey,
    failurePhotoKey: source.failurePhotoKey,
    photoTakenAt: source.proofPhotoTakenAt?.toISOString() ?? null,
    photoLatitude: num(source.proofPhotoLatitude),
    photoLongitude: num(source.proofPhotoLongitude),
    photoAccuracy: source.proofPhotoAccuracy,
    completedLatitude: num(source.completedLatitude),
    completedLongitude: num(source.completedLongitude),
    completedAccuracy: source.completedAccuracy,
    failureLatitude: num(source.failureLatitude),
    failureLongitude: num(source.failureLongitude),
  };
}

@Injectable()
export class DeliveryRoutesService {
  private readonly logger = new Logger(DeliveryRoutesService.name);

  constructor(
    private prisma: PrismaService,
    private optimizer: RouteOptimizerService,
    private notifications: NotificationsService,
    private modules: OrganizationModulesService,
    private signer: SignedFileUrlService,
    private shareTokens: StopShareTokenService,
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
    const {
      proofPhotoKey: _key,
      proofPhotoUrl: _url,
      failurePhotoKey: _failKey,
      ...deliveryOrder
    } =
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
      // Saved-address name for a customer stop ("Gudang Timur"); null for
      // the main address and for DO stops.
      addressLabel: d ? null : stop.addressLabel,
      customerAddressId: d ? null : stop.customerAddressId,
      receivedBy: d ? d.receivedBy : stop.receivedBy,
      signedAt: d ? d.signedAt : stop.signedAt,
      hasProofPhoto: d
        ? d.proofPhotoKey != null || d.proofPhotoUrl != null
        : stop.proofPhotoKey != null,
      // Captured with the photo before Done — what the office sees for a
      // delivery the driver hasn't confirmed (or never did).
      photoTakenAt: d ? d.proofPhotoTakenAt : stop.proofPhotoTakenAt,
      photoLatitude: d ? d.proofPhotoLatitude : stop.proofPhotoLatitude,
      photoLongitude: d ? d.proofPhotoLongitude : stop.proofPhotoLongitude,
      photoAccuracy: d ? d.proofPhotoAccuracy : stop.proofPhotoAccuracy,
      pendingReceivedBy: d ? d.pendingReceivedBy : stop.pendingReceivedBy,
      // Photo from a failed attempt (closed shop, locked gate).
      hasFailurePhoto: d ? d.failurePhotoKey != null : stop.failurePhotoKey != null,
      completedLatitude: d ? d.completedLatitude : stop.completedLatitude,
      completedLongitude: d ? d.completedLongitude : stop.completedLongitude,
      completedAccuracy: d ? d.completedAccuracy : stop.completedAccuracy,
      // The driver finished it with no GPS reading: flagged for the office.
      deliveredWithoutGps:
        status === 'DELIVERED' && stop.markedByOfficeAt == null && (d ? d.deliveredWithoutGps : stop.deliveredWithoutGps),
      // How far from the pin the driver recorded the delivery (see off-pin.ts).
      offPin:
        status === 'DELIVERED'
          ? offPin({
              completedLatitude: d ? d.completedLatitude : stop.completedLatitude,
              completedLongitude: d ? d.completedLongitude : stop.completedLongitude,
              completedAccuracy: d ? d.completedAccuracy : stop.completedAccuracy,
              destinationLatitude: target.destinationLatitude,
              destinationLongitude: target.destinationLongitude,
              markedByOffice: stop.markedByOfficeAt != null,
            })
          : null,
      failedAt: d ? d.failedAt : stop.failedAt,
      failureReason: d ? d.failureReason : stop.failureReason,
      failureLatitude: d ? d.failureLatitude : stop.failureLatitude,
      failureLongitude: d ? d.failureLongitude : stop.failureLongitude,
      // An admin set this result from the office, not the driver on site.
      markedByOffice: stop.markedByOfficeAt != null,
      officeNote: stop.officeNote,
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
              select: { id: true, storageKey: true, fromProofOf: true },
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
            // Filled in from this delivery's proof photo — the phone sends
            // a clean copy again on a retake so it can be replaced.
            fromProofOf: p.fromProofOf,
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

  // "Today" for a route list with no date given, in the org's own timezone:
  // UTC's today is still yesterday in Jakarta until 07:00, when drivers
  // are already out.
  private async orgToday(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    return todayBusinessDate(resolveTimezone(org)).toISOString().slice(0, 10);
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
  //
  // Call inside the transaction that writes the route, after lockTeam: a
  // check on its own let a double-tapped "create" (or two people planning
  // the same team) both pass and both create.
  private async assertTeamFreeOnDate(
    organizationId: string,
    teamId: string,
    routeDate: Date,
    exceptRouteId?: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const existing = await db.route.findFirst({
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
    const route = await this.prisma.$transaction(async (tx) => {
      await lockTeam(tx, dto.teamId);
      await this.assertTeamFreeOnDate(organizationId, dto.teamId, routeDate, undefined, tx);
      return tx.route.create({
        data: {
          organizationId,
          teamId: dto.teamId,
          routeDate,
          name: dto.name,
          createdByUserId,
        },
      });
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

    const stops = (
      await this.withCustomerInfo(
        organizationId,
        route.stops.map((stop) => this.presentStop(stop)),
      )
    ).map((stop) => ({
      ...stop,
      // For the stop's Copy button: a public page with the customer's
      // landmark photos (see PublicStopController). Only when there are
      // photos to show — otherwise the copied text says it all.
      shareToken: stop.customerInfo?.locationPhotos.length
        ? this.shareTokens.sign(stop.id, route.routeDate)
        : null,
    }));
    const currentStop = stops.find((stop) => stop.status === 'PENDING') ?? null;
    const startPoint = await this.getStartPoint(organizationId);

    return { ...route, team: presentTeam(route.team), stops, currentStop, startPoint };
  }

  // The public stop page (/stop/<token>). Only what a driver or helper
  // needs to find the place: no proof-of-delivery photos, no phone number,
  // no delivery result. Same 404 for a bad, expired or deleted-stop token.
  async publicStopView(token: string) {
    const stopId = this.shareTokens.verify(token);
    const row = stopId
      ? await this.prisma.routeStop.findUnique({
          where: { id: stopId },
          select: {
            ...stopSelect,
            route: {
              select: {
                organizationId: true,
                routeDate: true,
                organization: { select: { name: true } },
              },
            },
          },
        })
      : null;
    if (!row) throw new NotFoundException('This link is invalid or has expired');

    const { route, ...stopRow } = row;
    const [stop] = await this.withCustomerInfo(route.organizationId, [
      this.presentStop(stopRow),
    ]);
    return {
      businessName: route.organization.name,
      routeDate: route.routeDate,
      label: stop.label,
      customerName: stop.customerName,
      addressLabel: stop.addressLabel,
      address: stop.address,
      latitude: stop.destinationLatitude,
      longitude: stop.destinationLongitude,
      deliveryNotes: stop.customerInfo?.deliveryNotes ?? null,
      photos: (stop.customerInfo?.locationPhotos ?? []).map((p) => ({
        id: p.id,
        path: p.path,
      })),
    };
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
    if (teamChanged) await this.assertTeam(organizationId, dto.teamId!);
    // Bringing a cancelled route back counts as a new one for that day too.
    const revived =
      route.status === RouteStatus.CANCELLED && dto.status != null && dto.status !== RouteStatus.CANCELLED;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (teamChanged || revived) {
        const teamId = dto.teamId ?? route.teamId;
        await lockTeam(tx, teamId);
        await this.assertTeamFreeOnDate(organizationId, teamId, route.routeDate, id, tx);
      }
      return tx.route.update({
        where: { id },
        data: { name: dto.name, status: dto.status, teamId: dto.teamId },
      });
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
    // A closed route skips the priority rule, so one reopened may need sorting.
    if (dto.status != null && dto.status !== route.status) {
      await this.applyPriorityOrder(organizationId, id, userId);
    }
    return updated;
  }

  // Where every route leaves from — one point for the business, set once
  // (routes pages) and kept until someone changes it.
  async getStartPoint(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { deliveryStartLatitude: true, deliveryStartLongitude: true },
    });
    return org.deliveryStartLatitude != null && org.deliveryStartLongitude != null
      ? {
          latitude: Number(org.deliveryStartLatitude),
          longitude: Number(org.deliveryStartLongitude),
        }
      : null;
  }

  async setStartPoint(organizationId: string, dto: SetRouteStartDto) {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        deliveryStartLatitude: dto.latitude,
        deliveryStartLongitude: dto.longitude,
      },
    });
    return this.getStartPoint(organizationId);
  }

  // Re-sequences and re-ETAs only the still-PENDING stops — resolved
  // (delivered/failed) stops keep their existing sequence untouched (spec:
  // "only remaining deliveries should be re-optimized"). VROOM picks the
  // order against the driver's working hours, each delivery's window and
  // priority (see RouteOptimizerService); caches each stop's travel leg so
  // later ETA recalculation (recalculateEtasAfterResolution) is pure
  // arithmetic.
  //
  // HIGH stops are solved on their own and visited first, then normal stops
  // are solved from the last HIGH stop. A stop that can't fit (window already
  // missed, driver's hours full) stays on the route, appended after the
  // optimized ones of its own priority, and is returned in `unscheduled` so
  // the dispatcher can see it.
  //
  // Once a stop is resolved the driver is out on the road, so the new order
  // starts from where they last were (see whereabouts) and from now, never
  // from the depot at a departure time that's already passed.
  async optimize(
    organizationId: string,
    routeId: string,
    dto: OptimizeRouteDto,
    userId?: string,
  ) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId },
      include: {
        stops: { select: stopSelect, orderBy: { sequence: 'asc' } },
      },
    });
    if (!route) throw new NotFoundException('Route not found');
    this.assertRouteOpen(route);
    const orderOnly = !!dto.orderOnly;
    const start = await this.getStartPoint(organizationId);
    // ETAs have to be counted from somewhere; an order doesn't.
    if (!start && !orderOnly) {
      throw new BadRequestException('Set the start point before optimizing');
    }

    const pendingStops = route.stops.filter(
      (s) => this.stopStatus(s) === 'PENDING',
    );
    // A stop with no pin can't be placed, but it shouldn't hold up the others: it
    // stays at the end of its priority group and is reported in `unscheduled`.
    if (pendingStops.length === 0) {
      return { ...(await this.getRoute(organizationId, routeId)), unscheduled: [], farStops: [] };
    }

    const now = new Date();
    const anyResolved = pendingStops.length < route.stops.length;
    const underway = anyResolved || route.status === RouteStatus.ACTIVE;
    const asked = dto.departureAt ? new Date(dto.departureAt) : route.plannedDepartureAt;
    // The route page sends its departure field, filled in with the old plan,
    // so a time already gone has to be caught here. Not started and nothing
    // asked: left to the route's own day (see driverAvailability), so a future
    // route doesn't get ETAs for today, which the late-stop alerts would act on.
    const requestedDeparture = underway ? (asked && asked > now ? asked : now) : (asked ?? undefined);
    const availability = orderOnly
      ? null
      : (
      await this.teamAvailability(
        organizationId,
        [route.teamId],
        route.routeDate.toISOString().slice(0, 10),
        requestedDeparture,
      )
    ).get(route.teamId)!;
    // A driver with no hours on this day was still put on this route by a
    // dispatcher — that's an override, so don't drop every stop over it.
    const vehicle = availability
      ? {
          key: route.teamId,
          availableFrom: availability.availableFrom,
          availableUntil: availability.offDuty ? null : availability.availableUntil,
          breaks: availability.breaks,
        }
      : { key: route.teamId, availableFrom: now, availableUntil: null };
    const timing = await this.optimizer.timing(organizationId);

    const jobs = pendingStops
      .map(optimizerJob)
      // A window means nothing without a clock to hold it against.
      .map((job) => (orderOnly ? { ...job, windowStart: null, windowEnd: null } : job));
    const solveFrom = (from: { latitude: number; longitude: number }) =>
      this.optimizer.optimize({
        depot: { lat: from.latitude, lng: from.longitude },
        vehicles: [vehicle],
        jobs,
        keepUnassigned: true,
        timing,
      });
    // Order only, with no start point and nothing done yet: from the first pin.
    const firstPin = jobs.find((job) => job.location)?.location;
    const position =
      this.whereabouts(route, start).position ??
      (firstPin
        ? { latitude: firstPin.lat, longitude: firstPin.lng, source: 'DEPOT' as const }
        : { latitude: 0, longitude: 0, source: 'DEPOT' as const }); // no pins: nothing gets routed
    // No road out of the driver's last spot (a GPS fix far off the road) says
    // nothing about the stops: order them from the depot instead.
    const fromLastStop = !!start && position.source === 'LAST_STOP';
    let solved: Awaited<ReturnType<typeof solveFrom>> | null = null;
    try {
      solved = await solveFrom(position);
    } catch (err) {
      if (!(err instanceof StartOffRoadError) || !fromLastStop) throw err;
    }
    if (
      fromLastStop &&
      (!solved ||
        (solved.unassigned.length === jobs.length &&
          solved.unassigned.every((u) => u.reason === 'UNREACHABLE')))
    ) {
      solved = await solveFrom(start);
    }
    const { routes, unassigned, far } = solved!;
    const ordered = routes.get(route.teamId)!;

    const highestResolvedSequence = route.stops
      .filter((s) => this.stopStatus(s) !== 'PENDING')
      .reduce((max, s) => Math.max(max, s.sequence), 0);

    await this.prisma.$transaction(
      async (tx) => {
        await lockRoute(tx, routeId);
        // Two-phase, same reasoning as writeStopSequences().
        for (const [i, s] of pendingStops.entries()) {
          await tx.routeStop.update({ where: { id: s.id }, data: { sequence: -(i + 1) } });
        }
        for (const [visitPosition, stop] of ordered.entries()) {
          await tx.routeStop.update({
            where: { id: stop.key },
            data: {
              sequence: highestResolvedSequence + visitPosition + 1,
              travelMetersFromPrevious: orderOnly ? null : (stop.leg?.distanceMeters ?? null),
              travelSecondsFromPrevious:
                !orderOnly && stop.leg != null ? Math.round(stop.leg.durationSeconds) : null,
              // Order only leaves none behind: an old one would describe another trip.
              plannedEta: orderOnly ? null : stop.eta,
              // New ETA — a later slip deserves a fresh alert.
              atRiskNotifiedAt: null,
              lateNotifiedAt: null,
            },
          });
        }
        await tx.route.update({
          where: { id: routeId },
          data: {
            // Once a stop is done the departure is history; monitoring still reads it.
            ...(anyResolved ? {} : { plannedDepartureAt: orderOnly ? null : vehicle.availableFrom }),
            // Only the first time: a second optimize still goes back to the list
            // the office started from.
            ...(route.originalOrder == null
              ? {
                  originalOrder: {
                    stopIds: route.stops.map((s) => s.id),
                    hadEtas: pendingStops.some((s) => s.plannedEta),
                    plannedDepartureAt: route.plannedDepartureAt?.toISOString() ?? null,
                  } satisfies OriginalOrder,
                }
              : {}),
          },
        });
      },
      { timeout: LONG_TX_MS },
    );
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
    // Pins worth a second look: routed, but much further out than the rest.
    const farStops = far.map((f) => ({
      stopId: f.key,
      label: stopLabel(stopById.get(f.key)!),
      meters: f.meters,
    }));
    return { ...(await this.getRoute(organizationId, routeId)), unscheduled, farStops };
  }

  // Undoes optimize(): every stop back where it was before the first one,
  // finished stops included, so the numbers read as the office's list again.
  // Stops added since go at the end, in their current order.
  async restoreOriginalOrder(organizationId: string, routeId: string, userId?: string) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, organizationId },
      include: { stops: { select: stopSelect, orderBy: { sequence: 'asc' } } },
    });
    if (!route) throw new NotFoundException('Route not found');
    this.assertRouteOpen(route);
    const original = route.originalOrder as OriginalOrder | null;
    if (!original) {
      throw new BadRequestException('This route has no earlier order to go back to');
    }

    const positions = new Map(original.stopIds.map((id, i) => [id, i]));
    const position = (id: string) => positions.get(id) ?? Number.MAX_SAFE_INTEGER;
    const ordered = this.pendingHighFirst(
      [...route.stops].sort((a, b) => position(a.id) - position(b.id) || a.sequence - b.sequence),
    );
    const pending = ordered.filter((s) => this.stopStatus(s) === 'PENDING');
    const anyResolved = pending.length < ordered.length;

    await this.prisma.$transaction(
      async (tx) => {
        await lockRoute(tx, routeId);
        await writeStopSequences(tx, ordered.map((s, i) => ({ id: s.id, sequence: i + 1 })));
        if (!original.hadEtas) {
          await tx.routeStop.updateMany({
            where: { id: { in: pending.map((s) => s.id) } },
            data: {
              plannedEta: null,
              travelSecondsFromPrevious: null,
              travelMetersFromPrevious: null,
              atRiskNotifiedAt: null,
              lateNotifiedAt: null,
            },
          });
        }
        await tx.route.update({
          where: { id: routeId },
          data: {
            originalOrder: Prisma.DbNull,
            ...(anyResolved
              ? {}
              : {
                  plannedDepartureAt: original.plannedDepartureAt
                    ? new Date(original.plannedDepartureAt)
                    : null,
                }),
          },
        });
      },
      { timeout: LONG_TX_MS },
    );
    await this.recordHistory(routeId, RouteHistoryEventType.STOPS_REORDERED, userId, {
      restoredOriginalOrder: true,
    });
    if (route.status === RouteStatus.ACTIVE) {
      await this.notifyTeam(
        organizationId,
        route.teamId,
        'ROUTE_STOPS_CHANGED',
        'Your route order was changed',
        routeId,
      );
    }
    if (original.hadEtas) await this.refreshEtas(routeId);
    return this.getRoute(organizationId, routeId);
  }

  // After a customer's edit moved stops on these routes (customer-stop-sync.ts):
  // same follow-up as correcting a stop's pin. The edit has already saved, so
  // this never fails it.
  async afterCustomerSynced(organizationId: string, routeIds: string[]) {
    for (const routeId of routeIds) {
      try {
        const route = await this.prisma.route.findUniqueOrThrow({
          where: { id: routeId },
          select: { teamId: true, status: true },
        });
        await this.recordHistory(routeId, RouteHistoryEventType.START_SET, undefined, {
          stopDestination: true,
          customerSync: true,
        });
        if (route.status === RouteStatus.ACTIVE) {
          await this.notifyTeam(
            organizationId,
            route.teamId,
            'ROUTE_STOPS_CHANGED',
            "A customer's address on your route was updated",
            routeId,
          );
        }
        await this.refreshEtas(routeId);
      } catch (err) {
        this.logger.warn(`Could not follow up a customer edit on route ${routeId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Called after a delivery resolves (delivered/failed). In plan order this
  // is pure arithmetic over the cached legs, no OSRM call: an actual
  // completion time is exactly the kind of "known" data point the spec says
  // ETA should recompute from, and re-hitting OSRM per delivery would be a
  // live-tracking-shaped dependency this module deliberately avoids. Only a
  // driver working out of order needs new legs, since stops they skipped
  // aren't where the cached legs assume.
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
    const stops = await this.prisma.routeStop.findMany({
      where: { routeId: resolvedStop.routeId },
      select: stopSelect,
      orderBy: { sequence: 'asc' },
    });
    const pending = stops.filter((s) => this.stopStatus(s) === 'PENDING');
    if (!pending.some((s) => s.plannedEta)) return; // never planned — no ETAs to keep up
    if (pending[0].sequence < resolvedStop.sequence) {
      await this.refreshEtas(resolvedStop.routeId, resolvedAt);
      return;
    }
    const route = await this.prisma.route.findUnique({
      where: { id: resolvedStop.routeId },
      select: { organizationId: true, teamId: true, routeDate: true },
    });
    if (!route) return;
    await this.walkCachedLegs(pending, resolvedAt, await this.routeClock(route));
  }

  // The business's trip timing and the driver's breaks still ahead on the
  // route's day — what every ETA on it is worked out with.
  private async routeClock(route: { organizationId: string; teamId: string; routeDate: Date }) {
    const [timing, availability] = await Promise.all([
      this.optimizer.timing(route.organizationId),
      this.teamAvailability(route.organizationId, [route.teamId], route.routeDate.toISOString().slice(0, 10)),
    ]);
    return { timing, breaks: availability.get(route.teamId)?.breaks ?? [] };
  }

  // ETAs from the cached legs, starting at `from`. A stop with no leg (no pin)
  // is passed over, keeping the stops after it up to date. The cached legs
  // already carry the travel factor they were planned with.
  private async walkCachedLegs(
    pending: StopRow[],
    from: Date,
    clock: { timing: TripTiming; breaks: DriverBreak[] } = { timing: DEFAULT_TIMING, breaks: [] },
  ) {
    const breaks = clock.breaks
      .map((b) => ({ start: b.start.getTime(), end: b.end.getTime() }))
      .sort((a, b) => a.start - b.start);
    let t = addWorkingTime(from.getTime(), 0, breaks);
    for (const stop of pending) {
      if (stop.travelSecondsFromPrevious == null) continue;
      const { deliveryWindowStart, deliveryWindowEnd } = stopTarget(stop);
      t = addWorkingTime(t, stop.travelSecondsFromPrevious * 1000, breaks);
      if (deliveryWindowStart && deliveryWindowStart.getTime() > t) {
        t = addWorkingTime(deliveryWindowStart.getTime(), 0, breaks);
      }
      const plannedEta = new Date(t);
      await this.prisma.routeStop.update({
        where: { id: stop.id },
        data: { plannedEta, ...this.rearmedAlerts(plannedEta, deliveryWindowEnd) },
      });
      t = addWorkingTime(t, clock.timing.dwellSeconds * 1000, breaks);
    }
  }

  // New legs and ETAs for the pending stops in their current order, after a
  // change that leaves the cached ones describing a different trip. A route
  // with no ETAs (built by hand) stays that way. Falls back to the cached legs
  // if OSRM can't answer. Best-effort: never fails the change that caused it.
  private async refreshEtas(routeId: string, at = new Date()) {
    try {
      const route = await this.prisma.route.findUnique({
        where: { id: routeId },
        select: {
          organizationId: true,
          teamId: true,
          routeDate: true,
          status: true,
          plannedDepartureAt: true,
          stops: { select: stopSelect, orderBy: { sequence: 'asc' } },
        },
      });
      if (!route || route.status === RouteStatus.COMPLETED || route.status === RouteStatus.CANCELLED) return;
      const clock = await this.routeClock(route);
      const pending = route.stops.filter((s) => this.stopStatus(s) === 'PENDING');
      if (!pending.some((s) => s.plannedEta)) return;

      const underway = pending.length < route.stops.length;
      const departAt = underway
        ? at
        : new Date(Math.max(at.getTime(), route.plannedDepartureAt?.getTime() ?? 0));

      const start = await this.getStartPoint(route.organizationId);
      try {
        const position = this.whereabouts(route, start)?.position;
        if (!position) throw new Error('Route has no start point');
        const jobs = pending
          .map(optimizerJob)
          .filter((j): j is typeof j & { location: { lat: number; lng: number } } => j.location != null);
        const scheduled = new Map(
          (
            await this.optimizer.scheduleFixedOrder(
              { lat: position.latitude, lng: position.longitude },
              departAt,
              jobs,
              clock,
            )
          ).map((s) => [s.key, s]),
        );
        await this.prisma.$transaction(
          pending.map((stop) => {
            const next = scheduled.get(stop.id);
            const plannedEta = next?.eta ?? null;
            return this.prisma.routeStop.update({
              where: { id: stop.id },
              data: {
                plannedEta,
                travelSecondsFromPrevious: next?.leg?.durationSeconds ?? null,
                travelMetersFromPrevious: next?.leg?.distanceMeters ?? null,
                ...this.rearmedAlerts(plannedEta, stopTarget(stop).deliveryWindowEnd),
              },
            });
          }),
        );
      } catch (err) {
        this.logger.warn(`Using cached legs for route ${routeId}: ${err instanceof Error ? err.message : String(err)}`);
        await this.walkCachedLegs(pending, departAt, clock);
      }
    } catch (err) {
      this.logger.warn(`Could not refresh ETAs for route ${routeId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // For the route planner: a reused route keeps its customer stops after the
  // planned ones, and their legs and ETAs still describe the old trip.
  async refreshRouteEtas(routeId: string) {
    await this.refreshEtas(routeId);
  }

  // Which late/at-risk alerts a new ETA re-arms. One still true stays
  // sent, so a missed window doesn't alert again after every later stop.
  private rearmedAlerts(plannedEta: Date | null, deliveryWindowEnd: Date | null) {
    const l = this.lateness('PENDING', plannedEta, deliveryWindowEnd);
    return {
      lateNotifiedAt: l === 'LATE' ? undefined : null,
      atRiskNotifiedAt: l ? undefined : null,
    };
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
      await lockRoute(tx, routeId);
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
        // last first: @@unique([routeId, sequence]) is checked row by row,
        // so one updateMany increment collides with the stop ahead of it.
        const after = await tx.routeStop.findMany({
          where: { routeId, sequence: { gte: dto.sequence } },
          select: { id: true, sequence: true },
          orderBy: { sequence: 'desc' },
        });
        for (const s of after) {
          await tx.routeStop.update({ where: { id: s.id }, data: { sequence: s.sequence + 1 } });
        }
      }

      return tx.routeStop.create({ data: { routeId, sequence, ...target } });
    });
    const moved = await this.putHighPriorityFirst(routeId);
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
    await this.refreshEtas(routeId);
    return moved ? this.prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } }) : stop;
  }

  // Among the stops still to do, HIGH first; finished stops hold their place.
  private pendingHighFirst<T extends StopRow>(stops: T[]) {
    return highPriorityFirst(stops, (s) => stopTarget(s).priority, (s) => this.isPending(s));
  }

  private isPending(stop: StopRow) {
    return this.stopStatus(stop) === 'PENDING';
  }

  // Rewrites the order if a pending HIGH stop sits below a pending normal one.
  // True if anything moved; cached legs and ETAs are then stale. The change that
  // led here has already saved, so a failure is logged and never undoes or
  // fails it. A later reorder or edit puts the order right.
  private async putHighPriorityFirst(routeId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockRoute(tx, routeId);
        const stops = await tx.routeStop.findMany({
          where: { routeId },
          select: stopSelect,
          orderBy: { sequence: 'asc' },
        });
        const ordered = this.pendingHighFirst(stops);
        const moves = ordered
          .map((s, i) => ({ id: s.id, sequence: stops[i].sequence }))
          .filter((move, i) => move.id !== stops[i].id);
        if (moves.length === 0) return false;
        await writeStopSequences(tx, moves);
        return true;
      });
    } catch (err) {
      this.logger.warn(`Could not put HIGH stops first on route ${routeId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  // After something outside the stop list changed a stop's priority or put a
  // route back in play. A closed route keeps the order it was run in. True if
  // the stops moved; the driver only hears about it then. Best-effort, like
  // putHighPriorityFirst.
  async applyPriorityOrder(organizationId: string, routeId: string, userId?: string) {
    try {
      const route = await this.prisma.route.findFirst({
        where: { id: routeId, organizationId },
        select: { teamId: true, status: true },
      });
      if (!route || route.status === RouteStatus.COMPLETED || route.status === RouteStatus.CANCELLED) {
        return false;
      }
      if (!(await this.putHighPriorityFirst(routeId))) return false;
      await this.recordHistory(routeId, RouteHistoryEventType.STOPS_REORDERED, userId, {
        priorityOrder: true,
      });
      if (route.status === RouteStatus.ACTIVE) {
        await this.notifyTeam(
          organizationId,
          route.teamId,
          'ROUTE_STOPS_CHANGED',
          'Your route order was changed',
          routeId,
        );
      }
      await this.refreshEtas(routeId);
      return true;
    } catch (err) {
      this.logger.warn(`Could not apply priority order on route ${routeId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  // A delivery order's priority or window was edited. Only its live stop cares:
  // a rescheduled DO's old stop is finished history. Same follow-up as editing a
  // customer stop. The edit has already saved, so this never fails it.
  async afterDeliveryOrderDetailsChanged(
    organizationId: string,
    deliveryOrderId: string,
    changed: { priority: boolean; window: boolean },
    userId?: string,
  ) {
    try {
      const stop = await this.prisma.routeStop.findUnique({
        where: { activeDeliveryOrderId: deliveryOrderId },
        select: { id: true, routeId: true },
      });
      if (!stop) return;
      if (changed.window) {
        // Both checks depend on the window — re-arm their alerts.
        await this.prisma.routeStop.update({
          where: { id: stop.id },
          data: { atRiskNotifiedAt: null, lateNotifiedAt: null },
        });
      }
      const moved =
        changed.priority && (await this.applyPriorityOrder(organizationId, stop.routeId, userId));
      if (!moved && changed.window) await this.refreshEtas(stop.routeId);
    } catch (err) {
      this.logger.warn(`Could not follow up details of delivery order ${deliveryOrderId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // What a new stop points at. With INVOICE_POS every delivery goes out
  // on a delivery order, so a stop must be one. Without it, a stop is a
  // customer — or a DO, if the org has them anyway (e.g.
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
    // An unpinned customer can still be visited: the stop starts without a
    // pin (set it per-route, or the driver's GPS fills it on delivery), it
    // just can't be optimized until then.
    const site = await this.resolveStopSite(organizationId, customer, dto.customerAddressId);
    // Same customer at two different sites on one route is fine; the same
    // site twice needs the office to have confirmed it (route page).
    const duplicate = dto.allowDuplicate ? null : await this.prisma.routeStop.findFirst({
      where: {
        routeId,
        customerId: customer.id,
        customerAddressId: site.customerAddressId,
        signedAt: null,
        failedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(
        `${customer.name}${site.addressLabel ? ` (${site.addressLabel})` : ''} is already a pending stop on this route`,
      );
    }
    return {
      customerId: customer.id,
      customerName: customer.name,
      ...site,
      priority: dto.priority ?? DeliveryPriority.NORMAL,
      deliveryWindowStart: dto.deliveryWindowStart
        ? new Date(dto.deliveryWindowStart)
        : null,
      deliveryWindowEnd: dto.deliveryWindowEnd ? new Date(dto.deliveryWindowEnd) : null,
    };
  }

  // Address text + pin a customer stop snapshots: the customer's main ones,
  // or one of their saved addresses (CustomerAddress).
  private async resolveStopSite(
    organizationId: string,
    customer: {
      id: string;
      address: string | null;
      latitude: Prisma.Decimal | null;
      longitude: Prisma.Decimal | null;
    },
    customerAddressId?: string | null,
  ) {
    if (!customerAddressId) {
      return {
        customerAddressId: null,
        addressLabel: null,
        address: customer.address,
        destinationLatitude: customer.latitude,
        destinationLongitude: customer.longitude,
      };
    }
    const saved = await this.prisma.customerAddress.findFirst({
      where: { id: customerAddressId, organizationId, customerId: customer.id },
    });
    if (!saved) {
      throw new BadRequestException("Saved address not found for this stop's customer");
    }
    return {
      customerAddressId: saved.id,
      addressLabel: saved.label,
      address: saved.address,
      destinationLatitude: saved.latitude,
      destinationLongitude: saved.longitude,
    };
  }

  // Points a pending customer stop at one of the customer's saved
  // addresses, or back to their main address (customerAddressId omitted):
  // address text, name and pin all change together. A DO stop changes
  // address on its delivery order instead.
  async applyStopAddress(
    organizationId: string,
    routeId: string,
    stopId: string,
    customerAddressId: string | undefined,
    userId?: string,
  ) {
    const stop = await this.prisma.routeStop.findFirst({
      where: { id: stopId, routeId, route: { organizationId } },
      select: {
        id: true,
        customerId: true,
        deliveryOrderId: true,
        supersededAt: true,
        signedAt: true,
        failedAt: true,
        deliveryOrder: { select: { status: true, signedAt: true } },
        route: { select: { status: true, teamId: true } },
      },
    });
    if (!stop) throw new NotFoundException('Stop not found');
    if (stop.deliveryOrderId || !stop.customerId) {
      throw new BadRequestException(
        'This stop is a delivery order — change the address on the delivery order',
      );
    }
    this.assertRouteOpen(stop.route);
    if (this.stopStatus(stop) !== 'PENDING') {
      throw new BadRequestException('This stop is already resolved');
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: stop.customerId, organizationId },
      select: { id: true, name: true, address: true, latitude: true, longitude: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const site = await this.resolveStopSite(organizationId, customer, customerAddressId);
    const duplicate = await this.prisma.routeStop.findFirst({
      where: {
        routeId,
        id: { not: stopId },
        customerId: customer.id,
        customerAddressId: site.customerAddressId,
        signedAt: null,
        failedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(
        `${customer.name}${site.addressLabel ? ` (${site.addressLabel})` : ''} is already a pending stop on this route`,
      );
    }
    await this.prisma.routeStop.update({ where: { id: stopId }, data: site });
    await this.recordHistory(routeId, RouteHistoryEventType.START_SET, userId, {
      stopId,
      stopDestination: true,
      customerAddressId: site.customerAddressId,
      addressLabel: site.addressLabel,
    });
    if (stop.route.status === RouteStatus.ACTIVE) {
      await this.notifyTeam(
        organizationId,
        stop.route.teamId,
        'ROUTE_STOPS_CHANGED',
        "A stop's address on your route was changed",
        routeId,
      );
    }
    await this.refreshEtas(routeId);
    return this.getRoute(organizationId, routeId);
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
    await this.refreshEtas(routeId);
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
        customerAddressId: true,
        deliveryOrderId: true,
        signedAt: true,
        failedAt: true,
        proofPhotoKey: true,
        proofPhotoTakenAt: true,
        proofPhotoLatitude: true,
        proofPhotoLongitude: true,
        proofPhotoAccuracy: true,
        proofPhotoLocationAt: true,
        failurePhotoKey: true,
        route: {
          select: {
            status: true,
            routeDate: true,
            organization: { select: { timezone: true } },
          },
        },
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

  // Undoes what was recorded on a stop, for a slip like the wrong photo or
  // "delivered" tapped by mistake: back to still-to-do. Works for both stop
  // kinds, and for a photo sent but never confirmed. The attempt itself is
  // evidence, so nothing of it is deleted: its photos stay in storage and the
  // history entry keeps them, with where and when they were taken, for the
  // office to open (getHistoryPhotoKey). A customer pin the delivery set goes
  // back with it. A driver can only do this on their own team's open route.
  async resetStopResult(
    organizationId: string,
    routeId: string,
    stopId: string,
    requester: Requester,
  ) {
    const isDriver = requester.role === 'DRIVER';
    const { stop, view, evidence, reopened } = await this.prisma.$transaction(
      async (tx) => {
        await lockRoute(tx, routeId);
        const stop = await tx.routeStop.findFirst({
          where: { id: stopId, routeId, route: { organizationId, ...this.routeScope(requester) } },
          select: {
            ...stopSelect,
            route: {
              select: {
                status: true,
                teamId: true,
                routeDate: true,
                organization: { select: { timezone: true } },
              },
            },
          },
        });
        if (!stop) throw new NotFoundException('Stop not found');
        if (stop.route.status === RouteStatus.CANCELLED) {
          throw new BadRequestException('This route was cancelled');
        }
        if (isDriver && stop.route.status === RouteStatus.COMPLETED) {
          throw new BadRequestException('This route is closed — ask the office to reset this stop');
        }
        assertDriverCatchUpWindow(stop.route, requester.role);
        if (stop.supersededAt) {
          throw new BadRequestException('This stop was rescheduled — reset the new stop instead');
        }
        const view = this.presentStop(stop);
        if (view.status === 'PENDING' && !view.hasProofPhoto && !view.pendingReceivedBy) {
          throw new BadRequestException('This stop has nothing to reset');
        }

        const emptyProof = {
          receivedBy: null,
          signedAt: null,
          proofPhotoKey: null,
          proofPhotoTakenAt: null,
          proofPhotoLatitude: null,
          proofPhotoLongitude: null,
          proofPhotoAccuracy: null,
          proofPhotoLocationAt: null,
          pendingReceivedBy: null,
          completedLatitude: null,
          completedLongitude: null,
          completedAccuracy: null,
          completedLocationAt: null,
          deliveredWithoutGps: false,
          failedAt: null,
          failureReason: null,
          failureLatitude: null,
          failureLongitude: null,
          failurePhotoKey: null,
        };
        const d = stop.deliveryOrder;
        if (d) {
          if (d.status !== DeliveryOrderStatus.SHIPPED && d.status !== DeliveryOrderStatus.FAILED) {
            // Goods came back: that's a stock movement this can't undo.
            throw new BadRequestException('This delivery was already returned or closed, so it cannot be reset');
          }
          await tx.deliveryOrder.update({
            where: { id: d.id },
            data: {
              ...emptyProof,
              status: DeliveryOrderStatus.SHIPPED,
              deliveredBy: null,
              proofPhotoUrl: null, // legacy link; the file stays in the media library
            },
          });
        }
        await tx.routeStop.update({
          where: { id: stopId },
          data: {
            ...(d ? {} : { ...emptyProof, completedByUserId: null }),
            markedByOfficeAt: null,
            officeNote: null,
            // It's a live stop again, so its alerts can fire again.
            atRiskNotifiedAt: null,
            lateNotifiedAt: null,
          },
        });
        // A closed route with work on it again would never get done.
        const reopened = stop.route.status === RouteStatus.COMPLETED;
        if (reopened) {
          await tx.route.update({ where: { id: routeId }, data: { status: RouteStatus.ACTIVE } });
        }
        const source = d ?? stop;
        return { stop, view, reopened, evidence: keptEvidence(source) };
      },
      { timeout: LONG_TX_MS },
    );

    await this.recordHistory(routeId, RouteHistoryEventType.STOP_RESET, requester.sub, {
      stopId,
      label: view.label,
      previousStatus: view.status,
      receivedBy: view.receivedBy ?? view.pendingReceivedBy,
      signedAt: view.signedAt,
      failedAt: view.failedAt,
      failureReason: view.failureReason,
      evidence,
      byRole: requester.role,
    });
    if (reopened) {
      await this.recordHistory(routeId, RouteHistoryEventType.STATUS_CHANGED, requester.sub, {
        to: RouteStatus.ACTIVE,
        reason: 'stop reset',
      });
    }
    // The change has saved; none of this may fail it.
    try {
      const d = stop.deliveryOrder;
      await releaseCustomerPin(this.prisma, {
        organizationId,
        customerId: d ? d.customerId : stop.customerId,
        customerAddressId: d ? null : stop.customerAddressId,
        deliveryAddress: d ? d.deliveryAddress : stop.address,
        latitude: evidence.completedLatitude,
        longitude: evidence.completedLongitude,
      });
    } catch (err) {
      this.logger.warn(`Could not release the pin of reset stop ${stopId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const title = `A delivery result was reset: ${view.label}`;
      if (isDriver) {
        await this.notifications.notifyOrgStaff(organizationId, 'ROUTE_STOPS_CHANGED', title, {
          link: `/delivery/routes/${routeId}`,
          payload: { routeId },
        });
      } else if (stop.route.status === RouteStatus.ACTIVE || reopened) {
        await this.notifyTeam(organizationId, stop.route.teamId, 'ROUTE_STOPS_CHANGED', title, routeId);
      }
      await this.putHighPriorityFirst(routeId);
      await this.refreshEtas(routeId);
    } catch (err) {
      this.logger.warn(`Could not follow up reset of stop ${stopId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { landmarkSource: stop.deliveryOrder?.id ?? stop.id };
  }

  // For a driver who recorded a delivery on the wrong stop: everything the
  // attempt recorded (receiver, times, GPS, photos, or the failure) moves to
  // the stop it belonged to, on the same route, and the wrong stop is to-do
  // again. When the right stop has a result of its own, the two swap (photos
  // switched between two stops). Nothing is deleted or retaken: the photos
  // keep the time and place they were taken. Customer stops only — a delivery
  // order's result belongs to that order and its goods.
  // The customer location photo copied from the proof follows when the right
  // customer has none of their own (else it's dropped: StopProofService
  // deletes deleteKeys), and so does the GPS pin the delivery set.
  // Same permissions as resetStopResult.
  async moveStopResult(
    organizationId: string,
    routeId: string,
    fromStopId: string,
    toStopId: string,
    requester: Requester,
  ) {
    if (fromStopId === toStopId) throw new BadRequestException('Pick a different stop');
    const isDriver = requester.role === 'DRIVER';
    const { from, to, fromView, toView, swapped, reopened, deleteKeys, teamId, routeStatus } =
      await this.prisma.$transaction(
        async (tx) => {
          await lockRoute(tx, routeId);
          const rows = await tx.routeStop.findMany({
            where: {
              id: { in: [fromStopId, toStopId] },
              routeId,
              route: { organizationId, ...this.routeScope(requester) },
            },
            select: {
              ...stopSelect,
              deliveryOrderId: true,
              completedByUserId: true,
              route: {
                select: {
                  status: true,
                  teamId: true,
                  routeDate: true,
                  organization: { select: { timezone: true } },
                },
              },
            },
          });
          const from = rows.find((r) => r.id === fromStopId);
          const to = rows.find((r) => r.id === toStopId);
          if (!from || !to) throw new NotFoundException('Stop not found');
          const route = from.route;
          if (route.status === RouteStatus.CANCELLED) {
            throw new BadRequestException('This route was cancelled');
          }
          if (isDriver && route.status === RouteStatus.COMPLETED) {
            throw new BadRequestException('This route is closed — ask the office to move this result');
          }
          assertDriverCatchUpWindow(route, requester.role);
          for (const s of [from, to]) {
            if (s.deliveryOrderId) {
              throw new BadRequestException(
                "Only customer stops can be moved — a delivery order's result belongs to that order",
              );
            }
            if (s.supersededAt) {
              throw new BadRequestException('One of these stops was rescheduled — use the new stop instead');
            }
          }
          const fromView = this.presentStop(from);
          const toView = this.presentStop(to);
          const hasResult = (v: typeof fromView) =>
            v.status !== 'PENDING' || v.hasProofPhoto || !!v.pendingReceivedBy;
          if (!hasResult(fromView)) throw new BadRequestException('This stop has nothing to move');
          const swapped = hasResult(toView);

          const result = (s: typeof from) => ({
            receivedBy: s.receivedBy,
            signedAt: s.signedAt,
            proofPhotoKey: s.proofPhotoKey,
            proofPhotoTakenAt: s.proofPhotoTakenAt,
            proofPhotoLatitude: s.proofPhotoLatitude,
            proofPhotoLongitude: s.proofPhotoLongitude,
            proofPhotoAccuracy: s.proofPhotoAccuracy,
            proofPhotoLocationAt: s.proofPhotoLocationAt,
            pendingReceivedBy: s.pendingReceivedBy,
            completedByUserId: s.completedByUserId,
            completedLatitude: s.completedLatitude,
            completedLongitude: s.completedLongitude,
            completedAccuracy: s.completedAccuracy,
            completedLocationAt: s.completedLocationAt,
            deliveredWithoutGps: s.deliveredWithoutGps,
            failedAt: s.failedAt,
            failureReason: s.failureReason,
            failureLatitude: s.failureLatitude,
            failureLongitude: s.failureLongitude,
            failurePhotoKey: s.failurePhotoKey,
            markedByOfficeAt: s.markedByOfficeAt,
            officeNote: s.officeNote,
          });
          const empty = {
            ...Object.fromEntries(Object.keys(result(from)).map((k) => [k, null])),
            deliveredWithoutGps: false,
          };

          // Location photos first, while each still says which proof it came from.
          const pair = [from.id, to.id];
          const landmarks = await tx.customerLocationPhoto.findMany({
            where: { organizationId, fromProofOf: { in: pair } },
            select: { id: true, storageKey: true, fromProofOf: true },
          });
          const deleteKeys: string[] = [];
          const moves: [typeof from, typeof from][] = swapped ? [[from, to], [to, from]] : [[from, to]];
          for (const [src, dst] of moves) {
            const landmark = landmarks.find((l) => l.fromProofOf === src.id);
            if (!landmark) continue;
            const ownPhotos = dst.customerId
              ? await tx.customerLocationPhoto.count({
                  where: {
                    organizationId,
                    customerId: dst.customerId,
                    OR: [{ fromProofOf: null }, { fromProofOf: { notIn: pair } }],
                  },
                })
              : 1;
            if (ownPhotos === 0) {
              await tx.customerLocationPhoto.update({
                where: { id: landmark.id },
                data: { customerId: dst.customerId!, fromProofOf: dst.id },
              });
            } else {
              await tx.customerLocationPhoto.delete({ where: { id: landmark.id } });
              deleteKeys.push(landmark.storageKey);
            }
          }

          await tx.routeStop.update({ where: { id: to.id }, data: result(from) });
          await tx.routeStop.update({
            where: { id: from.id },
            data: swapped
              ? result(to)
              : { ...empty, atRiskNotifiedAt: null, lateNotifiedAt: null },
          });
          // A closed route with work on it again would never get done.
          const reopened = !swapped && route.status === RouteStatus.COMPLETED;
          if (reopened) {
            await tx.route.update({ where: { id: routeId }, data: { status: RouteStatus.ACTIVE } });
          }
          return {
            from,
            to,
            fromView,
            toView,
            swapped,
            reopened,
            deleteKeys,
            teamId: route.teamId,
            routeStatus: route.status,
          };
        },
        { timeout: LONG_TX_MS },
      );

    await this.recordHistory(routeId, RouteHistoryEventType.STOP_RESULT_MOVED, requester.sub, {
      fromStopId: from.id,
      label: fromView.label,
      toStopId: to.id,
      toLabel: toView.label,
      swapped,
      movedStatus: fromView.status,
      receivedBy: fromView.receivedBy ?? fromView.pendingReceivedBy,
      evidence: keptEvidence(from),
      ...(swapped ? { swappedEvidence: keptEvidence(to) } : {}),
      byRole: requester.role,
    });
    if (reopened) {
      await this.recordHistory(routeId, RouteHistoryEventType.STATUS_CHANGED, requester.sub, {
        to: RouteStatus.ACTIVE,
        reason: 'stop result moved',
      });
    }
    // The change has saved; none of this may fail it.
    const travels: [typeof from, typeof from][] = swapped ? [[from, to], [to, from]] : [[from, to]];
    for (const [src] of travels) {
      try {
        await releaseCustomerPin(this.prisma, {
          organizationId,
          customerId: src.customerId,
          customerAddressId: src.customerAddressId,
          deliveryAddress: src.address,
          latitude: src.completedLatitude,
          longitude: src.completedLongitude,
        });
      } catch (err) {
        this.logger.warn(`Could not release the pin of stop ${src.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (const [src, dst] of travels) {
      if (src.completedLatitude == null || src.completedLongitude == null) continue;
      try {
        await backfillCustomerPin(this.prisma, {
          organizationId,
          customerId: dst.customerId,
          customerAddressId: dst.customerAddressId,
          deliveryAddress: dst.address,
          latitude: Number(src.completedLatitude),
          longitude: Number(src.completedLongitude),
          accuracy: src.completedAccuracy ?? undefined,
          timely: fixIsTimely(src.completedLocationAt, src.proofPhotoTakenAt),
          deliveredAt: src.signedAt ?? undefined,
        });
      } catch (err) {
        this.logger.warn(`Could not pin stop ${dst.id} from moved result: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      const title = swapped
        ? `Delivery results swapped: ${fromView.label} ⇄ ${toView.label}`
        : `A delivery result was moved: ${fromView.label} → ${toView.label}`;
      if (isDriver) {
        await this.notifications.notifyOrgStaff(organizationId, 'ROUTE_STOPS_CHANGED', title, {
          link: `/delivery/routes/${routeId}`,
          payload: { routeId },
        });
      } else if (routeStatus === RouteStatus.ACTIVE || reopened) {
        await this.notifyTeam(organizationId, teamId, 'ROUTE_STOPS_CHANGED', title, routeId);
      }
      await this.putHighPriorityFirst(routeId);
      await this.refreshEtas(routeId);
    } catch (err) {
      this.logger.warn(`Could not follow up move of stop ${fromStopId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { deleteKeys };
  }

  // The storage key of a photo a history entry kept (a reset or moved
  // result), checked to be this organization's delivery photo.
  async getHistoryPhotoKey(
    organizationId: string,
    routeId: string,
    eventId: string,
    kind: 'proof' | 'failure',
  ) {
    const event = await this.prisma.routeHistoryEvent.findFirst({
      where: { id: eventId, routeId, route: { organizationId } },
      select: { metadata: true },
    });
    if (!event) throw new NotFoundException('History entry not found');
    const evidence = (event.metadata as { evidence?: Record<string, unknown> } | null)?.evidence;
    const key = evidence?.[kind === 'failure' ? 'failurePhotoKey' : 'proofPhotoKey'];
    const ours =
      typeof key === 'string' &&
      (key.startsWith(`stop-proofs/${organizationId}/`) || key.startsWith(`delivery-proofs/${organizationId}/`));
    if (!ours) throw new NotFoundException('This history entry has no such photo');
    return key;
  }

  async recordCustomerStopProof(
    organizationId: string,
    routeId: string,
    stopId: string,
    params: {
      receivedBy: string;
      signedAt?: string;
      latitude?: number;
      longitude?: number;
      accuracy?: number;
      locationAt?: string;
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
    assertDriverCatchUpWindow(stop.route, requester.role);
    if (!stop.proofPhotoKey) {
      throw new BadRequestException('Take a proof photo before completing the stop');
    }
    // The delivery happened where and when the photo was taken. A driver's
    // delivery always takes the reading that came with the photo: the phone
    // only sends its own when it lost that one, and then it's a reading from
    // wherever Done was tapped. Office staff may send a location on purpose.
    const isDriver = requester.role === 'DRIVER';
    const fromPhoto =
      stop.proofPhotoLatitude != null && (isDriver || params.latitude == null);
    if (fromPhoto) {
      params = {
        ...params,
        latitude: Number(stop.proofPhotoLatitude),
        longitude: Number(stop.proofPhotoLongitude),
        accuracy: stop.proofPhotoAccuracy ?? undefined,
        locationAt: stop.proofPhotoLocationAt?.toISOString(),
      };
    }
    const requested = params.signedAt
      ? new Date(params.signedAt)
      : (stop.proofPhotoTakenAt ?? undefined);
    const signedAt = isDriver
      ? driverSignedAt(requested, routeDayStart(stop.route))
      : (requested ?? new Date());
    // Stored photo times are on the server's clock already; a reading sent
    // now is on the phone's, moved like the signing time was.
    const locationAt = !params.locationAt
      ? undefined
      : fromPhoto || !isDriver
        ? params.locationAt
        : onServerClock(new Date(params.locationAt), requested, signedAt).toISOString();
    params = { ...params, locationAt };
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
        completedLocationAt:
          params.latitude != null && params.locationAt ? new Date(params.locationAt) : null,
        deliveredWithoutGps: deliveredWithoutGps(isDriver, params.latitude, params.longitude),
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException('This stop is already resolved');
    }
    try {
      await backfillCustomerPin(this.prisma, {
        organizationId,
        customerId: stop.customerId,
        customerAddressId: stop.customerAddressId,
        deliveryAddress: stop.address,
        latitude: params.latitude,
        longitude: params.longitude,
        accuracy: params.accuracy,
        timely: fixIsTimely(params.locationAt, fromPhoto ? stop.proofPhotoTakenAt : signedAt),
        deliveredAt: signedAt,
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
    assertDriverCatchUpWindow(stop.route, requester.role);
    assertDriverFailureReason(params.reason, requester.role);
    const failedAt = new Date();
    // A photo taken at the stop becomes the failed attempt's photo, and
    // its GPS the failure's location if the phone sent none.
    const photoFix =
      params.latitude == null && stop.proofPhotoLatitude != null
        ? {
            latitude: Number(stop.proofPhotoLatitude),
            longitude: Number(stop.proofPhotoLongitude),
          }
        : { latitude: params.latitude, longitude: params.longitude };
    const claim = await this.prisma.routeStop.updateMany({
      where: { id: stopId, signedAt: null, failedAt: null },
      data: {
        failedAt,
        failureReason: params.reason?.trim() || null,
        failureLatitude: photoFix.latitude ?? null,
        failureLongitude: photoFix.longitude ?? null,
        completedByUserId: requester.sub,
        ...movePhotoToFailure(stop.proofPhotoKey),
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

  // An admin settles a stop from the office, for when the driver couldn't
  // (dead phone, no signal, paper proof). No photo or GPS needed. Works on
  // both stop kinds: a DO stop's result goes on its DO as usual. The stop
  // is flagged so every screen can say the office set it.
  async markStopByOffice(
    organizationId: string,
    routeId: string,
    stopId: string,
    params: { result: 'DELIVERED' | 'FAILED'; receivedBy?: string; reason?: string; note?: string },
    requester: Requester,
  ) {
    const stop = await this.prisma.routeStop.findFirst({
      where: { id: stopId, routeId, route: { organizationId } },
      select: {
        id: true,
        routeId: true,
        sequence: true,
        customerName: true,
        supersededAt: true,
        signedAt: true,
        failedAt: true,
        proofPhotoKey: true,
        route: { select: { status: true } },
        deliveryOrder: {
          select: {
            id: true,
            status: true,
            signedAt: true,
            proofPhotoKey: true,
            customerName: true,
            doNumber: true,
          },
        },
      },
    });
    if (!stop) throw new NotFoundException('Stop not found');
    if (stop.route.status === RouteStatus.CANCELLED) {
      throw new BadRequestException('This route was cancelled');
    }
    if (this.stopStatus(stop) !== 'PENDING') {
      throw new BadRequestException('This stop is already resolved');
    }
    const at = new Date();
    const receivedBy = params.receivedBy?.trim() || null;
    const reason = params.reason?.trim() || null;
    const officeNote = params.note?.trim() || null;
    const d = stop.deliveryOrder;

    await this.prisma.$transaction(async (tx) => {
      if (d) {
        // Same claims as the DO's own proof/failure: only a shipped,
        // not-yet-signed DO.
        const claim = await tx.deliveryOrder.updateMany({
          where: { id: d.id, organizationId, status: DeliveryOrderStatus.SHIPPED, signedAt: null },
          data:
            params.result === 'DELIVERED'
              ? { receivedBy, signedAt: at }
              : {
                  status: DeliveryOrderStatus.FAILED,
                  failedAt: at,
                  failureReason: reason,
                  ...movePhotoToFailure(d.proofPhotoKey),
                },
        });
        if (claim.count === 0) throw new BadRequestException('This stop is already resolved');
        await tx.routeStop.update({ where: { id: stopId }, data: { markedByOfficeAt: at, officeNote } });
        return;
      }
      const claim = await tx.routeStop.updateMany({
        where: { id: stopId, signedAt: null, failedAt: null },
        data: {
          completedByUserId: requester.sub,
          markedByOfficeAt: at,
          officeNote,
          ...(params.result === 'DELIVERED'
            ? { receivedBy, signedAt: at, pendingReceivedBy: null }
            : { failedAt: at, failureReason: reason, ...movePhotoToFailure(stop.proofPhotoKey) }),
        },
      });
      if (claim.count === 0) throw new BadRequestException('This stop is already resolved');
    });

    try {
      await this.recalculateEtasAfter(stop, at);
    } catch {
      // best-effort, same as the driver's path
    }
    if (params.result === 'FAILED') {
      try {
        await this.notifications.notifyOrgStaff(
          organizationId,
          'DELIVERY_FAILED',
          `Delivery failed (set by office): ${d ? (d.customerName ?? d.doNumber ?? stopId) : (stop.customerName ?? stopId)}`,
          { link: `/delivery/routes/${routeId}`, payload: { routeId, stopId } },
        );
      } catch {
        // the result is saved; a notification hiccup mustn't undo the reply
      }
    }
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
    userId?: string,
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
    // undefined = leave as it is, null = clear it.
    const windowEdge = (value: string | null | undefined, kept: Date | null) =>
      value === undefined ? kept : value === null ? null : new Date(value);
    const start = windowEdge(dto.deliveryWindowStart, current.deliveryWindowStart);
    const end = windowEdge(dto.deliveryWindowEnd, current.deliveryWindowEnd);
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
    // Refreshes ETAs itself if the stops moved. Otherwise still needed: a stop
    // waits for its window to open.
    if (!(await this.applyPriorityOrder(organizationId, routeId, userId))) {
      await this.refreshEtas(routeId);
    }
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
          customerAddressId: stop.customerAddressId,
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
      await lockRoute(tx, target.id);
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
          customerAddressId: stop.customerAddressId,
          addressLabel: stop.addressLabel,
          destinationLatitude: stop.destinationLatitude,
          destinationLongitude: stop.destinationLongitude,
          priority: stop.priority,
          deliveryWindowStart: start,
          deliveryWindowEnd: end,
        },
      });
    });

    await this.putHighPriorityFirst(target.id);
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
    await this.refreshEtas(target.id);
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
      select: { id: true },
    });
    if (!route) throw new NotFoundException('Route not found');
    if (new Set(dto.stops.map((s) => s.sequence)).size !== dto.stops.length) {
      throw new BadRequestException('Two stops cannot share the same position');
    }

    // Under the route lock, so what's checked is still true when it's written.
    const { teamId, status } = await this.prisma.$transaction(
      async (tx) => {
        await lockRoute(tx, routeId);
        const current = await tx.route.findUniqueOrThrow({
          where: { id: routeId },
          include: { stops: { select: stopSelect, orderBy: { sequence: 'asc' } } },
        });
        this.assertRouteOpen(current);
        if (dto.expectedVersion != null && dto.expectedVersion !== current.version) {
          throw new ConflictException('This route was changed elsewhere — reload it and try again');
        }

        const stopById = new Map(current.stops.map((s) => [s.id, s]));
        const wanted = new Map(dto.stops.map((s) => [s.stopId, s.sequence]));
        if (
          wanted.size !== stopById.size ||
          [...stopById.keys()].some((id) => !wanted.has(id))
        ) {
          throw new ConflictException(
            'The reorder list must include every stop on this route exactly once',
          );
        }
        if (current.stops.some((s) => !this.isPending(s) && wanted.get(s.id) !== s.sequence)) {
          // Usually a driver finishing the stop while the office was dragging it.
          throw new ConflictException('A finished stop keeps its place on the route');
        }
        const newOrder = [...dto.stops]
          .sort((a, b) => a.sequence - b.sequence)
          .map((s) => stopById.get(s.stopId)!);
        const inversions = (stops: StopRow[]) =>
          priorityInversions(stops, (s) => stopTarget(s).priority, (s) => this.isPending(s));
        if (inversions(newOrder) > inversions(current.stops)) {
          throw new BadRequestException('HIGH priority stops must stay above normal stops');
        }

        await writeStopSequences(
          tx,
          dto.stops.map((s) => ({ id: s.stopId, sequence: s.sequence })),
        );
        return current;
      },
      { timeout: LONG_TX_MS },
    );
    await this.recordHistory(
      routeId,
      RouteHistoryEventType.STOPS_REORDERED,
      userId,
    );
    if (status === RouteStatus.ACTIVE) {
      await this.notifyTeam(
        organizationId,
        teamId,
        'ROUTE_STOPS_CHANGED',
        'Your route order was changed',
        routeId,
      );
    }
    await this.refreshEtas(routeId);

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
    await this.refreshEtas(routeId);
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
    await this.refreshEtas(routeId);
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
    if (toRouteId) await this.refreshEtas(toRouteId);
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
      // Only what can still alert: the cap below is across every business, and
      // finished stops never clear these flags, so they'd crowd out late ones.
      where: {
        AND: [
          pendingStopWhere,
          { OR: [{ atRiskNotifiedAt: null }, { lateNotifiedAt: null }] },
          {
            OR: [
              { plannedEta: { not: null } },
              { deliveryWindowEnd: { not: null } },
              { deliveryOrder: { deliveryWindowEnd: { not: null } } },
            ],
          },
        ],
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
    const routeDate = date ?? (await this.orgToday(organizationId));
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
    const routeDate = date ?? (await this.orgToday(organizationId));
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
    const routeDate = date ?? (await this.orgToday(organizationId));
    const [routes, start] = await Promise.all([
      this.prisma.route.findMany({
        where: { organizationId, routeDate: this.dayRange(routeDate) },
        include: {
          team: { select: teamSelect },
          stops: { select: stopSelect },
        },
      }),
      this.getStartPoint(organizationId),
    ]);

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
      return {
        routeId: route.id,
        team: presentTeam(route.team),
        routeStatus: route.status,
        ...counts,
        ...this.whereabouts(route, start),
      };
    });
  }

  // Where the driver most likely is, without live tracking: the spot they
  // last resolved a stop (the GPS fix taken when they tapped delivered or
  // failed, else that stop's pin), or the depot if they haven't resolved
  // one yet. Plus the stop they're presumably heading to. The monitoring
  // page turns these into "last seen 25 min ago at X, next: Y".
  private whereabouts(
    route: { plannedDepartureAt: Date | null; stops: StopRow[] },
    start: { latitude: number; longitude: number } | null,
  ) {
    const stops = route.stops.map((stop) => this.presentStop(stop));
    const supersededAt = new Map(route.stops.map((s) => [s.id, s.supersededAt]));
    const resolved = stops
      // A retried delivery is PENDING but still carries its earlier failure.
      .filter((stop) => stop.status !== 'PENDING')
      // By outcome: a stop superseded by a retry still sees the DO's later signedAt.
      .map((stop) => ({ stop, at: stop.status === 'DELIVERED' ? stop.signedAt : failedBy(stop.failedAt, supersededAt.get(stop.id) ?? null) }))
      .filter((r): r is { stop: (typeof stops)[number]; at: Date } => r.at != null)
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    // Office-set results say nothing about where the driver was or how long
    // a stop took: skip them for the position and the durations.
    const last = resolved.find((r) => !r.stop.markedByOffice);

    const lastStop = last
      ? {
          label: last.stop.label,
          status: last.stop.status,
          failureReason: last.stop.status === 'FAILED' ? last.stop.failureReason : null,
          at: last.at,
          plannedEta: last.stop.plannedEta,
          ...latLng(
            last.stop.status === 'DELIVERED'
              ? [last.stop.completedLatitude, last.stop.completedLongitude]
              : [last.stop.failureLatitude, last.stop.failureLongitude],
            [last.stop.destinationLatitude, last.stop.destinationLongitude],
          ),
        }
      : null;

    const next = stops
      .filter((stop) => stop.status === 'PENDING')
      .sort((a, b) => a.sequence - b.sequence)[0];
    const nextStop = next
      ? {
          label: next.label,
          plannedEta: next.plannedEta,
          ...latLng([next.destinationLatitude, next.destinationLongitude]),
        }
      : null;

    // The way the driver has come so far, for a line on the monitoring map:
    // each stop they finished, in the order they finished it, at the GPS fix
    // taken there (else the stop's pin). Office-set results are left out —
    // the driver wasn't there.
    const trail = resolved
      .filter((r) => !r.stop.markedByOffice)
      .reverse()
      .map(({ stop }) =>
        latLng(
          stop.status === 'DELIVERED'
            ? [stop.completedLatitude, stop.completedLongitude]
            : [stop.failureLatitude, stop.failureLongitude],
          [stop.destinationLatitude, stop.destinationLongitude],
        ),
      )
      .filter((p): p is { latitude: number; longitude: number } => p.latitude != null && p.longitude != null);

    return {
      lastStop,
      nextStop,
      trail,
      plannedDepartureAt: route.plannedDepartureAt,
      // What's left, in route order, for the monitoring page.
      unfinished: stops
        .filter((stop) => stop.status === 'PENDING')
        .sort((a, b) => a.sequence - b.sequence)
        .map((stop) => ({
          stopId: stop.id,
          sequence: stop.sequence,
          label: stop.label,
          plannedEta: stop.plannedEta,
          late: stop.late,
          atRisk: stop.atRisk,
          // Photo sent, Done never tapped: the driver may well have been there.
          unconfirmed: stop.hasProofPhoto,
        })),
      timeline: (() => {
        const entry = ({ stop, at }: (typeof resolved)[number]) => ({
          stopId: stop.id,
          sequence: stop.sequence,
          label: stop.label,
          status: stop.status,
          failureReason: stop.status === 'FAILED' ? stop.failureReason : null,
          // The note an admin left when marking it delivered from the office.
          note: stop.status === 'DELIVERED' ? stop.officeNote : null,
          receivedBy: stop.status === 'DELIVERED' ? stop.receivedBy : null,
          markedByOffice: stop.markedByOffice,
          at,
        });
        const byDriver = completionTimeline(
          resolved.filter((r) => !r.stop.markedByOffice).map(entry),
          route.plannedDepartureAt,
        );
        const byOffice = resolved
          .filter((r) => r.stop.markedByOffice)
          .map((r) => ({ ...entry(r), durationSeconds: null }));
        return [...byDriver, ...byOffice].sort(
          (a, b) => a.at.getTime() - b.at.getTime() || a.sequence - b.sequence,
        );
      })(),
      // Best guess at the driver's position right now.
      position:
        lastStop?.latitude != null && lastStop.longitude != null
          ? { latitude: lastStop.latitude, longitude: lastStop.longitude, source: 'LAST_STOP' as const }
          : start
            ? { latitude: start.latitude, longitude: start.longitude, source: 'DEPOT' as const }
            : null,
    };
  }

  // Flattened, org-wide "today's stops" for the monitoring map — every
  // stop across every driver's route for the date, not grouped by route.
  // Falls back to the completed/failure pin when no destination pin was
  // ever set, so a resolved stop still shows up on the map even if
  // nobody set its destination beforehand.
  async monitoringMap(organizationId: string, date?: string) {
    const routeDate = date ?? (await this.orgToday(organizationId));
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
          failureReason: view.status === 'FAILED' ? view.failureReason : null,
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

// A DO stop's priority lives on its delivery order.
function stopPriority(stop: {
  priority: DeliveryPriority;
  deliveryOrder: { priority: DeliveryPriority } | null;
}) {
  return stop.deliveryOrder?.priority ?? stop.priority;
}

// A stop superseded by a retry reads its DO's failure time, which a later failed
// attempt elsewhere overwrites; this stop's own attempt ended by the reschedule.
function failedBy(failedAt: Date | null, supersededAt: Date | null) {
  return failedAt && supersededAt && supersededAt < failedAt ? supersededAt : failedAt;
}

// Serializes changes to one route's stop order: the two-phase renumbering would
// otherwise collide with another one on @@unique([routeId, sequence]).
// Serializes route creation for one team, so "one route per team per day"
// holds under concurrent requests (see assertTeamFreeOnDate).
function lockTeam(tx: Prisma.TransactionClient, teamId: string) {
  return tx.$queryRaw`SELECT 1 FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;
}

function lockRoute(tx: Prisma.TransactionClient, routeId: string) {
  return tx.$queryRaw`SELECT 1 FROM "Route" WHERE "id" = ${routeId} FOR UPDATE`;
}

// Two steps, because @@unique([routeId, sequence]) is checked row by row and
// stops are swapping positions. The route must already be locked.
async function writeStopSequences(
  tx: Prisma.TransactionClient,
  moves: { id: string; sequence: number }[],
) {
  for (const [i, move] of moves.entries()) {
    await tx.routeStop.update({ where: { id: move.id }, data: { sequence: -(i + 1) } });
  }
  for (const move of moves) {
    await tx.routeStop.update({ where: { id: move.id }, data: { sequence: move.sequence } });
  }
}

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

// The first pair with both coordinates set, as plain numbers (Decimal
// columns otherwise reach the client as strings).
function latLng(...pairs: [DecimalLike, DecimalLike][]): {
  latitude: number | null;
  longitude: number | null;
} {
  for (const [lat, lng] of pairs) {
    if (lat != null && lng != null)
      return { latitude: Number(lat), longitude: Number(lng) };
  }
  return { latitude: null, longitude: null };
}
