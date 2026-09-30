// src/sessions/sessions.service.ts
import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { runSerializable } from '../prisma/serializable';
import { EventType, SessionType, FulfillmentMode, ModuleKey, Prisma, DeliveryOrderStatus } from '@prisma/client';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { PostingRulesService } from '../accounting/posting-rules.service'; // NEW
import { JwtPayload } from '../auth/decorators/current-user.decorator';
import { recomputeInvoiceFulfillmentStatus } from '../invoice/fulfillment-status.util';

const RETURN_REASONS = [
  'DAMAGED',
  'WRONG_ITEM',
  'CHANGED_MIND',
  'DEFECTIVE',
  'OTHER',
] as const;
type ReturnReason = (typeof RETURN_REASONS)[number];

const MOVE_STAGES: EventType[] = [EventType.PICK, EventType.MOVE];

const SUMMARY_PRODUCT_SELECT = {
  id: true, sku: true, name: true, image: true,
  sellingPrice: true, costPrice: true,
  stocks: { select: { quantity: true, location: { select: { id: true, name: true } } } },
} satisfies Prisma.ProductSelect;

export type SummarySortKey = 'sku' | 'name' | 'sellingPrice' | 'costPrice' | 'totalStock';

export type SummaryQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  locationId?: string;
  oversold?: boolean;
  sort?: SummarySortKey;
  dir?: 'asc' | 'desc';
};

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationModulesService: OrganizationModulesService,
    private readonly postingRules: PostingRulesService,
  ) {}

  private async getStagesForSession(
    organizationId: string,
    type: SessionType,
    client: Pick<PrismaService, 'organization'> = this.prisma,
  ): Promise<EventType[] | null> {
    if (type === SessionType.FULFILLMENT) {
      const org = await client.organization.findUnique({
        where: { id: organizationId },
        select: { fulfillmentMode: true },
      });
      return org?.fulfillmentMode === FulfillmentMode.PICK_SHIP
        ? [EventType.PICK, EventType.SHIP]
        : [EventType.PICK, EventType.PACK, EventType.SHIP];
    }

    if (type === SessionType.MOVE) {
      return MOVE_STAGES;
    }

    return null;
  }

  // A returns session can only link to a sale whose goods left through a
  // path this session can reverse: issued directly (DIRECT_ISSUE) or
  // picked in a warehouse session (SESSION). Anything shipped on a
  // delivery order is returned on that delivery order instead — it tracks
  // per-shipment returnedQuantity that a session can't keep in step.
  private async assertReturnableInvoice(
    organizationId: string,
    invoiceId: string,
    client: Pick<Prisma.TransactionClient, 'invoice'>,
  ) {
    const invoice = await client.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { id: true, invoiceNumber: true, status: true, fulfillmentPath: true, salesOrderId: true },
    });
    if (!invoice) throw new BadRequestException('Invoice not found');
    const label = invoice.invoiceNumber ?? invoice.id.slice(0, 8);
    if (invoice.status !== 'ISSUED') {
      throw new BadRequestException(`Invoice ${label} is not issued, so nothing on it can be returned`);
    }
    if (invoice.fulfillmentPath === 'DELIVERY_ORDER' || invoice.salesOrderId) {
      throw new BadRequestException(
        `Invoice ${label} was delivered on a delivery order — record the return on that delivery order instead.`,
      );
    }
    if (!invoice.fulfillmentPath) {
      throw new BadRequestException(`Nothing on invoice ${label} has been fulfilled yet, so there is nothing to return`);
    }
    return invoice;
  }

  // Reverses one returns-session scan against its linked invoice, exactly
  // like DeliveryOrderService.recordReturn() does for a delivery: lines are
  // consumed in line order, fulfilledQuantity is decremented with a gte
  // guard (the shared ceiling), and revenue/tax/AR plus COGS are reversed
  // at the invoice line's own snapshot. Stock itself is incremented by the
  // caller.
  private async applyLinkedReturn(
    tx: Prisma.TransactionClient,
    organizationId: string,
    params: {
      sessionId: string;
      sessionItemId: number;
      invoiceId: string;
      productId: string;
      qty: number;
      toLocationId: string;
      reason?: string;
    },
  ) {
    const { invoiceId, productId, qty } = params;
    const invoice = await tx.invoice.findFirstOrThrow({
      where: { id: invoiceId, organizationId },
      select: { invoiceNumber: true, id: true },
    });
    const label = invoice.invoiceNumber ?? invoice.id.slice(0, 8);

    const lines = await tx.invoiceItem.findMany({
      where: { invoiceId, productId },
      orderBy: { id: 'asc' },
      select: { id: true, fulfilledQuantity: true, unitCost: true },
    });
    if (lines.length === 0) {
      throw new BadRequestException(`This product is not on invoice ${label}`);
    }
    const returnable = lines.reduce((sum, l) => sum + l.fulfilledQuantity, 0);
    if (qty > returnable) {
      throw new BadRequestException(
        returnable <= 0
          ? `Everything of this product on invoice ${label} has already been returned`
          : `Cannot return ${qty} — only ${returnable} unit(s) of this product can still be returned on invoice ${label}`,
      );
    }

    const allocations: { invoiceItemId: number; quantity: number; unitCost: number | null }[] = [];
    let remaining = qty;
    for (const line of lines) {
      if (remaining <= 0) break;
      const take = Math.min(line.fulfilledQuantity, remaining);
      if (take <= 0) continue;
      const dec = await tx.invoiceItem.updateMany({
        where: { id: line.id, fulfilledQuantity: { gte: take } },
        data: { fulfilledQuantity: { decrement: take } },
      });
      if (dec.count === 0) {
        throw new ConflictException('This invoice line changed during the return, please retry');
      }
      allocations.push({
        invoiceItemId: line.id,
        quantity: take,
        unitCost: line.unitCost != null ? Number(line.unitCost) : null,
      });
      remaining -= take;
    }

    await this.postingRules.postCogsReturn(
      organizationId,
      {
        sourceId: `${params.sessionId}:cogs:return:${params.sessionItemId}`,
        date: new Date(),
        memo: `COGS reversal for return of invoice ${label} (${params.reason ?? 'no reason'})`,
        lines: allocations.map((a) => ({
          productId,
          quantity: a.quantity,
          unitCost: a.unitCost,
          locationId: params.toLocationId,
        })),
      },
      tx,
    );
    await this.postingRules.postSalesReturn(
      organizationId,
      {
        sourceId: `${params.sessionId}:sales-return:${params.sessionItemId}`,
        date: new Date(),
        memo: `Sales return against invoice ${label} (returns session ${params.sessionId})`,
        invoiceId,
        lines: allocations.map((a) => ({ invoiceItemId: a.invoiceItemId, quantity: a.quantity })),
      },
      tx,
    );
    await recomputeInvoiceFulfillmentStatus(tx, organizationId, invoiceId);
    return allocations;
  }

  // Warehouse picks are what physically fulfil a SESSION-path invoice, so
  // they advance InvoiceItem.fulfilledQuantity (line order) the same way
  // issue()/delivery-order ship() do for the other paths. Previously
  // nothing did, leaving these invoices UNFULFILLED forever and giving a
  // linked return nothing to count against.
  private async recordInvoicePick(
    tx: Prisma.TransactionClient,
    organizationId: string,
    invoiceId: string,
    productId: string,
    qty: number,
  ) {
    const lines = await tx.invoiceItem.findMany({
      where: { invoiceId, productId },
      orderBy: { id: 'asc' },
      select: { id: true, quantity: true, fulfilledQuantity: true },
    });
    let remaining = qty;
    for (const line of lines) {
      if (remaining <= 0) break;
      const room = Number(line.quantity) - line.fulfilledQuantity;
      const take = Math.min(room, remaining);
      if (take <= 0) continue;
      await tx.invoiceItem.update({
        where: { id: line.id },
        data: { fulfilledQuantity: { increment: take } },
      });
      remaining -= take;
    }
    await recomputeInvoiceFulfillmentStatus(tx, organizationId, invoiceId);
  }

  async summary(organizationId: string, user: JwtPayload, query: SummaryQuery = {}) {
    const canSeeCostPrice =
      user.role === 'ADMIN' &&
          (await this.organizationModulesService.isModuleEnabled(organizationId, ModuleKey.INVOICE_POS));

    // No `page` → legacy full-array response (admin/products still reads
    // the whole catalog client-side). With `page`, filtering, sorting and
    // pagination all happen in the database — the Stock page used to pull
    // every product + stock row on each load, which doesn't scale to a
    // large imported catalog.
    if (query.page == null) {
      const products = await this.prisma.product.findMany({
        where: { organizationId },
        orderBy: { sku: 'asc' },
        select: SUMMARY_PRODUCT_SELECT,
      });
      return products.map((p) => this.toSummaryRow(p, canSeeCostPrice));
    }

    const page = query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 200) : 20;

    const conditions: Prisma.Sql[] = [Prisma.sql`p."organizationId" = ${organizationId}`];
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(Prisma.sql`(p.name ILIKE ${pattern} OR p.sku ILIKE ${pattern})`);
    }
    if (query.locationId) {
      // "What's at this location" — products with non-zero stock there.
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "Stock" ls
        WHERE ls."productId" = p.id AND ls."locationId" = ${query.locationId} AND ls.quantity <> 0
      )`);
    }
    const having = query.oversold ? Prisma.sql`HAVING COALESCE(SUM(s.quantity), 0) < 0` : Prisma.empty;

    // Whitelisted — never interpolate the raw sort key. costPrice sorting
    // is refused for anyone who can't see cost price, since the row order
    // alone would reveal it.
    const sortColumns: Record<SummarySortKey, string> = {
      sku: 'p.sku',
      name: 'p.name',
      sellingPrice: 'p."sellingPrice"',
      costPrice: 'p."costPrice"',
      totalStock: '"totalStock"',
    };
    const sortAllowed =
      !!query.sort && query.sort in sortColumns && (query.sort !== 'costPrice' || canSeeCostPrice);
    const sortKey: SummarySortKey = sortAllowed ? query.sort! : 'sku';
    // A refused sort falls back to the plain default order, direction included.
    const dir = sortAllowed && query.dir === 'desc' ? 'DESC' : 'ASC';
    const orderBy = Prisma.raw(`${sortColumns[sortKey]} ${dir} NULLS LAST, p.id ASC`);

    const base = Prisma.sql`
      FROM "Product" p
      LEFT JOIN "Stock" s ON s."productId" = p.id
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY p.id
      ${having}
    `;

    const [pageRows, countRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT p.id, COALESCE(SUM(s.quantity), 0) AS "totalStock"
        ${base}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `),
      this.prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS total FROM (SELECT p.id ${base}) t
      `),
    ]);

    const ids = pageRows.map((r) => r.id);
    const products = ids.length
      ? await this.prisma.product.findMany({ where: { id: { in: ids } }, select: SUMMARY_PRODUCT_SELECT })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));

    return {
      data: ids
        .map((id) => byId.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => this.toSummaryRow(p, canSeeCostPrice)),
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    };
  }

  private toSummaryRow(
    product: Prisma.ProductGetPayload<{ select: typeof SUMMARY_PRODUCT_SELECT }>,
    canSeeCostPrice: boolean,
  ) {
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      image: product.image,
      sellingPrice: product.sellingPrice != null ? Number(product.sellingPrice) : null,
      costPrice: canSeeCostPrice && product.costPrice != null ? Number(product.costPrice) : null,
      totalStock: product.stocks.reduce((sum, s) => sum + Number(s.quantity), 0),
      locations: product.stocks.map((s) => ({
        locationId: s.location.id,
        location: s.location.name,
        qty: Number(s.quantity),
      })),
    };
  }

  // NEW: guards the single choke point every session passes through.
  // SalesOrderService.confirm and InvoiceService.issue only skip their own
  // direct stockService.decrease() when WAREHOUSE_OPS is enabled, trusting
  // that a FULFILLMENT session will handle the pick-time decrement instead.
  // If a FULFILLMENT session ever got created for an org that ISN'T on
  // WAREHOUSE_OPS — a bug, a stale caller, a future document type wired up
  // carelessly — stock would be decremented twice: once directly by
  // confirm()/issue(), and again when someone picks against this session.
  // Checking it here means every caller is protected without having to
  // remember to check it themselves. Deliberately checks against
  // this.organizationModulesService (not the tx `client` param) — module
  // enablement isn't being mutated concurrently with session creation, so
  // it doesn't need transactional consistency with the caller's tx.
async create(
  organizationId: string,
  type: SessionType,
  invoiceId?: string,
  client: Pick<PrismaService, 'session' | 'organization' | 'deliveryOrder' | 'invoice' | 'stockImportBatch'> = this.prisma,
  links: { importBatchId?: string; returnInvoiceId?: string } = {},
) {
  if (links.importBatchId && type !== SessionType.RECEIVE) {
    throw new BadRequestException('Only a receive session can be linked to an import');
  }
  if (links.returnInvoiceId && type !== SessionType.RETURNS) {
    throw new BadRequestException('Only a returns session can be linked to a sale');
  }

  // Import-first receiving: arriving goods have no barcodes until the
  // import has created their products and labels have been printed, so a
  // receive session always counts against one import.
  if (type === SessionType.RECEIVE && !links.importBatchId) {
    throw new BadRequestException(
      'Receiving starts from an import — import the delivery first, then start the receiving check from the import results.',
    );
  }

  // Returns are tied to the sale they reverse, so what can come back is
  // capped by what actually went out — shared with delivery-order returns
  // through InvoiceItem.fulfilledQuantity, so the same goods can't be
  // returned twice through the two paths. Required whenever the org
  // invoices at all; an org without INVOICE_POS has no sale to link.
  if (type === SessionType.RETURNS && !links.returnInvoiceId) {
    const invoices = await this.organizationModulesService.isModuleEnabled(organizationId, ModuleKey.INVOICE_POS);
    if (invoices) {
      throw new BadRequestException('Choose the invoice being returned before starting a returns session');
    }
  }

  if (type === SessionType.FULFILLMENT) {
    const hasWarehouseOps = await this.organizationModulesService.isModuleEnabled(
      organizationId,
      ModuleKey.WAREHOUSE_OPS,
    );
    if (!hasWarehouseOps) {
      throw new BadRequestException(
        'Cannot create a fulfillment session for an organization without WAREHOUSE_OPS enabled',
      );
    }
  }

  const doCreate = async (tx: Prisma.TransactionClient) => {
    if (type === SessionType.FULFILLMENT && invoiceId) {
      // Atomic claim — must land before any pick/stock movement can occur,
      // and before the legacy DeliveryOrder check below, since that check
      // exists only as a backstop for pre-migration invoices whose
      // fulfillmentPath is still NULL despite already being DIRECT.
      const claimed = await tx.invoice.updateMany({
        where: { id: invoiceId, organizationId, fulfillmentPath: null },
        data: { fulfillmentPath: 'SESSION' },
      });
      if (claimed.count === 0) {
        const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
        throw new BadRequestException(
          invoice.fulfillmentPath === 'DIRECT_ISSUE'
            ? 'Cannot create fulfillment session. This invoice has already been fulfilled directly.'
            : 'Cannot create fulfillment session. This invoice is already assigned to a warehouse fulfillment session.',
        );
      }

      // Legacy backstop: covers the (post-migration, should be rare) case
      // where DeliveryOrders exist directly against this invoice but the
      // backfill above didn't run or missed a row. Safe to remove once
      // you're confident the backfill is complete and no direct-fulfillment
      // path can still write to DeliveryOrder without claiming DIRECT first.
      const activeDeliveryOrders = await tx.deliveryOrder.count({
        where: { organizationId, invoiceId, status: { not: DeliveryOrderStatus.CANCELLED } },
      });
      if (activeDeliveryOrders > 0) {
        throw new BadRequestException(
          'Cannot create fulfillment session. This invoice has already been fulfilled directly.',
        );
      }
    }

    if (links.importBatchId) {
      const batch = await tx.stockImportBatch.findFirst({
        where: { id: links.importBatchId, organizationId },
      });
      if (!batch) throw new BadRequestException('Import not found');
      if (batch.mode !== 'INCREMENT') {
        throw new BadRequestException(
          'Only an "add to stock" import can be count-checked — a replace import is a stock-take, not a delivery',
        );
      }
    }

    if (links.returnInvoiceId) {
      await this.assertReturnableInvoice(organizationId, links.returnInvoiceId, tx);
    }

    const stages = await this.getStagesForSession(organizationId, type, tx);

    return tx.session.create({
      data: {
        type,
        stage: stages ? stages[0] : null,
        status: 'OPEN',
        organizationId,
        invoiceId,
        importBatchId: links.importBatchId,
        returnInvoiceId: links.returnInvoiceId,
      },
    });
  };

  return client === this.prisma
    ? this.prisma.$transaction((tx) => doCreate(tx))
    : doCreate(client as Prisma.TransactionClient);
}

async findAll(
    organizationId: string,
    filters: { from?: string; to?: string; page?: number; pageSize?: number } = {},
  ) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 20;

    const where: Prisma.SessionWhereInput = { organizationId };
    if (filters.from && filters.to) {
      const gte = new Date(filters.from);
      const lte = new Date(filters.to);
      lte.setHours(23, 59, 59, 999);
      where.createdAt = { gte, lte };
    }

    const [sessions, total] = await this.prisma.$transaction([
      this.prisma.session.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          type: true,
          stage: true,
          status: true,
          createdAt: true,
          _count: { select: { items: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      }),
      this.prisma.session.count({ where }),
    ]);

    return {
      data: sessions.map(({ _count, ...rest }) => ({
        ...rest,
        totalItems: _count.items,
      })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(organizationId: string, id: string) {
    const session = await this.prisma.session.findFirst({
      where: { id, organizationId },
      include: {
        items: {
          include: {
            product: true,
            events: { include: { fromLocation: true, toLocation: true } },
          },
        },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            salesOrderId: true,
            salesOrder: { select: { id: true, orderNumber: true } },
            items: {
              select: {
                productId: true,
                quantity: true,
                locationId: true,
                product: { select: { name: true, sku: true } },
              },
            },
          },
        },
        reopenEvents: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, email: true } } },
        },
        returnInvoice: { select: { id: true, invoiceNumber: true, customerName: true } },
        importBatch: { select: { id: true, createdAt: true } },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, email: true } } },
        },
      },
    });

    if (!session) throw new BadRequestException('Session not found');

    const stages = await this.getStagesForSession(organizationId, session.type);
    const pendingPutaway =
      session.type === SessionType.MOVE ? await this.pendingPutaway(session.id) : [];
    const receiveCheck = session.importBatchId
      ? await this.receiveCheck(organizationId, session.id, session.importBatchId)
      : null;
    const returnLines = session.returnInvoiceId
      ? await this.returnLines(session.id, session.returnInvoiceId)
      : null;
    return { ...session, stages, pendingPutaway, receiveCheck, returnLines };
  }

  // Expected (what the import added) vs counted (RECEIVE scans in this
  // session), per product. Products scanned but not in the import show up
  // with expected 0, so an extra item is as visible as a missing one.
  private async receiveCheck(organizationId: string, sessionId: string, importBatchId: string) {
    const [expectedRows, countedRows] = await Promise.all([
      this.prisma.event.groupBy({
        by: ['productId'],
        where: { importBatchId, organizationId },
        _sum: { quantity: true },
      }),
      this.prisma.event.groupBy({
        by: ['productId'],
        where: { sessionId, type: EventType.RECEIVE },
        _sum: { quantity: true },
      }),
    ]);
    const expected = new Map(expectedRows.map((r) => [r.productId, Number(r._sum.quantity ?? 0)]));
    const counted = new Map(countedRows.map((r) => [r.productId, Number(r._sum.quantity ?? 0)]));
    const productIds = [...new Set([...expected.keys(), ...counted.keys()])];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      select: { id: true, name: true, sku: true },
    });
    return products
      .map((p) => {
        const exp = expected.get(p.id) ?? 0;
        const cnt = counted.get(p.id) ?? 0;
        return { productId: p.id, name: p.name, sku: p.sku, expected: exp, counted: cnt, difference: cnt - exp };
      })
      .sort((a, b) => (a.sku ?? '').localeCompare(b.sku ?? ''));
  }

  // Per product on the linked invoice: sold, still returnable (shared with
  // delivery-order returns via fulfilledQuantity), and returned in this
  // session.
  private async returnLines(sessionId: string, invoiceId: string) {
    const [items, returnedHere] = await Promise.all([
      this.prisma.invoiceItem.findMany({
        where: { invoiceId, productId: { not: null } },
        select: {
          productId: true, quantity: true, fulfilledQuantity: true,
          productName: true, sku: true, product: { select: { name: true, sku: true } },
        },
      }),
      this.prisma.event.groupBy({
        by: ['productId'],
        where: { sessionId, type: EventType.RETURNS },
        _sum: { quantity: true },
      }),
    ]);
    const returned = new Map(returnedHere.map((r) => [r.productId, Number(r._sum.quantity ?? 0)]));
    const byProduct = new Map<string, { productId: string; name: string; sku: string | null; sold: number; returnable: number; returnedHere: number }>();
    for (const i of items) {
      const row = byProduct.get(i.productId!) ?? {
        productId: i.productId!,
        name: i.productName ?? i.product?.name ?? '',
        sku: i.sku ?? i.product?.sku ?? null,
        sold: 0,
        returnable: 0,
        returnedHere: returned.get(i.productId!) ?? 0,
      };
      row.sold += Number(i.quantity);
      row.returnable += i.fulfilledQuantity;
      byProduct.set(i.productId!, row);
    }
    return [...byProduct.values()];
  }

  // Stage/status transitions below all read the session, validate, then
  // write. The write is conditional on the values that were validated
  // (status + stage), so two concurrent clicks — or a click racing a
  // reopen/complete — can't both apply against the same starting state.
  private async guardedSessionUpdate(
    organizationId: string,
    id: string,
    expected: { status: string; stage: EventType | null },
    data: Prisma.SessionUpdateManyMutationInput,
    client: Pick<Prisma.TransactionClient, 'session'> = this.prisma,
  ) {
    const res = await client.session.updateMany({
      where: { id, organizationId, status: expected.status, stage: expected.stage },
      data,
    });
    if (res.count === 0) {
      throw new ConflictException('Session changed since it was loaded, please refresh and retry');
    }
    return client.session.findUniqueOrThrow({ where: { id } });
  }

  // Quantity-weighted average of unitCost across rows for one product, so
  // two lines of the same product at different costs on one document blend
  // into a single defensible number instead of one winning arbitrarily.
  // Rows with no cost snapshot are excluded rather than treated as zero.
  private weightedAvgUnitCost(
    rows: { quantity: Prisma.Decimal | number; unitCost: Prisma.Decimal | null }[],
  ): number | null {
    let costedQty = 0;
    let costedTotal = 0;
    for (const r of rows) {
      if (r.unitCost == null) continue;
      const qty = Number(r.quantity);
      costedQty += qty;
      costedTotal += qty * Number(r.unitCost);
    }
    return costedQty > 0 ? costedTotal / costedQty : null;
  }

  // Splits a single pick's qty across the order lines it actually draws
  // from, FIFO by line order, instead of blending one average cost across
  // every line for the product. `alreadyPicked` is how much of this
  // product this session picked before this call (so a later pick resumes
  // consumption where the previous one left off rather than starting over
  // from line 1 each time).
  private allocateFifo(
    lines: { quantity: Prisma.Decimal | number; unitCost: Prisma.Decimal | null }[],
    qty: number,
    alreadyPicked: number,
  ): { quantity: number; unitCost: number }[] | null {
    const costed = lines
      .filter((l) => l.unitCost != null)
      .map((l) => ({ quantity: Number(l.quantity), unitCost: Number(l.unitCost) }));
    if (costed.length === 0) return null;

    const slices: { quantity: number; unitCost: number }[] = [];
    let skip = alreadyPicked;
    let remaining = qty;

    for (const line of costed) {
      if (remaining <= 0) break;
      let available = line.quantity;
      if (skip > 0) {
        const consumed = Math.min(skip, available);
        available -= consumed;
        skip -= consumed;
      }
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      slices.push({ quantity: take, unitCost: line.unitCost });
      remaining -= take;
    }

    if (slices.length === 0) return null;
    if (remaining > 0) {
      // Picked more than the known lines account for (shouldn't happen —
      // the invoice-item path is guarded against over-picking above — but
      // cost any overflow at the last known line's rate rather than
      // dropping it from COGS silently).
      slices.push({ quantity: remaining, unitCost: costed[costed.length - 1].unitCost });
    }
    return slices;
  }

  // Resolves the unit cost(s) to post COGS with at pick time, as slices of
  // (quantity, unitCost) so a pick spanning more than one order line posts
  // each portion at its own line's cost. Tries the linked Invoice's
  // item(s) first (same unitCost snapshot DeliveryOrderService already
  // relies on), then the linked SalesOrder's item(s). Returns [] — not
  // Product.costPrice — when a linked document exists but has no snapshot,
  // since costPrice can drift after the order was placed and postCogs()
  // already treats a null unitCost as "skip this line" rather than posting
  // a fabricated amount.
  //
  // The one exception is a session with NO source document at all (an
  // ad-hoc FULFILLMENT started from the warehouse hub, or an integration
  // order): there's no order-time snapshot to drift from, so the product's
  // current costPrice IS the pick-time snapshot. Without this, those picks
  // took stock out with no COGS entry at all.
  //
  // Only the invoice path gets exact FIFO attribution: InvoiceItem.id is
  // an autoincrement int, so ordering by it reliably reflects the order
  // lines were entered in. SalesOrderItem and DeliveryOrderItem use uuid
  // ids with no createdAt/sequence column, so there's no reliable line
  // order to allocate against for those — they fall back to a
  // quantity-weighted average across all of that product's lines, same as
  // before.
  private async resolvePickCostSlices(
    session: { id: string; invoiceId: string | null; salesOrderId?: string | null },
    productId: string,
    qty: number,
    alreadyPicked: number,
    productCostPrice: Prisma.Decimal | null,
    tx: Prisma.TransactionClient,
  ): Promise<{ quantity: number; unitCost: number }[]> {
    if (session.invoiceId) {
      const invoiceItems = await tx.invoiceItem.findMany({
        where: { invoiceId: session.invoiceId, productId },
        select: { quantity: true, unitCost: true },
        orderBy: { id: 'asc' },
      });
      const slices = this.allocateFifo(invoiceItems, qty, alreadyPicked);
      if (slices != null) return slices;
    }
    if (session.salesOrderId) {
      const salesOrderItems = await tx.salesOrderItem.findMany({
        where: { salesOrderId: session.salesOrderId, productId },
        select: { quantity: true, unitCost: true },
      });
      const cost = this.weightedAvgUnitCost(salesOrderItems);
      if (cost != null) return [{ quantity: qty, unitCost: cost }];
    }
    // Session-linked delivery orders snapshot unitCost per item; ship() skips
    // COGS for them, so the pick is the only place it can post.
    const deliveryItems = await tx.deliveryOrderItem.findMany({
      where: { productId, deliveryOrder: { sessionId: session.id } },
      select: { quantity: true, unitCost: true },
    });
    const cost = this.weightedAvgUnitCost(deliveryItems);
    if (cost != null) return [{ quantity: qty, unitCost: cost }];

    const unlinked = !session.invoiceId && !session.salesOrderId && deliveryItems.length === 0;
    if (unlinked && productCostPrice != null) {
      return [{ quantity: qty, unitCost: Number(productCostPrice) }];
    }
    return [];
  }

  // Unit cost to put returned stock back on the books at. Mirrors
  // resolvePickCostSlices' source order (invoice → sales order), falling
  // back to the product's current costPrice — a RETURNS session is usually
  // not linked to the original sale, so that's the common path.
  private async resolveReturnUnitCost(
    session: { invoiceId: string | null; salesOrderId?: string | null },
    productId: string,
    productCostPrice: Prisma.Decimal | null,
    tx: Prisma.TransactionClient,
  ): Promise<number | null> {
    if (session.invoiceId) {
      const invoiceItems = await tx.invoiceItem.findMany({
        where: { invoiceId: session.invoiceId, productId },
        select: { quantity: true, unitCost: true },
      });
      const cost = this.weightedAvgUnitCost(invoiceItems);
      if (cost != null) return cost;
    }
    if (session.salesOrderId) {
      const salesOrderItems = await tx.salesOrderItem.findMany({
        where: { salesOrderId: session.salesOrderId, productId },
        select: { quantity: true, unitCost: true },
      });
      const cost = this.weightedAvgUnitCost(salesOrderItems);
      if (cost != null) return cost;
    }
    return productCostPrice != null ? Number(productCostPrice) : null;
  }

  // Per-product quantity picked in a MOVE session that hasn't been put
  // away at a destination yet. PICK already decremented the source, and
  // only the MOVE stage increments the destination, so anything left here
  // when the session completes would silently vanish from inventory.
  async pendingPutaway(
    sessionId: string,
    client: Pick<Prisma.TransactionClient, 'event' | 'product'> = this.prisma,
  ) {
    const sums = await client.event.groupBy({
      by: ['productId', 'type'],
      where: { sessionId, type: { in: [EventType.PICK, EventType.MOVE] } },
      _sum: { quantity: true },
    });

    const byProduct = new Map<string, { picked: number; moved: number }>();
    for (const row of sums) {
      const entry = byProduct.get(row.productId) ?? { picked: 0, moved: 0 };
      const qty = Math.abs(Number(row._sum.quantity ?? 0));
      if (row.type === EventType.PICK) entry.picked += qty;
      else entry.moved += qty;
      byProduct.set(row.productId, entry);
    }

    const pending = [...byProduct.entries()]
      .map(([productId, { picked, moved }]) => ({ productId, picked, moved, pending: picked - moved }))
      .filter((p) => p.pending > 0);
    if (pending.length === 0) return [];

    const products = await client.product.findMany({
      where: { id: { in: pending.map((p) => p.productId) } },
      select: { id: true, name: true, sku: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    return pending.map((p) => ({ ...p, product: productById.get(p.productId) ?? null }));
  }
  async addItem(
    organizationId: string,
    sessionId: string,
    productId: string,
    qty: number,
    fromLocationId?: string,
    toLocationId?: string,
    reason?: string,
    userId?: string,
  ) {
    if (qty == null || qty <= 0) {
      throw new BadRequestException('Invalid quantity');
    }

    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, organizationId },
    });
    if (!session) throw new BadRequestException('Session not found');
    this.assertOpenForScanning(session.status);
    if ((session.invoiceId || session.returnInvoiceId) && !Number.isInteger(qty)) {
      throw new BadRequestException('Quantity must be a whole number for a session linked to an invoice');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
    });
    if (!product) throw new BadRequestException('Product not found');
    if (!product.active) {
      throw new BadRequestException(
        'Product is archived — restore it before scanning it into a session',
      );
    }

    const stages = await this.getStagesForSession(organizationId, session.type);
    const isStaged = stages !== null;

    if (isStaged && !session.stage) {
      throw new BadRequestException('Session has no active stage');
    }

    const effectiveType: EventType = isStaged
      ? (session.stage as EventType)
      : (session.type as unknown as EventType);

    if (!isStaged && !Object.values(EventType).includes(effectiveType)) {
      throw new BadRequestException(`Session type ${session.type} has no corresponding event type`);
    }

    if (effectiveType === EventType.RETURNS) {
      if (!reason || !RETURN_REASONS.includes(reason as ReturnReason)) {
        throw new BadRequestException(
          `A valid reason is required for returns (one of: ${RETURN_REASONS.join(', ')})`,
        );
      }
      if (!toLocationId) {
        throw new BadRequestException(
          'toLocationId is required for returned stock',
        );
      }
    }

    if (effectiveType === EventType.MOVE) {
      if (!toLocationId) {
        throw new BadRequestException(
          'toLocationId is required to complete a move',
        );
      }
    }

    if (effectiveType === EventType.PICK) {
      if (!fromLocationId) {
        throw new BadRequestException(
          'fromLocationId is required to pick stock',
        );
      }
    }

    // FIX — was default (Read Committed) isolation. The stage-remaining
    // check (priorTotal - currentTotal vs qty) and the invoice over-pick
    // check (alreadyPicked + qty > orderedQty) below both read an
    // aggregate then compare, with no row lock — two concurrent addItem()
    // calls against the same session/product near the boundary could both
    // read the same "remaining" value and both pass, together exceeding
    // the ordered/remaining quantity. payment.service.ts uses Serializable
    // for exactly this class of problem; this now matches. The physical
    // stock decrement further down (PICK case) is already a safe atomic
    // updateMany, so this closes the business-rule race, not a stock one.
    try {
      return await runSerializable(this.prisma, async (tx) => {
      // The status/stage read above happened outside this transaction, so
      // a concurrent complete()/advanceStage()/regressStage() call (none of
      // which run at Serializable isolation) could have changed either
      // since then. Re-check the fresh values before mutating anything —
      // effectiveType/isStaged/stages were derived from the stale read, so
      // if either moved, bail out and let the caller retry against current
      // state rather than silently applying a scan to the wrong stage or a
      // now-completed session.
      const freshSession = await tx.session.findFirst({
        where: { id: sessionId, organizationId },
        select: { status: true, stage: true },
      });
      if (!freshSession) throw new BadRequestException('Session not found');
      this.assertOpenForScanning(freshSession.status);
      if (freshSession.stage !== session.stage) {
        throw new ConflictException(
          'Session stage changed since this scan started, please retry',
        );
      }

      const locationIds = [fromLocationId, toLocationId].filter(
        Boolean,
      ) as string[];
      for (const locId of locationIds) {
        const loc = await tx.location.findFirst({
          where: { id: locId, organizationId },
          select: { id: true },
        });
        if (!loc) throw new BadRequestException(`Location not found: ${locId}`);
      }

      if (isStaged) {
        const currentIdx = stages!.indexOf(effectiveType);
        const priorStage = currentIdx > 0 ? stages![currentIdx - 1] : null;

        if (priorStage) {
          const [priorAgg, currentAgg] = await Promise.all([
            tx.event.aggregate({
              where: { sessionId, productId, type: priorStage },
              _sum: { quantity: true },
            }),
            tx.event.aggregate({
              where: { sessionId, productId, type: effectiveType },
              _sum: { quantity: true },
            }),
          ]);

          // PICK events are stored with a negative quantity (see the
          // Event.create below), so a prior/current stage of PICK would
          // otherwise sum to a negative total here — abs() normalizes
          // both sides regardless of which stage the sign convention
          // applies to, matching the invoice over-pick check below.
          const priorTotal = Math.abs(Number(priorAgg._sum.quantity ?? 0));
          const currentTotal = Math.abs(Number(currentAgg._sum.quantity ?? 0));
          const remaining = priorTotal - currentTotal;

          if (qty > remaining) {
            throw new BadRequestException(
              remaining <= 0
                ? `Nothing left to ${effectiveType.toLowerCase()} for this product — already completed everything from the ${priorStage.toLowerCase()} stage (${priorTotal}).`
                : `Cannot ${effectiveType.toLowerCase()} ${qty} — only ${remaining} unit(s) remain from the ${priorStage.toLowerCase()} stage (${priorStage.toLowerCase()}ed ${priorTotal}, already ${effectiveType.toLowerCase()}ed ${currentTotal}).`,
            );
          }
        }
      }

      if (session.type === SessionType.FULFILLMENT && effectiveType === EventType.PICK && session.invoiceId) {
        const invoiceItems = await tx.invoiceItem.findMany({
          where: { invoiceId: session.invoiceId, productId },
          select: { quantity: true },
        });
        const orderedQty = invoiceItems.reduce((sum, i) => sum + i.quantity, 0);

        if (orderedQty > 0) {
          const pickedAgg = await tx.event.aggregate({
            where: { sessionId, productId, type: EventType.PICK },
            _sum: { quantity: true },
          });
          const alreadyPicked = Math.abs(Number(pickedAgg._sum.quantity ?? 0));

          if (alreadyPicked + qty > orderedQty) {
            throw new BadRequestException(
              `Cannot pick ${qty} — only ${Math.max(orderedQty - alreadyPicked, 0)} unit(s) of this product remain on the invoice (ordered ${orderedQty}, already picked ${alreadyPicked}).`,
            );
          }
        }
      }

      const item = await tx.sessionItem.create({
        data: { sessionId, productId, quantity: qty },
      });

      await tx.event.create({
        data: {
          productId,
          sessionId,
          sessionItemId: item.id,
          type: effectiveType,
          quantity: effectiveType === EventType.PICK ? -qty : qty,
          invoiceId:
            effectiveType === EventType.RETURNS
              ? session.returnInvoiceId ?? undefined
              : effectiveType === EventType.PICK && session.type === SessionType.FULFILLMENT
                ? session.invoiceId ?? undefined
                : undefined,
          fromLocationId,
          toLocationId,
          userId,
          organizationId,
          metadata:
            effectiveType === EventType.RETURNS
              ? { reason }
              : effectiveType === EventType.RECEIVE
                ? { note: 'receiving count — stock set by import, not this scan' }
                : { reason: 'session item added' },
        },
      });

      switch (effectiveType) {
        case EventType.RECEIVE:
          break;

        case EventType.RETURNS: {
          await tx.stock.upsert({
            where: {
              productId_locationId: { productId, locationId: toLocationId! },
            },
            update: { quantity: { increment: qty } },
            create: {
              productId,
              locationId: toLocationId!,
              quantity: qty,
              organizationId,
            },
          });

          if (session.returnInvoiceId) {
            await this.applyLinkedReturn(tx, organizationId, {
              sessionId,
              sessionItemId: item.id,
              invoiceId: session.returnInvoiceId,
              productId,
              qty,
              toLocationId: toLocationId!,
              reason,
            });
            break;
          }

          // Unlinked return (org without invoicing): returned stock goes
          // back on the books at cost — Dr Inventory, Cr COGS — so the GL
          // inventory balance keeps tracking the physical increment.
          const unitCost = await this.resolveReturnUnitCost(session, productId, product.costPrice, tx);
          if (unitCost != null) {
            await this.postingRules.postCogsReturn(
              organizationId,
              {
                sourceId: `${sessionId}:cogs:return:${item.id}`,
                date: new Date(),
                memo: `COGS reversal for returns session ${sessionId} (${reason})`,
                lines: [{ productId, quantity: qty, unitCost, locationId: toLocationId ?? null }],
              },
              tx,
            );
          } else {
            this.logger.warn(
              `No unitCost for product ${productId} in returns session ${sessionId}; COGS reversal not posted`,
            );
          }
          break;
        }

        case EventType.MOVE: {
          await tx.stock.upsert({
            where: {
              productId_locationId: { productId, locationId: toLocationId! },
            },
            update: { quantity: { increment: qty } },
            create: {
              productId,
              locationId: toLocationId!,
              quantity: qty,
              organizationId,
            },
          });
          break;
        }

        case EventType.PICK: {
const picked = await tx.stock.updateMany({
  where: { productId, locationId: fromLocationId!, organizationId, quantity: { gte: qty } },
  data: { quantity: { decrement: qty } },
});
if (picked.count === 0) {
  throw new BadRequestException('Insufficient stock at source location');
}
if (session.type === SessionType.FULFILLMENT && session.invoiceId) {
  await this.recordInvoicePick(tx, organizationId, session.invoiceId, productId, qty);
}

          // This is the pick-time stock decrement that DeliveryOrder.ship()'s
          // comment points at as the COGS trigger for warehouse-ops orgs:
          // for a session-linked delivery, ship() deliberately skips COGS
          // because stock already left here, not at ship(). Only posts for
          // FULFILLMENT sessions — a PICK inside a MOVE session is a
          // warehouse transfer, not a sale, and has nothing to expense.
          //
          // Verified no double-posting: InvoiceService.issue() only pushes
          // into costedLines when decreasesStockHere is true, which is
          // false whenever hasWarehouseOps is on; editIssuedInvoice() gates
          // its repost behind `if (!hasWarehouseOps)` directly; and
          // DeliveryOrder.ship() sets shouldDecreaseStock = !sessionId, so
          // costedLines stays empty and its postCogs() call never fires for
          // a session-linked delivery. All three skip COGS whenever a
          // FULFILLMENT session already posted it here.
if (session.type === SessionType.FULFILLMENT) {
  const pickedAgg = await tx.event.aggregate({
    where: { sessionId, productId, type: EventType.PICK },
    _sum: { quantity: true },
  });
  // pickedAgg already includes this pick's own event (inserted above with
  // quantity -qty), so back it out to get what was picked before this call.
  const alreadyPicked = Math.abs(Number(pickedAgg._sum.quantity ?? 0)) - qty;
  const costSlices = await this.resolvePickCostSlices(session, productId, qty, alreadyPicked, product.costPrice, tx);
  if (costSlices.length > 0) {
    await this.postingRules.postCogs(
      organizationId,
      {
        sourceId: `${sessionId}:cogs:pick:${item.id}`,
        date: new Date(),
        memo: `COGS for pick session ${sessionId}`,
        lines: costSlices.map((s) => ({
          productId,
          quantity: s.quantity,
          unitCost: s.unitCost,
          locationId: fromLocationId ?? null,
        })),
      },
      tx,
    );
  } else {
    this.logger.warn(
      `No unitCost for product ${productId} in session ${sessionId}; COGS not posted for this pick`,
    );
  }
          }
          break;
        }

        case EventType.SHIP:
          break;

        case EventType.PACK:
        default:
          break;
      }

      return item;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('This session item conflicted with a concurrent update, please retry');
      }
      throw e;
    }
  }

  async advanceStage(organizationId: string, id: string) {
    const session = await this.prisma.session.findFirst({
      where: { id, organizationId },
    });
    if (!session) throw new BadRequestException('Session not found');
    if (session.status !== 'OPEN') {
      throw new BadRequestException(`Session is ${session.status.toLowerCase()} — stages can only change on an open session`);
    }

    const stages = await this.getStagesForSession(organizationId, session.type);
    if (!stages) {
      throw new BadRequestException('This session type has no stages');
    }

    const currentIndex = stages.indexOf(session.stage as EventType);
    const nextStage = stages[currentIndex + 1];
    if (!nextStage) {
      throw new BadRequestException(
        'Already at the final stage — complete the session instead',
      );
    }

    return this.guardedSessionUpdate(
      organizationId, id,
      { status: session.status, stage: session.stage },
      { stage: nextStage },
    );
  }

  async regressStage(organizationId: string, id: string) {
    const session = await this.prisma.session.findFirst({
      where: { id, organizationId },
    });
    if (!session) throw new BadRequestException('Session not found');
    if (session.status === 'COMPLETED') {
      throw new BadRequestException(
        'Session is already completed — reopen it before changing stage',
      );
    }
    if (session.status !== 'OPEN') {
      throw new BadRequestException(`Session is ${session.status.toLowerCase()} — stages can only change on an open session`);
    }

    const stages = await this.getStagesForSession(organizationId, session.type);
    if (!stages) {
      throw new BadRequestException('This session type has no stages');
    }

    const currentIndex = stages.indexOf(session.stage as EventType);
    const prevStage = stages[currentIndex - 1];
    if (!prevStage) {
      throw new BadRequestException('Already at the first stage');
    }

    return this.guardedSessionUpdate(
      organizationId, id,
      { status: session.status, stage: session.stage },
      { stage: prevStage },
    );
  }

  async complete(organizationId: string, id: string) {
    const session = await this.prisma.session.findFirst({
      where: { id, organizationId },
    });

    if (!session) throw new BadRequestException('Session not found');
    if (session.status === 'COMPLETED') return session;
    if (session.status !== 'OPEN') {
      throw new BadRequestException(`Session is ${session.status.toLowerCase()} and cannot be completed`);
    }

    const stages = await this.getStagesForSession(organizationId, session.type);
    if (stages) {
      const finalStage = stages[stages.length - 1];
      if (session.stage !== finalStage) {
        throw new BadRequestException(
          `Session must reach the ${finalStage} stage before completing (currently: ${session.stage})`,
        );
      }
    }

    // Serializable so a put-away scan committing concurrently can't slip
    // between the pending check and the status flip (addItem runs at the
    // same level, so one of the two gets a P2034 instead).
    try {
      return await runSerializable(this.prisma, async (tx) => {
        if (session.type === SessionType.MOVE) {
          const pending = await this.pendingPutaway(id, tx);
          if (pending.length > 0) {
            const list = pending
              .map((p) => `${p.product?.sku ?? p.productId} (${p.pending})`)
              .join(', ');
            throw new BadRequestException(
              `Cannot complete — picked stock has not been put away yet: ${list}. Scan it into a destination location first.`,
            );
          }
        }

        return this.guardedSessionUpdate(
          organizationId, id,
          { status: session.status, stage: session.stage },
          { status: 'COMPLETED', completedAt: new Date() },
          tx,
        );
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('Session changed while completing, please retry');
      }
      throw e;
    }
  }

  async reopen(organizationId: string, id: string, reason: string, userId?: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to reopen a session');
    }

    const session = await this.prisma.session.findFirst({
      where: { id, organizationId },
    });
    if (!session) throw new BadRequestException('Session not found');
    if (session.status !== 'COMPLETED') {
      throw new BadRequestException('Only completed sessions can be reopened');
    }

    const stages = await this.getStagesForSession(organizationId, session.type);

    return this.prisma.$transaction(async (tx) => {
      // Guarded first, so a double-submitted reopen doesn't log two
      // reopen events for one actual reopen.
      const reopened = await this.guardedSessionUpdate(
        organizationId, id,
        { status: 'COMPLETED', stage: session.stage },
        {
          status: 'OPEN',
          completedAt: null,
          stage: stages ? stages[0] : session.stage,
        },
        tx,
      );

      await tx.sessionReopenEvent.create({
        data: { sessionId: id, reason, userId },
      });

      return reopened;
    });
  }

  // Scans are only accepted on an OPEN session. CANCELLED (set by an
  // admin cancel, or by InvoiceService's void flow) must block them too —
  // previously only COMPLETED was checked, so a voided invoice's session
  // could still be picked, decrementing stock and posting COGS against a
  // sale that no longer exists.
  private assertOpenForScanning(status: string) {
    if (status === 'COMPLETED') {
      throw new BadRequestException('Session is completed — reopen it before adding items');
    }
    if (status !== 'OPEN') {
      throw new BadRequestException(`Session is ${status.toLowerCase()} — no further items can be added`);
    }
  }

  // Admin-only (enforced at the controller). Cancelling is only allowed
  // while the session has had no physical or financial effect, because
  // there's no safe automatic undo: a pick has decremented stock and
  // posted COGS, a put-away/return has incremented stock that may since
  // have been consumed. RECEIVE (count-only) and PACK/SHIP events don't
  // move stock, so they don't block. Invoice-linked sessions are refused
  // too — the invoice holds the one-session-per-invoice claim, and voiding
  // the invoice already cancels its session while releasing everything
  // else consistently.
  async cancel(organizationId: string, id: string, reason: string, userId?: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to cancel a session');
    }

    try {
      return await runSerializable(this.prisma, async (tx) => {
        const session = await tx.session.findFirst({
          where: { id, organizationId },
          include: {
            invoice: { select: { invoiceNumber: true } },
            _count: { select: { deliveryOrders: true } },
          },
        });
        if (!session) throw new BadRequestException('Session not found');
        if (session.status !== 'OPEN') {
          throw new BadRequestException(`Only open sessions can be cancelled (this one is ${session.status.toLowerCase()})`);
        }
        if (session.invoiceId) {
          throw new BadRequestException(
            `This session fulfils invoice ${session.invoice?.invoiceNumber ?? session.invoiceId} — void the invoice instead, which cancels this session with it.`,
          );
        }
        if (session._count.deliveryOrders > 0) {
          throw new BadRequestException(
            'Delivery orders have already been generated from this session — cancel those first.',
          );
        }

        const stockEvents = await tx.event.count({
          where: {
            sessionId: id,
            type: { in: [EventType.PICK, EventType.MOVE, EventType.RETURNS] },
          },
        });
        if (stockEvents > 0) {
          throw new BadRequestException(
            'Stock has already moved in this session, so it cannot be cancelled. Finish it instead — for a move, put picked stock back at its source location, then complete.',
          );
        }

        const cancelled = await this.guardedSessionUpdate(
          organizationId, id,
          { status: 'OPEN', stage: session.stage },
          { status: 'CANCELLED' },
          tx,
        );

        await tx.sessionNote.create({
          data: { sessionId: id, note: `Session cancelled: ${reason.trim()}`, userId },
        });

        return cancelled;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('Session changed while cancelling, please retry');
      }
      throw e;
    }
  }

  async addNote(organizationId: string, id: string, note: string, userId?: string) {
    if (!note?.trim()) {
      throw new BadRequestException('Note text is required');
    }

    const session = await this.prisma.session.findFirst({
      where: { id, organizationId },
    });
    if (!session) throw new BadRequestException('Session not found');

    return this.prisma.sessionNote.create({
      data: { sessionId: id, note, userId },
    });
  }
}