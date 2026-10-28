import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleKey, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { businessDayBounds, resolveTimezone } from '../accounting/business-date';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: Prisma.Decimal | number | string | null) => Number(v ?? 0);

// Staff performance for a period: what each salesperson sold (issued invoices) and what each mechanic
// finished (work orders), with how long jobs took and how many came back. Amounts are after
// discounts, before tax; "parts" are product lines, "services" everything else (labour, jasa).
// Commission itself is paid through payroll — this is the numbers to base it on.
@Injectable()
export class PerformanceService {
  constructor(
    private prisma: PrismaService,
    private modules: OrganizationModulesService,
  ) {}

  async report(organizationId: string, opts: { from: string; to: string; branchId?: string }) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const { gte, lte } = businessDayBounds(opts.from, opts.to, resolveTimezone(org));
    if (!gte || !lte || gte > lte) throw new BadRequestException('A valid from/to period is required');
    const enabled = await this.modules.getEnabledModules(organizationId);
    const branch = (alias: string) =>
      opts.branchId ? Prisma.sql`AND ${Prisma.raw(`${alias}."branchId"`)} = ${opts.branchId}` : Prisma.empty;

    const salesRows = await this.prisma.$queryRaw<
      { id: string | null; name: string | null; invoices: number; parts: Prisma.Decimal; services: Prisma.Decimal }[]
    >`
      SELECT i."employeeId" AS id, e.name,
             COUNT(DISTINCT i.id)::int AS invoices,
             COALESCE(SUM(it."netAmount") FILTER (WHERE it."productId" IS NOT NULL), 0) AS parts,
             COALESCE(SUM(it."netAmount") FILTER (WHERE it."productId" IS NULL), 0) AS services
      FROM "Invoice" i
      LEFT JOIN "InvoiceItem" it ON it."invoiceId" = i.id
      LEFT JOIN "Employee" e ON e.id = i."employeeId"
      WHERE i."organizationId" = ${organizationId}
        AND i.status = 'ISSUED'
        AND i."issuedAt" >= ${gte} AND i."issuedAt" <= ${lte}
        ${branch('i')}
      GROUP BY i."employeeId", e.name
    `;
    const salespeople = salesRows
      .map((r) => {
        const parts = round2(num(r.parts));
        const services = round2(num(r.services));
        return {
          employeeId: r.id,
          name: r.name,
          invoices: r.invoices,
          parts,
          services,
          total: round2(parts + services),
          average: r.invoices ? round2((parts + services) / r.invoices) : 0,
        };
      })
      .sort((a, b) => b.total - a.total);

    if (!enabled.includes(ModuleKey.WORKSHOP_RMS)) return { from: gte, to: lte, salespeople, mechanics: null, comebacks: [] };

    // Jobs finished in the period, with what their (non-void) invoices billed.
    const mechanicRows = await this.prisma.$queryRaw<
      {
        id: string | null;
        name: string | null;
        jobs: number;
        invoiced: number;
        parts: Prisma.Decimal;
        services: Prisma.Decimal;
        timed: number;
        avgHours: number | null;
        medianHours: number | null;
      }[]
    >`
      WITH jobs AS (
        SELECT w.id, w."mechanicId", w."startedAt", w."completedAt"
        FROM "WorkOrder" w
        WHERE w."organizationId" = ${organizationId}
          AND w.status = 'DONE'
          AND w."completedAt" >= ${gte} AND w."completedAt" <= ${lte}
          ${branch('w')}
      ),
      billed AS (
        SELECT j.id,
               COALESCE(SUM(it."netAmount") FILTER (WHERE it."productId" IS NOT NULL), 0) AS parts,
               COALESCE(SUM(it."netAmount") FILTER (WHERE it."productId" IS NULL), 0) AS services
        FROM jobs j
        JOIN "Invoice" i ON i."workOrderId" = j.id AND i.status <> 'VOID'
        JOIN "InvoiceItem" it ON it."invoiceId" = i.id
        GROUP BY j.id
      ),
      timed AS (
        SELECT j.id, EXTRACT(EPOCH FROM (j."completedAt" - j."startedAt")) / 3600.0 AS hours
        FROM jobs j WHERE j."startedAt" IS NOT NULL AND j."completedAt" > j."startedAt"
      )
      SELECT j."mechanicId" AS id, e.name,
             COUNT(*)::int AS jobs,
             COUNT(b.id)::int AS invoiced,
             COALESCE(SUM(b.parts), 0) AS parts,
             COALESCE(SUM(b.services), 0) AS services,
             COUNT(t.id)::int AS timed,
             AVG(t.hours)::float AS "avgHours",
             (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.hours))::float AS "medianHours"
      FROM jobs j
      LEFT JOIN billed b ON b.id = j.id
      LEFT JOIN timed t ON t.id = j.id
      LEFT JOIN "Employee" e ON e.id = j."mechanicId"
      GROUP BY j."mechanicId", e.name
    `;

    // Comebacks opened in the period, counted against the mechanic of the job they redo.
    const comebackRows = await this.prisma.workOrder.findMany({
      where: {
        organizationId,
        comebackOfId: { not: null },
        createdAt: { gte, lte },
        ...(opts.branchId && { branchId: opts.branchId }),
      },
      select: {
        id: true,
        number: true,
        comebackReason: true,
        createdAt: true,
        vehicle: { select: { plateNumber: true } },
        comebackOf: { select: { id: true, number: true, completedAt: true, mechanicId: true, mechanic: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const comebacksByMechanic = new Map<string | null, number>();
    for (const c of comebackRows) {
      const key = c.comebackOf?.mechanicId ?? null;
      comebacksByMechanic.set(key, (comebacksByMechanic.get(key) ?? 0) + 1);
    }

    const seen = new Set(mechanicRows.map((r) => r.id));
    const mechanics = [
      ...mechanicRows.map((r) => {
        const parts = round2(num(r.parts));
        const services = round2(num(r.services));
        const comebacks = comebacksByMechanic.get(r.id) ?? 0;
        return {
          employeeId: r.id,
          name: r.name,
          jobs: r.jobs,
          invoicedJobs: r.invoiced,
          parts,
          services,
          total: round2(parts + services),
          timedJobs: r.timed,
          avgHours: r.avgHours != null ? round2(r.avgHours) : null,
          medianHours: r.medianHours != null ? round2(r.medianHours) : null,
          comebacks,
          comebackRate: r.jobs ? round2((comebacks / r.jobs) * 100) : null,
        };
      }),
      // A mechanic with comebacks in the period but no finished job still shows.
      ...[...comebacksByMechanic]
        .filter(([id]) => !seen.has(id))
        .map(([id, comebacks]) => ({
          employeeId: id,
          name: comebackRows.find((c) => (c.comebackOf?.mechanicId ?? null) === id)?.comebackOf?.mechanic?.name ?? null,
          jobs: 0,
          invoicedJobs: 0,
          parts: 0,
          services: 0,
          total: 0,
          timedJobs: 0,
          avgHours: null,
          medianHours: null,
          comebacks,
          comebackRate: null,
        })),
    ].sort((a, b) => b.jobs - a.jobs || b.total - a.total);

    return {
      from: gte,
      to: lte,
      salespeople,
      mechanics,
      comebacks: comebackRows.slice(0, 100).map((c) => ({
        id: c.id,
        number: c.number,
        reason: c.comebackReason,
        createdAt: c.createdAt,
        plate: c.vehicle.plateNumber,
        original: c.comebackOf && {
          id: c.comebackOf.id,
          number: c.comebackOf.number,
          completedAt: c.comebackOf.completedAt,
          mechanic: c.comebackOf.mechanic?.name ?? null,
        },
      })),
    };
  }
}
