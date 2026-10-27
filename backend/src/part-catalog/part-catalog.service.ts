import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PartCatalogQuery = {
  brand?: string;
  model?: string;
  year?: number;
  itemType?: string;
  item?: string;
  origin?: string;
  spec?: string;
  minSellers: number;
  q?: string;
  page: number;
  limit: number;
};

export type Confidence = 'verified' | 'confirmed' | 'unverified';

// Same rule the scraper uses when filling oemNormalized: uppercase, letters/digits only.
export function normalizeOem(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

@Injectable()
export class PartCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // Dropdown options: brand → models, item type → items, plus when the data was last refreshed.
  async facets() {
    const where = await this.latestSync();
    const [vehicles, items, latest] = await Promise.all([
      this.prisma.partCatalogEntry.groupBy({
        by: ['carBrand', 'model'],
        where,
        orderBy: [{ carBrand: 'asc' }, { model: 'asc' }],
      }),
      this.prisma.partCatalogEntry.groupBy({
        by: ['itemType', 'item'],
        where,
        orderBy: [{ itemType: 'asc' }, { item: 'asc' }],
      }),
      this.prisma.partCatalogEntry.aggregate({
        where,
        _max: { lastSeen: true },
        _count: true,
      }),
    ]);

    const brands = new Map<string, string[]>();
    for (const v of vehicles)
      brands.set(v.carBrand, [...(brands.get(v.carBrand) ?? []), v.model]);
    const itemTypes = new Map<string, string[]>();
    for (const i of items)
      itemTypes.set(i.itemType, [...(itemTypes.get(i.itemType) ?? []), i.item]);

    return {
      brands: [...brands].map(([brand, models]) => ({ brand, models })),
      itemTypes: [...itemTypes].map(([itemType, items]) => ({
        itemType,
        items,
      })),
      totalEntries: latest._count,
      lastUpdated: latest._max.lastSeen,
    };
  }

  // Rows the page may show: parts identified by an OEM number or a spec (bulb type, plug code…),
  // and only from the latest sync. The scraper never deletes rows; anything not stamped by the most
  // recent sync has been merged into another row since.
  private async latestSync(): Promise<Prisma.PartCatalogEntryWhereInput> {
    const latest = await this.prisma.partCatalogEntry.aggregate({
      _max: { syncedAt: true },
    });
    return {
      OR: [{ NOT: { oemNumber: '' } }, { NOT: { spec: '' } }],
      ...(latest._max.syncedAt ? { syncedAt: latest._max.syncedAt } : {}),
    };
  }

  async search(organizationId: string, query: PartCatalogQuery) {
    const and: Prisma.PartCatalogEntryWhereInput[] = [await this.latestSync()];
    if (query.brand) and.push({ carBrand: query.brand });
    if (query.model) and.push({ model: query.model });
    if (query.itemType) and.push({ itemType: query.itemType });
    if (query.item) and.push({ item: query.item });
    if (query.origin) and.push({ origin: query.origin });
    // Confirmations count distinct shops, so one seller's cloned listings can't vouch for a fitment.
    if (query.minSellers > 1) and.push({ sellers: { gte: query.minSellers } });
    if (query.year) {
      // Rows whose title gave no years are kept (shown after the dated ones) rather than silently hidden.
      and.push({
        OR: [
          { yearFrom: null },
          {
            yearFrom: { lte: query.year },
            OR: [{ yearTo: null }, { yearTo: { gte: query.year } }],
          },
        ],
      });
    }
    const q = query.q?.trim();
    if (q) {
      const oem = normalizeOem(q);
      and.push({
        OR: [
          ...(oem.length >= 3 ? [{ oemNormalized: { contains: oem } }] : []),
          { item: { contains: q, mode: 'insensitive' } },
          { model: { contains: q, mode: 'insensitive' } },
          { partBrand: { contains: q, mode: 'insensitive' } },
          { spec: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    // The spec summary is computed before the spec filter, so the chips stay visible while one is picked.
    const summaryWhere: Prisma.PartCatalogEntryWhereInput = {
      AND: [...and, { NOT: { spec: '' } }],
    };
    if (query.spec) {
      // Specs can be combined ("H4 / H11"), so match the whole value or one ' / '-separated part.
      const s = query.spec;
      and.push({
        OR: [
          { spec: s },
          { spec: { startsWith: `${s} / ` } },
          { spec: { endsWith: ` / ${s}` } },
          { spec: { contains: ` / ${s} / ` } },
        ],
      });
    }
    const where: Prisma.PartCatalogEntryWhereInput = { AND: and };

    const [specs, total, rows] = await Promise.all([
      this.prisma.partCatalogEntry.groupBy({
        by: ['spec'],
        where: summaryWhere,
        _sum: { sellers: true },
        orderBy: { _sum: { sellers: 'desc' } },
        take: 8,
      }),
      this.prisma.partCatalogEntry.count({ where }),
      this.prisma.partCatalogEntry.findMany({
        where,
        orderBy: [
          // Numbers the car maker lists for the car first, then its maker group's, then sellers' claims.
          { fitmentRank: 'desc' },
          { yearFrom: { sort: 'asc', nulls: 'last' } },
          { sellers: 'desc' },
          { listingsSeen: 'desc' },
          { id: 'asc' },
        ],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    const inStock = await this.stockByOem(
      organizationId,
      rows.map((r) => r.oemNormalized).filter(Boolean),
    );

    return {
      items: rows.map((r) => ({
        ...r,
        inStock: r.oemNormalized ? (inStock.get(r.oemNormalized) ?? []) : [],
      })),
      // Most-confirmed specs for the current filters, e.g. Avanza + Headlamp Bulb → H4 first.
      specSummary: specs.map((g) => ({
        spec: g.spec,
        sellers: g._sum.sellers ?? 0,
      })),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  // Rows from maker data (Sakura, NGK, Astra Otoshop, the car maker's own catalogue) or genuine listings count
  // as verified; otherwise 3+ distinct shops agreeing is "confirmed", and less is "unverified".
  private confidenceOf(row: {
    sources: string;
    origin: string;
    sellers: number;
    fitment: string;
  }): Confidence {
    if (
      /sakura|ngk|astraotoshop/.test(row.sources) ||
      row.fitment === 'maker' ||
      row.origin === 'Official'
    )
      return 'verified';
    return row.sellers >= 3 ? 'confirmed' : 'unverified';
  }

  // EPC-style view of one car: every item that has data, grouped by item type, each summarised into
  // what to use (most-confirmed spec / OEM number, genuine number first), alternative brands,
  // confidence and the org's stock.
  async vehicleSummary(
    organizationId: string,
    brand: string,
    model: string,
    year?: number,
  ) {
    const and: Prisma.PartCatalogEntryWhereInput[] = [
      await this.latestSync(),
      { carBrand: brand, model },
    ];
    if (year) {
      and.push({
        OR: [
          { yearFrom: null },
          {
            yearFrom: { lte: year },
            OR: [{ yearTo: null }, { yearTo: { gte: year } }],
          },
        ],
      });
    }
    const rows = await this.prisma.partCatalogEntry.findMany({
      where: { AND: and },
      select: {
        itemType: true,
        item: true,
        generation: true,
        yearFrom: true,
        yearTo: true,
        oemNumber: true,
        oemNormalized: true,
        spec: true,
        origin: true,
        partBrand: true,
        sellers: true,
        sources: true,
        thumbKey: true,
        fitment: true,
        fitmentRank: true,
      },
    });

    const rank: Record<Confidence, number> = {
      verified: 2,
      confirmed: 1,
      unverified: 0,
    };
    type Acc = {
      itemType: string;
      item: string;
      specs: Map<string, number>;
      oems: Map<
        string,
        {
          number: string;
          normalized: string;
          sellers: number;
          genuine: boolean;
          fitment: string;
          fitmentRank: number;
        }
      >;
      brands: Map<string, number>;
      confidence: Confidence;
      sellers: number;
      thumb: { key: string; sellers: number } | null;
    };
    const items = new Map<string, Acc>();
    const generations = new Map<
      string,
      { yearFrom: number | null; yearTo: number | null }
    >();
    for (const r of rows) {
      const gen = r.generation.replace(/\s*\(via OEM\)$/, '');
      if (gen && !generations.has(gen))
        generations.set(gen, { yearFrom: r.yearFrom, yearTo: r.yearTo });
      const key = `${r.itemType}|${r.item}`;
      const acc: Acc = items.get(key) ?? {
        itemType: r.itemType,
        item: r.item,
        specs: new Map(),
        oems: new Map(),
        brands: new Map(),
        confidence: 'unverified',
        sellers: 0,
        thumb: null,
      };
      items.set(key, acc);
      if (r.thumbKey && (!acc.thumb || r.sellers > acc.thumb.sellers))
        acc.thumb = { key: r.thumbKey, sellers: r.sellers };
      acc.sellers += r.sellers;
      const conf = this.confidenceOf(r);
      if (rank[conf] > rank[acc.confidence]) acc.confidence = conf;
      if (r.spec)
        acc.specs.set(r.spec, (acc.specs.get(r.spec) ?? 0) + r.sellers);
      if (r.oemNumber) {
        const o = acc.oems.get(r.oemNormalized) ?? {
          number: r.oemNumber,
          normalized: r.oemNormalized,
          sellers: 0,
          genuine: false,
          fitment: '',
          fitmentRank: 0,
        };
        o.sellers += r.sellers;
        o.genuine ||= r.origin === 'Official';
        if (r.fitmentRank > o.fitmentRank) {
          o.fitment = r.fitment;
          o.fitmentRank = r.fitmentRank;
        }
        acc.oems.set(r.oemNormalized, o);
      }
      if (r.partBrand)
        acc.brands.set(
          r.partBrand,
          (acc.brands.get(r.partBrand) ?? 0) + r.sellers,
        );
    }

    const summaries = [...items.values()].map((a) => {
      // Numbers the car maker lists first, then genuine ones, then the most-confirmed; specs and brands
      // by how many shops list them.
      const oems = [...a.oems.values()].sort(
        (x, y) =>
          y.fitmentRank - x.fitmentRank ||
          Number(y.genuine) - Number(x.genuine) ||
          y.sellers - x.sellers,
      );
      const byCount = (m: Map<string, number>) =>
        [...m]
          .sort((x, y) => y[1] - x[1])
          .map(([value, sellers]) => ({ value, sellers }));
      return {
        itemType: a.itemType,
        item: a.item,
        specs: byCount(a.specs).slice(0, 4),
        oems: oems.slice(0, 5),
        brands: byCount(a.brands).slice(0, 8),
        confidence: a.confidence,
        sellers: a.sellers,
        thumbKey: a.thumb?.key ?? null,
      };
    });

    const workshop = await this.workshopEvidence(brand, model);
    const withWorkshop = summaries.map((s) => {
      const w = workshop.get(s.item);
      if (!w) return { ...s, workshop: null };
      // Workshop's most-installed value vs the card: "agrees" when it is (part of) the main answer —
      // wipers come as "20\" + 14\"" pairs — "listed" when it's among the alternatives, else "differs".
      // " / " (with spaces) and "+" join values; a bare "/" belongs to tire sizes (185/65 R15).
      const parts = (v: string) =>
        v
          .toUpperCase()
          .replace(/[^A-Z0-9/+ ."]/g, '')
          .split(/\s+\/\s+|\s*\+\s*/);
      let agreement: 'agrees' | 'listed' | 'differs' | null = null;
      if (w.spec && s.specs.length) {
        const ws = w.spec.value.toUpperCase();
        agreement = parts(s.specs[0].value).includes(ws)
          ? 'agrees'
          : s.specs.some((x) => parts(x.value).includes(ws))
            ? 'listed'
            : 'differs';
      } else if (w.oem && s.oems.length) {
        agreement =
          s.oems[0].normalized === w.oem.normalized
            ? 'agrees'
            : s.oems.some((o) => o.normalized === w.oem!.normalized)
              ? 'listed'
              : 'differs';
      }
      return { ...s, workshop: { ...w, agreement } };
    });

    const stock = await this.stockByOem(
      organizationId,
      summaries.flatMap((s) => s.oems.slice(0, 3).map((o) => o.normalized)),
    );
    const categories = new Map<string, unknown[]>();
    for (const s of withWorkshop.sort((x, y) => y.sellers - x.sellers)) {
      const inStock = s.oems.flatMap((o) => stock.get(o.normalized) ?? []);
      const unique = [
        ...new Map(inStock.map((p) => [p.productId, p])).values(),
      ];
      categories.set(s.itemType, [
        ...(categories.get(s.itemType) ?? []),
        { ...s, inStock: unique },
      ]);
    }
    return {
      vehicle: {
        brand,
        model,
        year: year ?? null,
        generations: [...generations].map(([name, y]) => ({ name, ...y })),
      },
      categories: [...categories]
        .map(([itemType, list]) => ({ itemType, items: list }))
        .sort((x, y) => x.itemType.localeCompare(y.itemType)),
    };
  }

  // What workshops on WareSys install most for one car, per item (anonymous totals written by the
  // scraper's workshop-check). Only values used by at least PART_EVIDENCE_MIN_WORKSHOPS different
  // workshops are shown, so no single workshop's choices are visible to others.
  private async workshopEvidence(brand: string, model: string) {
    const min = Math.max(
      1,
      Number(process.env.PART_EVIDENCE_MIN_WORKSHOPS) || 2,
    );
    const latest = await this.prisma.partWorkshopEvidence.aggregate({
      where: { carBrand: brand, model },
      _max: { syncedAt: true },
    });
    const result = new Map<
      string,
      {
        spec: { value: string; workshops: number; installs: number } | null;
        oem: {
          value: string;
          normalized: string;
          workshops: number;
          installs: number;
        } | null;
      }
    >();
    if (!latest._max.syncedAt) return result;
    const rows = await this.prisma.partWorkshopEvidence.findMany({
      where: {
        carBrand: brand,
        model,
        syncedAt: latest._max.syncedAt,
        workshops: { gte: min },
        kind: { in: ['spec', 'oem'] },
      },
      orderBy: [{ workshops: 'desc' }, { installs: 'desc' }],
    });
    for (const r of rows) {
      const e = result.get(r.item) ?? { spec: null, oem: null };
      if (r.kind === 'spec' && !e.spec)
        e.spec = {
          value: r.value,
          workshops: r.workshops,
          installs: r.installs,
        };
      if (r.kind === 'oem' && !e.oem)
        e.oem = {
          value: r.value,
          normalized: r.valueNormalized,
          workshops: r.workshops,
          installs: r.installs,
        };
      result.set(r.item, e);
    }
    return result;
  }

  // One part number: every car it is listed for, its equivalents (Sakura groups) and the org's stock.
  async partNumber(organizationId: string, oem: string) {
    const normalized = normalizeOem(oem);
    const rows = await this.prisma.partCatalogEntry.findMany({
      where: { AND: [await this.latestSync(), { oemNormalized: normalized }] },
      select: {
        oemNumber: true,
        carBrand: true,
        model: true,
        generation: true,
        yearFrom: true,
        yearTo: true,
        itemType: true,
        item: true,
        origin: true,
        partBrand: true,
        sellers: true,
        sources: true,
        thumbKey: true,
        fitment: true,
        fitmentRank: true,
      },
      orderBy: [{ carBrand: 'asc' }, { model: 'asc' }, { yearFrom: 'asc' }],
    });
    const cars = new Map<string, Record<string, unknown>>();
    const rank: Record<Confidence, number> = {
      verified: 2,
      confirmed: 1,
      unverified: 0,
    };
    for (const r of rows) {
      const generation = r.generation.replace(/\s*\(via OEM\)$/, '');
      const key = `${r.carBrand}|${r.model}|${generation}`;
      const conf = this.confidenceOf(r);
      const prev = cars.get(key) as
        | {
            confidence: Confidence;
            sellers: number;
            fitment: string;
            fitmentRank: number;
          }
        | undefined;
      const better = !prev || r.fitmentRank > prev.fitmentRank;
      cars.set(key, {
        carBrand: r.carBrand,
        model: r.model,
        generation,
        yearFrom: r.yearFrom,
        yearTo: r.yearTo,
        sellers: (prev?.sellers ?? 0) + r.sellers,
        confidence:
          prev && rank[prev.confidence] >= rank[conf] ? prev.confidence : conf,
        fitment: better ? r.fitment : prev.fitment,
        fitmentRank: better ? r.fitmentRank : prev.fitmentRank,
      });
    }
    const count = (values: string[]) => {
      const m = new Map<string, number>();
      for (const v of values.filter(Boolean)) m.set(v, (m.get(v) ?? 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1]).map(([v]) => v);
    };
    const equivalents = (await this.interchangeable([normalized])).get(
      normalized,
    );
    const stock = await this.stockByOem(organizationId, [normalized]);
    return {
      oemNumber: rows[0]?.oemNumber ?? oem,
      items: count(rows.map((r) => r.item)),
      itemTypes: count(rows.map((r) => r.itemType)),
      genuine: rows.some((r) => r.origin === 'Official'),
      thumbKey: rows.find((r) => r.thumbKey)?.thumbKey ?? null,
      brands: count(rows.map((r) => r.partBrand)).slice(0, 10),
      cars: [...cars.values()],
      equivalents: equivalents
        ? [...equivalents].map(([number, via]) => ({ number, via }))
        : [],
      inStock: stock.get(normalized) ?? [],
    };
  }

  // OEM numbers interchangeable with each of `oems` (same Sakura group: supersessions and other
  // makers' equivalents), with the group's label, e.g. "Sakura C-1109 (Oil Filter)".
  private async interchangeable(oems: string[]) {
    const result = new Map<string, Map<string, string>>(); // oem → (equivalent oem → label)
    if (oems.length === 0) return result;
    const groups = await this.prisma.partInterchange.findMany({
      where: { oemNormalized: { in: oems } },
      select: { groupKey: true },
    });
    if (groups.length === 0) return result;
    const members = await this.prisma.partInterchange.findMany({
      where: { groupKey: { in: [...new Set(groups.map((g) => g.groupKey))] } },
      select: { groupKey: true, label: true, oemNormalized: true },
    });
    const byGroup = new Map<string, typeof members>();
    for (const m of members)
      byGroup.set(m.groupKey, [...(byGroup.get(m.groupKey) ?? []), m]);
    for (const group of byGroup.values()) {
      for (const m of group) {
        if (!oems.includes(m.oemNormalized)) continue;
        const eq = result.get(m.oemNormalized) ?? new Map<string, string>();
        for (const other of group)
          if (
            other.oemNormalized !== m.oemNormalized &&
            !eq.has(other.oemNormalized)
          )
            eq.set(other.oemNormalized, other.label);
        result.set(m.oemNormalized, eq);
      }
    }
    return result;
  }

  // The org's own products whose OEM number matches, with on-hand quantity across locations. A
  // product stocked under an interchangeable number also counts, flagged with `equivalentVia`.
  private async stockByOem(organizationId: string, oems: string[]) {
    const result = new Map<
      string,
      {
        productId: string;
        name: string;
        quantity: number;
        oem: string;
        equivalentVia: string | null;
      }[]
    >();
    const wanted = [...new Set(oems)];
    if (wanted.length === 0) return result;
    const equivalents = await this.interchangeable(wanted);
    const unique = [
      ...new Set([
        ...wanted,
        ...[...equivalents.values()].flatMap((m) => [...m.keys()]),
      ]),
    ];

    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        oem: string;
        quantity: Prisma.Decimal | null;
      }[]
    >`
      SELECT p.id, p.name, regexp_replace(upper(p.oem), '[^A-Z0-9]', '', 'g') AS oem,
             SUM(s.quantity) AS quantity
      FROM "Product" p
      LEFT JOIN "Stock" s ON s."productId" = p.id
      WHERE p."organizationId" = ${organizationId}
        AND p.active = true
        AND p.oem IS NOT NULL
        AND regexp_replace(upper(p.oem), '[^A-Z0-9]', '', 'g') IN (${Prisma.join(unique)})
      GROUP BY p.id, p.name, p.oem
    `;
    const byOem = new Map<string, typeof rows>();
    for (const r of rows) byOem.set(r.oem, [...(byOem.get(r.oem) ?? []), r]);
    for (const oem of wanted) {
      const matches = (byOem.get(oem) ?? []).map((r) => ({
        productId: r.id,
        name: r.name,
        quantity: Number(r.quantity ?? 0),
        oem: r.oem,
        equivalentVia: null as string | null,
      }));
      for (const [eqOem, label] of equivalents.get(oem) ?? []) {
        for (const r of byOem.get(eqOem) ?? []) {
          if (matches.some((m) => m.productId === r.id)) continue;
          matches.push({
            productId: r.id,
            name: r.name,
            quantity: Number(r.quantity ?? 0),
            oem: r.oem,
            equivalentVia: label,
          });
        }
      }
      if (matches.length) result.set(oem, matches);
    }
    return result;
  }
}
