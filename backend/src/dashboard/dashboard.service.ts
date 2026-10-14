import { Injectable } from '@nestjs/common';
import {
  ApprovalStatus,
  InvoiceStatus,
  ModuleKey,
  Prisma,
  PurchaseOrderStatus,
  StockTransferStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { AccountingReportsService } from '../accounting/accounting-reports.service';
import { ReorderService } from '../reorder/reorder.service';
import { BatchesService } from '../batches/batches.service';
import {
  endOfBusinessDay,
  resolveTimezone,
  todayBusinessDate,
  wallTimeOnBusinessDay,
} from '../accounting/business-date';

const DAY = 86_400_000;
const SERIES_DAYS = 14;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// The numbers on the home page. Everything is computed on request from
// the documents themselves (no cached counters to drift), each section
// only when the org has the module it belongs to. Money is admin-only —
// the same people who can open the books.
@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private modules: OrganizationModulesService,
    private reports: AccountingReportsService,
    private reorder: ReorderService,
    private batches: BatchesService,
  ) {}

  async summary(organizationId: string, user: { sub: string; role: string }) {
    const [org, enabled] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { timezone: true, waBalance: true },
      }),
      this.modules.getEnabledModules(organizationId),
    ]);
    const tz = resolveTimezone(org);
    const isAdmin = user.role === 'ADMIN';
    const selling = enabled.includes(ModuleKey.INVOICE_POS);
    const warehouse = enabled.includes(ModuleKey.WAREHOUSE_OPS);

    const today = todayBusinessDate(tz);
    const startOfToday = wallTimeOnBusinessDay(today, '00:00', tz);
    const monthStart = wallTimeOnBusinessDay(
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
      '00:00',
      tz,
    );
    const seriesStart = wallTimeOnBusinessDay(
      new Date(today.getTime() - (SERIES_DAYS - 1) * DAY),
      '00:00',
      tz,
    );

    const [lowStock, expiring, approvals, transfers, draftPos] =
      await Promise.all([
        selling
          ? this.reorder.report(organizationId).then((l) => l.length)
          : Promise.resolve(null),
        selling || warehouse
          ? this.batches
              .list(organizationId, { expiringWithinDays: 30 })
              .then((r) => r.batches.length)
          : Promise.resolve(null),
        this.prisma.approvalRequest.count({
          where: {
            organizationId,
            status: ApprovalStatus.PENDING,
            ...(isAdmin ? {} : { requestedById: user.sub }),
          },
        }),
        this.prisma.stockTransfer.count({
          where: { organizationId, status: StockTransferStatus.IN_TRANSIT },
        }),
        selling
          ? this.prisma.purchaseOrder.count({
              where: { organizationId, status: PurchaseOrderStatus.DRAFT },
            })
          : Promise.resolve(null),
      ]);

    const operations = {
      lowStock,
      expiringBatches: expiring,
      pendingApprovals: approvals,
      transfersInTransit: transfers,
      draftPurchaseOrders: draftPos,
    };
    if (!isAdmin || !selling) return { operations, finance: null };

    const issued = (from: Date, to?: Date): Prisma.InvoiceWhereInput => ({
      organizationId,
      status: InvoiceStatus.ISSUED,
      issuedAt: { gte: from, ...(to && { lte: to }) },
    });
    const [todayAgg, monthAgg, overdue, series, ap] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: issued(startOfToday),
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: issued(monthStart),
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          status: InvoiceStatus.ISSUED,
          paymentStatus: { not: 'PAID' },
          dueDate: { lt: today },
        },
        select: { total: true, amountPaid: true, creditedAmount: true },
      }),
      this.prisma.$queryRaw<{ day: Date; total: string }[]>`
        SELECT ("issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date AS day, SUM(total) AS total
        FROM "Invoice"
        WHERE "organizationId" = ${organizationId}
          AND status = 'ISSUED'
          AND "issuedAt" >= ${seriesStart}
          AND "issuedAt" <= ${endOfBusinessDay(today, tz)}
        GROUP BY 1`,
      this.reports.getAPAging(organizationId, endOfBusinessDay(today, tz), {
        pageSize: 1,
      }),
    ]);

    const overdueAmount = overdue.reduce(
      (s, i) =>
        s +
        Math.max(
          0,
          Number(i.total) - Number(i.amountPaid) - Number(i.creditedAmount),
        ),
      0,
    );
    const byDay = new Map(
      series.map((r) => [
        new Date(r.day).toISOString().slice(0, 10),
        Number(r.total),
      ]),
    );
    const salesSeries = Array.from({ length: SERIES_DAYS }, (_, i) => {
      const d = new Date(today.getTime() - (SERIES_DAYS - 1 - i) * DAY)
        .toISOString()
        .slice(0, 10);
      return { date: d, total: round2(byDay.get(d) ?? 0) };
    });
    const apTotals = ap.totals;

    return {
      operations,
      finance: {
        salesToday: {
          total: round2(Number(todayAgg._sum.total ?? 0)),
          count: todayAgg._count,
        },
        salesMonth: {
          total: round2(Number(monthAgg._sum.total ?? 0)),
          count: monthAgg._count,
        },
        salesSeries,
        overdueReceivables: {
          total: round2(overdueAmount),
          count: overdue.filter(
            (i) =>
              Number(i.total) -
                Number(i.amountPaid) -
                Number(i.creditedAmount) >
              0,
          ).length,
        },
        payables: {
          total: apTotals.total,
          overdue: round2(apTotals.total - apTotals.current),
        },
        waBalance: Number(org.waBalance),
      },
    };
  }
}
