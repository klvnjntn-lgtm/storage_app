import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  parseDateOnly,
  resolveTimezone,
  todayBusinessDate,
} from '../accounting/business-date';
import { allocateOnHand } from './batch-allocation';
import { CreateBatchDto } from './dto/batches.dto';

type Tx = Prisma.TransactionClient;

const DAY = 86_400_000;
// Admins are warned when a batch is this many days from expiry.
const EXPIRY_WARNINGS = [30, 7, 1];

// Batch/lot and expiry tracking for products with trackBatches. See
// ProductBatch and batch-allocation.ts for how remaining quantities are
// derived rather than stored.
@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async setTracking(
    organizationId: string,
    productId: string,
    trackBatches: boolean,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.product.update({
      where: { id: productId },
      data: { trackBatches },
      select: { id: true, trackBatches: true },
    });
  }

  // For stock that predates tracking: lets the business record what's
  // already on the shelf.
  async create(organizationId: string, dto: CreateBatchDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, organizationId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    try {
      return await this.prisma.productBatch.create({
        data: {
          organizationId,
          productId: dto.productId,
          batchNumber: dto.batchNumber.trim(),
          expiryDate: dto.expiryDate
            ? parseDateOnly(dto.expiryDate, 'expiryDate')
            : null,
          quantity: dto.quantity,
          note: dto.note?.trim() || null,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'This product already has a batch with that number',
        );
      }
      throw e;
    }
  }

  // Goods receipt side: the batch the received units belong to, created on
  // first sight and topped up when the same batch arrives again.
  async receiveIntoBatch(
    tx: Tx,
    params: {
      organizationId: string;
      productId: string;
      batchNumber: string;
      expiryDate: Date | null;
      quantity: number;
    },
  ) {
    const batchNumber = params.batchNumber.trim();
    return tx.productBatch.upsert({
      where: {
        productId_batchNumber: { productId: params.productId, batchNumber },
      },
      create: {
        organizationId: params.organizationId,
        productId: params.productId,
        batchNumber,
        expiryDate: params.expiryDate,
        quantity: params.quantity,
      },
      update: {
        quantity: { increment: params.quantity },
        ...(params.expiryDate && { expiryDate: params.expiryDate }),
      },
    });
  }

  // Batches with what's left of each. With expiringWithinDays, only those
  // that still have stock and expire within that many days (or already
  // have) — the expiry report.
  async list(
    organizationId: string,
    opts: { productId?: string; expiringWithinDays?: number } = {},
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const today = todayBusinessDate(resolveTimezone(org));

    const batches = await this.prisma.productBatch.findMany({
      where: {
        organizationId,
        ...(opts.productId && { productId: opts.productId }),
      },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
      },
      orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
    });
    const productIds = [...new Set(batches.map((b) => b.productId))];
    const stock = await this.prisma.stock.groupBy({
      by: ['productId'],
      where: { organizationId, productId: { in: productIds } },
      _sum: { quantity: true },
    });
    const onHandBy = new Map(
      stock.map((s) => [s.productId, Number(s._sum.quantity ?? 0)]),
    );

    const byProduct = new Map<string, typeof batches>();
    for (const b of batches)
      byProduct.set(b.productId, [...(byProduct.get(b.productId) ?? []), b]);
    const remainingBy = new Map<string, number>();
    const unassignedBy = new Map<string, number>();
    for (const [productId, list] of byProduct) {
      const { remaining, unassigned } = allocateOnHand(
        list.map((b) => ({
          id: b.id,
          quantity: Number(b.quantity),
          expiryDate: b.expiryDate,
          receivedAt: b.receivedAt,
        })),
        onHandBy.get(productId) ?? 0,
      );
      for (const [id, q] of remaining) remainingBy.set(id, q);
      unassignedBy.set(productId, unassigned);
    }

    const rows = batches.map((b) => {
      const daysToExpiry = b.expiryDate
        ? Math.round((b.expiryDate.getTime() - today.getTime()) / DAY)
        : null;
      return {
        id: b.id,
        product: b.product,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate,
        receivedAt: b.receivedAt,
        received: Number(b.quantity),
        remaining: remainingBy.get(b.id) ?? 0,
        daysToExpiry,
        note: b.note,
      };
    });
    const filtered =
      opts.expiringWithinDays !== undefined
        ? rows.filter(
            (r) =>
              r.remaining > 0 &&
              r.daysToExpiry !== null &&
              r.daysToExpiry <= opts.expiringWithinDays!,
          )
        : rows;
    return {
      batches: filtered,
      unassigned: [...unassignedBy]
        .filter(([, q]) => q > 0)
        .map(([productId, quantity]) => ({ productId, quantity })),
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async notifyExpiring() {
    const orgs = await this.prisma.productBatch.groupBy({
      by: ['organizationId'],
      where: { expiryDate: { not: null } },
    });
    for (const { organizationId } of orgs) {
      try {
        const { batches } = await this.list(organizationId, {
          expiringWithinDays: Math.max(...EXPIRY_WARNINGS),
        });
        const due = batches.filter(
          (b) =>
            b.daysToExpiry !== null && EXPIRY_WARNINGS.includes(b.daysToExpiry),
        );
        if (due.length === 0) continue;
        const admins = await this.prisma.user.findMany({
          where: {
            organizationId,
            role: 'ADMIN',
            active: true,
            removedAt: null,
          },
          select: { id: true },
        });
        await this.notifications.createMany(
          organizationId,
          admins.map((a) => a.id),
          'BATCH_EXPIRING',
          `${due.length} batch${due.length > 1 ? 'es' : ''} expiring soon`,
          {
            body: due
              .slice(0, 5)
              .map(
                (b) =>
                  `${b.product.name} (${b.batchNumber}) — ${b.daysToExpiry}d`,
              )
              .join(', '),
            link: '/inventory/batches',
          },
        );
      } catch (err) {
        this.logger.warn(
          `Expiry check failed for org ${organizationId}: ${err}`,
        );
      }
    }
  }
}
