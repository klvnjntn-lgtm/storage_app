// src/sessions/sessions.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventType, SessionType, FulfillmentMode, ModuleKey } from '@prisma/client';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationModulesService: OrganizationModulesService,
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
        id: true, sku: true, name: true,
        sellingPrice: true, costPrice: true,
        stocks: { select: { quantity: true, location: { select: { name: true } } } },
      },
    });

    return products.map((product) => ({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      sellingPrice: product.sellingPrice != null ? Number(product.sellingPrice) : null,
      costPrice: canSeeCostPrice && product.costPrice != null ? Number(product.costPrice) : null,
      totalStock: product.stocks.reduce((sum, s) => sum + s.quantity, 0),
      locations: product.stocks.map((s) => ({ location: s.location.name, qty: s.quantity })),
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
    client: Pick<PrismaService, 'session' | 'organization'> = this.prisma,
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

    const stages = await this.getStagesForSession(organizationId, type, client);

    return client.session.create({
      data: {
        type,
        stage: stages ? stages[0] : null,
        status: 'OPEN',
        organizationId,
        invoiceId,
      },
    });
  }

  async findAll(organizationId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        stage: true,
        status: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    });

    return sessions.map(({ _count, ...rest }) => ({
      ...rest,
      totalItems: _count.items,
    }));
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

    return this.prisma.$transaction(async (tx) => {
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

          const priorTotal = priorAgg._sum.quantity ?? 0;
          const currentTotal = currentAgg._sum.quantity ?? 0;
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
          const alreadyPicked = Math.abs(pickedAgg._sum.quantity ?? 0);

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
          const fromStock = await tx.stock.findUnique({
            where: {
              productId_locationId: { productId, locationId: fromLocationId! },
            },
          });
          if (!fromStock || fromStock.quantity < qty) {
            throw new BadRequestException('Insufficient stock at source location');
          }
          await tx.stock.update({
            where: {
              productId_locationId: { productId, locationId: fromLocationId! },
            },
            data: { quantity: { decrement: qty } },
          });
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