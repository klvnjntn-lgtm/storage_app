// src/delivery-routes/delivery-report.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleKey, RouteStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import {
  DeliveryRoutesService,
  presentTeam,
  stopSelect,
  stopTarget,
  teamSelect,
} from './delivery-routes.service';

// A wide range is fine (one query per table), but cap it so a typo'd year
// can't scan the org's whole history.
const MAX_RANGE_DAYS = 366;
const TOP_N = 10;
const PROBLEM_CUSTOMERS_N = 5;
// Same grace the monitoring page gives an ETA before calling a stop late.
const ON_TIME_GRACE_MS = 20 * 60 * 1000;
const MAX_PAGE_SIZE = 100;

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Stops someone has to look at: not delivered yet (or never), and failed
// ones — flagged when nobody has rescheduled them.
type AttentionRow = {
  stopId: string;
  routeId: string;
  date: string;
  team: ReturnType<typeof presentTeam>;
  customerId: string | null;
  name: string;
  doNumber: string | null;
  // Set for a DO stop — it's rescheduled through the delivery order.
  deliveryOrderId: string | null;
  address: string | null;
  // Pending: the driver took the proof photo but never tapped Done.
  photoTaken: boolean;
  photoTakenAt: Date | null;
  // Pending and its day is over — nobody went.
  missed: boolean;
  failedAt: Date | null;
  reason: string | null;
  needsReschedule: boolean;
};

export type AttentionQuery = {
  kind?: string;
  teamId?: string;
  state?: string;
  q?: string;
  sort?: string;
  page?: string;
  pageSize?: string;
};

// Delivery DMS performance over a date range: how reliably each team
// finishes its day, how punctual it is, the daily and weekday pattern, who
// gets delivered to most (and who fails most), why stops fail, and — when
// DOs exist (WAREHOUSE_OPS / INVOICE_POS) — which items go out most. Each
// headline number also comes for the same-length period just before, so
// the page can say whether things got better. Stop outcomes use
// DeliveryRoutesService.stopStatus, so a DO stop and a customer stop count
// the same way here as on the monitoring page. A rescheduled (superseded)
// stop counts as the failure it was on its original day.
@Injectable()
export class DeliveryReportService {
  constructor(
    private prisma: PrismaService,
    private routes: DeliveryRoutesService,
    private modules: OrganizationModulesService,
  ) {}

  private range(from: string, to: string) {
    const start = this.routes.dayRange(from).gte;
    const end = this.routes.dayRange(to).lt;
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    if (days <= 0) throw new BadRequestException('"from" must be on or before "to"');
    if (days > MAX_RANGE_DAYS) throw new BadRequestException(`The range can be at most ${MAX_RANGE_DAYS} days`);
    return { start, end, days };
  }

  // One pass over every route in [start, end): everything report() and
  // attention() need.
  private async collect(organizationId: string, start: Date, end: Date) {
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    const routes = await this.prisma.route.findMany({
      where: {
        organizationId,
        routeDate: { gte: start, lt: end },
        status: { not: RouteStatus.CANCELLED },
      },
      select: {
        id: true,
        routeDate: true,
        status: true,
        team: { select: teamSelect },
        stops: { select: stopSelect },
      },
      orderBy: { routeDate: 'asc' },
    });

    const today = isoDay(new Date());

    // Daily buckets, pre-filled so quiet days show as zero, not gaps.
    const daily = new Map<string, { date: string; delivered: number; failed: number; notDone: number }>();
    for (let i = 0; i < days; i++) {
      const date = isoDay(new Date(start.getTime() + i * DAY_MS));
      daily.set(date, { date, delivered: 0, failed: 0, notDone: 0 });
    }
    // 0 = Sunday, like Date.getUTCDay().
    const weekdays = Array.from({ length: 7 }, (_, weekday) => ({ weekday, stops: 0, delivered: 0, failed: 0, notDone: 0 }));

    type TeamAcc = {
      team: ReturnType<typeof presentTeam>;
      stops: number;
      delivered: number;
      failed: number;
      notDone: number;
      // Delivered stops that had a promise (window or ETA) to keep, and how
      // many kept it.
      timed: number;
      onTime: number;
      routeDays: number;
      perfectDays: number;
      incompleteDays: number;
      // Oldest → newest outcome per finished route-day, for the streak.
      outcomes: boolean[];
    };
    const teams = new Map<string, TeamAcc>();
    const customers = new Map<string, { customerId: string | null; name: string; delivered: number; failed: number }>();
    const reasons = new Map<string, { reason: string; count: number }>();
    const deliveredDoIds: string[] = [];
    const totals = { stops: 0, delivered: 0, failed: 0, notDone: 0, timed: 0, onTime: 0 };
    const pendingRows: AttentionRow[] = [];
    const failedRows: AttentionRow[] = [];

    for (const route of routes) {
      const date = isoDay(route.routeDate);
      const bucket = daily.get(date);
      const wd = weekdays[route.routeDate.getUTCDay()];
      const acc =
        teams.get(route.team.id) ??
        ({
          team: presentTeam(route.team),
          stops: 0,
          delivered: 0,
          failed: 0,
          notDone: 0,
          timed: 0,
          onTime: 0,
          routeDays: 0,
          perfectDays: 0,
          incompleteDays: 0,
          outcomes: [],
        } satisfies TeamAcc);
      teams.set(route.team.id, acc);

      let delivered = 0;
      const team = presentTeam(route.team);
      for (const stop of route.stops) {
        const status = this.routes.stopStatus(stop);
        const target = stopTarget(stop);
        const d = stop.deliveryOrder;
        const photoTaken = d ? d.proofPhotoKey != null || d.proofPhotoUrl != null : stop.proofPhotoKey != null;
        const row = (): AttentionRow => ({
          stopId: stop.id,
          routeId: route.id,
          date,
          team,
          customerId: target.customerId,
          name: target.customerName ?? target.doNumber ?? '—',
          doNumber: target.doNumber,
          deliveryOrderId: d?.id ?? null,
          address: target.address,
          photoTaken,
          photoTakenAt: d ? d.proofPhotoTakenAt : stop.proofPhotoTakenAt,
          missed: !photoTaken && date < today,
          failedAt: d ? d.failedAt : stop.failedAt,
          reason: (d ? d.failureReason : stop.failureReason)?.trim() || null,
          // A rescheduled failure is marked superseded (customer stop: a new
          // stop elsewhere; DO: back on a route) — the rest still need it.
          needsReschedule: stop.supersededAt == null,
        });
        const custKey = target.customerId ?? `name:${(target.customerName ?? '').trim().toLowerCase()}`;
        const cust =
          customers.get(custKey) ??
          { customerId: target.customerId, name: target.customerName ?? target.doNumber ?? '—', delivered: 0, failed: 0 };
        customers.set(custKey, cust);
        wd.stops++;

        if (status === 'DELIVERED') {
          delivered++;
          acc.delivered++;
          totals.delivered++;
          cust.delivered++;
          wd.delivered++;
          if (bucket) bucket.delivered++;
          if (d) deliveredDoIds.push(d.id);
          // On time = signed before the customer's window closed, or (no
          // window) within the grace of the planned ETA.
          const signedAt = d ? d.signedAt : stop.signedAt;
          const due = target.deliveryWindowEnd
            ? target.deliveryWindowEnd.getTime()
            : stop.plannedEta
              ? stop.plannedEta.getTime() + ON_TIME_GRACE_MS
              : null;
          if (signedAt && due != null) {
            acc.timed++;
            totals.timed++;
            if (signedAt.getTime() <= due) {
              acc.onTime++;
              totals.onTime++;
            }
          }
        } else if (status === 'FAILED') {
          failedRows.push(row());
          acc.failed++;
          totals.failed++;
          cust.failed++;
          wd.failed++;
          if (bucket) bucket.failed++;
          const text = (d ? d.failureReason : stop.failureReason)?.trim();
          if (text) {
            const key = text.toLowerCase();
            const r = reasons.get(key) ?? { reason: text, count: 0 };
            r.count++;
            reasons.set(key, r);
          }
        } else {
          pendingRows.push(row());
          acc.notDone++;
          totals.notDone++;
          wd.notDone++;
          if (bucket) bucket.notDone++;
        }
      }
      acc.stops += route.stops.length;
      totals.stops += route.stops.length;

      // A day is judged once it's over (or the route was closed); today's
      // still-running route is neither perfect nor incomplete yet.
      const finished = date < today || route.status === RouteStatus.COMPLETED;
      if (finished && route.stops.length > 0) {
        const perfect = delivered === route.stops.length;
        acc.routeDays++;
        if (perfect) acc.perfectDays++;
        else acc.incompleteDays++;
        acc.outcomes.push(perfect);
      }
    }

    return { totals, daily, weekdays, teams, customers, reasons, deliveredDoIds, pendingRows, failedRows };
  }

  async report(organizationId: string, from: string, to: string) {
    const { start, end, days } = this.range(from, to);
    // The same number of days, ending the day before `from`.
    const prevStart = new Date(start.getTime() - days * DAY_MS);

    const [cur, prev, itemsEnabled] = await Promise.all([
      this.collect(organizationId, start, end),
      this.collect(organizationId, prevStart, start),
      Promise.all([
        this.modules.isModuleEnabled(organizationId, ModuleKey.WAREHOUSE_OPS),
        this.modules.isModuleEnabled(organizationId, ModuleKey.INVOICE_POS),
      ]).then(([a, b]) => a || b),
    ]);
    const { totals } = cur;

    const teamRows = [...cur.teams.values()]
      .map(({ outcomes, ...t }) => {
        let streak = 0;
        for (let i = outcomes.length - 1; i >= 0 && outcomes[i]; i--) streak++;
        return {
          ...t,
          completionRate: t.stops ? t.delivered / t.stops : null,
          perfectRate: t.routeDays ? t.perfectDays / t.routeDays : null,
          onTimeRate: t.timed ? t.onTime / t.timed : null,
          streak,
        };
      })
      .sort((a, b) => (b.completionRate ?? -1) - (a.completionRate ?? -1) || b.stops - a.stops);

    let topItems: { productId: string | null; name: string; unit: string | null; quantity: number; deliveries: number }[] = [];
    if (itemsEnabled && cur.deliveredDoIds.length > 0) {
      const items = await this.prisma.deliveryOrderItem.findMany({
        where: { deliveryOrderId: { in: cur.deliveredDoIds } },
        select: { deliveryOrderId: true, productId: true, productName: true, unit: true, quantity: true, returnedQuantity: true },
      });
      const byItem = new Map<string, { productId: string | null; name: string; unit: string | null; quantity: number; orders: Set<string> }>();
      for (const it of items) {
        const key = it.productId ?? `name:${it.productName.trim().toLowerCase()}`;
        const row = byItem.get(key) ?? { productId: it.productId, name: it.productName, unit: it.unit, quantity: 0, orders: new Set<string>() };
        row.quantity += Number(it.quantity) - Number(it.returnedQuantity);
        row.orders.add(it.deliveryOrderId);
        byItem.set(key, row);
      }
      topItems = [...byItem.values()]
        .map(({ orders, ...r }) => ({ ...r, deliveries: orders.size }))
        .filter((r) => r.quantity > 0)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, TOP_N);
    }

    const summary = (t: typeof totals) => ({
      ...t,
      completionRate: t.stops ? t.delivered / t.stops : null,
      failRate: t.stops ? t.failed / t.stops : null,
      onTimeRate: t.timed ? t.onTime / t.timed : null,
    });
    const customers = [...cur.customers.values()];

    return {
      from,
      to,
      totals: {
        ...summary(totals),
        routeDays: teamRows.reduce((n, t) => n + t.routeDays, 0),
        perfectDays: teamRows.reduce((n, t) => n + t.perfectDays, 0),
      },
      previous: {
        from: isoDay(prevStart),
        to: isoDay(new Date(start.getTime() - DAY_MS)),
        ...summary(prev.totals),
      },
      daily: [...cur.daily.values()],
      weekdays: cur.weekdays,
      teams: teamRows,
      topCustomers: customers
        .filter((c) => c.delivered > 0)
        .sort((a, b) => b.delivered - a.delivered || a.failed - b.failed)
        .slice(0, TOP_N),
      // Who fails most often — by count, then by how much of their total it is.
      problemCustomers: customers
        .filter((c) => c.failed > 0)
        .map((c) => ({ ...c, failRate: c.failed / (c.delivered + c.failed) }))
        .sort((a, b) => b.failed - a.failed || b.failRate - a.failRate)
        .slice(0, PROBLEM_CUSTOMERS_N),
      failureReasons: [...cur.reasons.values()].sort((a, b) => b.count - a.count).slice(0, 5),
      // Counts only — the rows themselves come page by page from attention().
      attention: {
        pendingTotal: cur.pendingRows.length,
        missed: cur.pendingRows.filter((p) => p.missed).length,
        photoNotConfirmed: cur.pendingRows.filter((p) => p.photoTaken).length,
        failedTotal: cur.failedRows.length,
        needsReschedule: cur.failedRows.filter((f) => f.needsReschedule).length,
      },
      itemsEnabled,
      topItems,
    };
  }

  // One page of the "needs attention" list, filtered.
  //  kind:  pending (default) | failed
  //  state: pending → missed | open | photo; failed → toReschedule | rescheduled
  //  sort:  newest (default) | oldest — failed always puts to-reschedule first
  //  q:     customer, DO number, address, team or failure reason
  async attention(organizationId: string, from: string, to: string, query: AttentionQuery) {
    const { start, end } = this.range(from, to);
    const kind = query.kind === 'failed' ? 'failed' : 'pending';
    const page = Math.max(1, Number.parseInt(query.page ?? '', 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.pageSize ?? '', 10) || 10));
    const needle = query.q?.trim().toLowerCase();

    const { pendingRows, failedRows } = await this.collect(organizationId, start, end);
    let rows = kind === 'pending' ? pendingRows : failedRows;

    if (query.teamId) rows = rows.filter((r) => r.team.id === query.teamId);
    const stateFilter: Record<string, (r: AttentionRow) => boolean> =
      kind === 'pending'
        ? { missed: (r) => r.missed, photo: (r) => r.photoTaken, open: (r) => !r.missed && !r.photoTaken }
        : { toReschedule: (r) => r.needsReschedule, rescheduled: (r) => !r.needsReschedule };
    const byState = query.state ? stateFilter[query.state] : undefined;
    if (byState) rows = rows.filter(byState);
    if (needle) {
      rows = rows.filter((r) =>
        [r.name, r.doNumber, r.address, r.team.name, r.reason].some((v) => v?.toLowerCase().includes(needle)),
      );
    }

    const dir = query.sort === 'oldest' ? 1 : -1;
    rows.sort(
      (a, b) =>
        (kind === 'failed' ? Number(b.needsReschedule) - Number(a.needsReschedule) : 0) ||
        dir * a.date.localeCompare(b.date),
    );

    return {
      kind,
      total: rows.length,
      page,
      pageSize,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
    };
  }
}
