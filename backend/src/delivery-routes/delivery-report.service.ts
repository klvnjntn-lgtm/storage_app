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

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Delivery DMS performance over a date range: how reliably each team
// finishes its day, the daily trend, who gets delivered to most, why
// stops fail, and — when DOs exist (WAREHOUSE_OPS / INVOICE_POS) — which
// items go out most. Stop outcomes use DeliveryRoutesService.stopStatus,
// so a DO stop and a customer stop count the same way here as on the
// monitoring page. A rescheduled (superseded) stop counts as the failure
// it was on its original day.
@Injectable()
export class DeliveryReportService {
  constructor(
    private prisma: PrismaService,
    private routes: DeliveryRoutesService,
    private modules: OrganizationModulesService,
  ) {}

  async report(organizationId: string, from: string, to: string) {
    const start = this.routes.dayRange(from).gte;
    const end = this.routes.dayRange(to).lt;
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (days <= 0) throw new BadRequestException('"from" must be on or before "to"');
    if (days > MAX_RANGE_DAYS) throw new BadRequestException(`The range can be at most ${MAX_RANGE_DAYS} days`);

    const [routes, itemsEnabled] = await Promise.all([
      this.prisma.route.findMany({
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
      }),
      Promise.all([
        this.modules.isModuleEnabled(organizationId, ModuleKey.WAREHOUSE_OPS),
        this.modules.isModuleEnabled(organizationId, ModuleKey.INVOICE_POS),
      ]).then(([a, b]) => a || b),
    ]);

    const today = isoDay(new Date());

    // Daily buckets, pre-filled so quiet days show as zero, not gaps.
    const daily = new Map<string, { date: string; delivered: number; failed: number; notDone: number }>();
    for (let i = 0; i < days; i++) {
      const date = isoDay(new Date(start.getTime() + i * 86_400_000));
      daily.set(date, { date, delivered: 0, failed: 0, notDone: 0 });
    }

    type TeamAcc = {
      team: ReturnType<typeof presentTeam>;
      stops: number;
      delivered: number;
      failed: number;
      notDone: number;
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
    const totals = { stops: 0, delivered: 0, failed: 0, notDone: 0 };

    for (const route of routes) {
      const date = isoDay(route.routeDate);
      const bucket = daily.get(date);
      const acc =
        teams.get(route.team.id) ??
        ({
          team: presentTeam(route.team),
          stops: 0,
          delivered: 0,
          failed: 0,
          notDone: 0,
          routeDays: 0,
          perfectDays: 0,
          incompleteDays: 0,
          outcomes: [],
        } satisfies TeamAcc);
      teams.set(route.team.id, acc);

      let delivered = 0;
      for (const stop of route.stops) {
        const status = this.routes.stopStatus(stop);
        const target = stopTarget(stop);
        const custKey = target.customerId ?? `name:${(target.customerName ?? '').trim().toLowerCase()}`;
        const cust =
          customers.get(custKey) ??
          { customerId: target.customerId, name: target.customerName ?? target.doNumber ?? '—', delivered: 0, failed: 0 };
        customers.set(custKey, cust);

        if (status === 'DELIVERED') {
          delivered++;
          acc.delivered++;
          totals.delivered++;
          cust.delivered++;
          if (bucket) bucket.delivered++;
          if (stop.deliveryOrder) deliveredDoIds.push(stop.deliveryOrder.id);
        } else if (status === 'FAILED') {
          acc.failed++;
          totals.failed++;
          cust.failed++;
          if (bucket) bucket.failed++;
          const text = (stop.deliveryOrder ? stop.deliveryOrder.failureReason : stop.failureReason)?.trim();
          if (text) {
            const key = text.toLowerCase();
            const r = reasons.get(key) ?? { reason: text, count: 0 };
            r.count++;
            reasons.set(key, r);
          }
        } else {
          acc.notDone++;
          totals.notDone++;
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

    const teamRows = [...teams.values()]
      .map(({ outcomes, ...t }) => {
        let streak = 0;
        for (let i = outcomes.length - 1; i >= 0 && outcomes[i]; i--) streak++;
        return {
          ...t,
          completionRate: t.stops ? t.delivered / t.stops : null,
          perfectRate: t.routeDays ? t.perfectDays / t.routeDays : null,
          streak,
        };
      })
      .sort((a, b) => (b.completionRate ?? -1) - (a.completionRate ?? -1) || b.stops - a.stops);

    let topItems: { productId: string | null; name: string; unit: string | null; quantity: number; deliveries: number }[] = [];
    if (itemsEnabled && deliveredDoIds.length > 0) {
      const items = await this.prisma.deliveryOrderItem.findMany({
        where: { deliveryOrderId: { in: deliveredDoIds } },
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

    return {
      from,
      to,
      totals: {
        ...totals,
        completionRate: totals.stops ? totals.delivered / totals.stops : null,
        routeDays: teamRows.reduce((n, t) => n + t.routeDays, 0),
        perfectDays: teamRows.reduce((n, t) => n + t.perfectDays, 0),
      },
      daily: [...daily.values()],
      teams: teamRows,
      topCustomers: [...customers.values()]
        .filter((c) => c.delivered > 0)
        .sort((a, b) => b.delivered - a.delivered || a.failed - b.failed)
        .slice(0, TOP_N),
      failureReasons: [...reasons.values()].sort((a, b) => b.count - a.count).slice(0, 5),
      itemsEnabled,
      topItems,
    };
  }
}
