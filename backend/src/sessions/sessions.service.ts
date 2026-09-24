// src/sessions/sessions.service.ts
import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventType, SessionType, FulfillmentMode, ModuleKey, Prisma, DeliveryOrderStatus } from '@prisma/client';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import { PostingRulesService } from '../accounting/posting-rules.service'; // NEW
import { JwtPayload } from '../auth/decorators/current-user.decorator';

const RETURN_REASONS = [
  'DAMAGED',
  'WRONG_ITEM',
  'CHANGED_MIND',
  'DEFECTIVE',
  'OTHER',
] as const;
type ReturnReason = (typeof RETURN_REASONS)[number];

const MOVE_STAGES: EventType[] = [EventType.PICK, EventType.MOVE];

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

  async summary(organizationId: string, user: JwtPayload) {
    const canSeeCostPrice =
      user.role === 'ADMIN' &&
          (await this.organizationModulesService.isModuleEnabled(organizationId, ModuleKey.INVOICE_POS));

    const products = await this.prisma.product.findMany({
      where: { organizationId },
      orderBy: { sku: 'asc' },
      select: {
        id: true, sku: true, name: true, image: true,
        sellingPrice: true, costPrice: true,
        stocks: { select: { quantity: true, location: { select: { name: true } } } },
      },
    });

    return products.map((product) => ({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      image: product.image,
      sellingPrice: product.sellingPrice != null ? Number(product.sellingPrice) : null,
      costPrice: canSeeCostPrice && product.costPrice != null ? Number(product.costPrice) : null,
      totalStock: product.stocks.reduce((sum, s) => sum + Number(s.quantity), 0),
      locations: product.stocks.map((s) => ({ location: s.location.name, qty: Number(s.quantity) })),
    }));
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
  client: Pick<PrismaService, 'session' | 'organization' | 'deliveryOrder' | 'invoice'> = this.prisma,
) {
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

    const stages = await this.getStagesForSession(organizationId, type, tx);

    return tx.session.create({
      data: {
        type,
        stage: stages ? stages[0] : null,
        status: 'OPEN',
        organizationId,
        invoiceId,
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
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, email: true } } },
        },
      },
    });

    if (!session) throw new BadRequestException('Session not found');

    const stages = await this.getStagesForSession(organizationId, session.type);
    return { ...session, stages };
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
  // Product.costPrice — when none has a snapshot, since costPrice can
  // drift after the order was placed and postCogs() already treats a null
  // unitCost as "skip this line" rather than posting a fabricated amount.
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
    return cost != null ? [{ quantity: qty, unitCost: cost }] : [];
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
    if (session.status === 'COMPLETED') {
      throw new BadRequestException(
        'Session is completed — reopen it before adding items',
      );
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
      return await this.prisma.$transaction(async (tx) => {
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
      if (freshSession.status === 'COMPLETED') {
        throw new BadRequestException(
          'Session is completed — reopen it before adding items',
        );
      }
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
  const costSlices = await this.resolvePickCostSlices(session, productId, qty, alreadyPicked, tx);
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
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
    if (session.status === 'COMPLETED') {
      throw new BadRequestException('Session is already completed');
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

    return this.prisma.session.update({
      where: { id },
      data: { stage: nextStage },
    });
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

    const stages = await this.getStagesForSession(organizationId, session.type);
    if (!stages) {
      throw new BadRequestException('This session type has no stages');
    }

    const currentIndex = stages.indexOf(session.stage as EventType);
    const prevStage = stages[currentIndex - 1];
    if (!prevStage) {
      throw new BadRequestException('Already at the first stage');
    }

    return this.prisma.session.update({
      where: { id },
      data: { stage: prevStage },
    });
  }

  async complete(organizationId: string, id: string) {
    const session = await this.prisma.session.findFirst({
      where: { id, organizationId },
    });

    if (!session) throw new BadRequestException('Session not found');
    if (session.status === 'COMPLETED') return session;

    const stages = await this.getStagesForSession(organizationId, session.type);
    if (stages) {
      const finalStage = stages[stages.length - 1];
      if (session.stage !== finalStage) {
        throw new BadRequestException(
          `Session must reach the ${finalStage} stage before completing (currently: ${session.stage})`,
        );
      }
    }

    return this.prisma.session.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
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
      await tx.sessionReopenEvent.create({
        data: { sessionId: id, reason, userId },
      });

      return tx.session.update({
        where: { id },
        data: {
          status: 'OPEN',
          completedAt: null,
          stage: stages ? stages[0] : session.stage,
        },
      });
    });
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