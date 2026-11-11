import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  InvoiceStatus,
  Prisma,
  PurchaseOrderStatus,
  StockTransferStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PurchaseOrderService } from '../purchase-order/purchase-order.service';
import {
  AutoFillReorderDto,
  CreateReorderPosDto,
  ImportReorderDto,
  ReorderSettingsDto,
} from './dto/reorder.dto';
import { CRON_TIMEZONE } from '../common/cron-timezone';
import { ADMIN_ROLES } from '../auth/roles';
import { ensureDefaultBranch } from '../branches/resolve-branch';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const num = (d: Prisma.Decimal | null | undefined) => (d != null ? Number(d) : null);

export type LowStockLine = {
  productId: string;
  name: string;
  sku: string | null;
  unit: string | null;
  onHand: number;
  onOrder: number;
  reorderPoint: number;
  reorderQuantity: number | null;
  suggestedQuantity: number;
  unitCost: number | null;
  preferredSupplier: { id: string; name: string } | null;
  // Set when looking at one branch: the point is that branch's own, not the
  // product's business-wide one (which is then `defaultReorderPoint`).
  branchOverride: boolean;
  defaultReorderPoint: number | null;
};

// Which stock and orders count. null = the whole business.
type Scope = {
  branchId: string;
  // Locations with no branch of their own belong to the org's first branch,
  // the same as documents with none (resolveBranchId).
  isDefaultBranch: boolean;
  locationIds: string[];
} | null;

// Reorder points. A product is low when what's on hand plus what's already
// on order (sent POs not yet received) is at or below its reorder point —
// counting open POs stops the same shortage being ordered twice.
//
// A product's reorderPoint is business-wide and also every branch's default;
// a ProductReorderSetting gives one branch its own. A business with a single
// branch never sees branches here: everything is business-wide.
@Injectable()
export class ReorderService {
  private readonly logger = new Logger(ReorderService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private purchaseOrders: PurchaseOrderService,
  ) {}

  // ---------------------------------------------------------------- scope

  // The branch to work in, or null for business-wide: always null for a
  // single-branch business, so its settings stay on the product.
  async branchFor(organizationId: string, requested?: string | null): Promise<string | null> {
    if (!requested) return null;
    const branches = await this.prisma.branch.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true },
    });
    if (branches.length < 2) return null;
    if (!branches.some((b) => b.id === requested)) throw new BadRequestException('Branch not found');
    return requested;
  }

  private async scopeFor(organizationId: string, branchId: string | null): Promise<Scope> {
    if (!branchId) return null;
    const defaultBranch = await ensureDefaultBranch(this.prisma, organizationId);
    const isDefaultBranch = defaultBranch.id === branchId;
    const locations = await this.prisma.location.findMany({
      where: {
        organizationId,
        OR: [{ branchId }, ...(isDefaultBranch ? [{ branchId: null }] : [])],
      },
      select: { id: true },
    });
    return { branchId, isDefaultBranch, locationIds: locations.map((l) => l.id) };
  }

  private branchWhere(scope: NonNullable<Scope>) {
    return { OR: [{ branchId: scope.branchId }, ...(scope.isDefaultBranch ? [{ branchId: null }] : [])] };
  }

  // On hand (stock plus goods in transit to it) and on order (sent POs not
  // yet received), per product, for the scope.
  private async positions(organizationId: string, productIds: string[], scope: Scope) {
    const onHandBy = new Map<string, number>();
    const onOrderBy = new Map<string, number>();
    if (productIds.length === 0) return { onHandBy, onOrderBy };
    const add = (m: Map<string, number>, id: string, n: number) => m.set(id, (m.get(id) ?? 0) + n);

    const [stock, inTransit, ordered] = await Promise.all([
      this.prisma.stock.groupBy({
        by: ['productId'],
        where: {
          organizationId,
          productId: { in: productIds },
          ...(scope && { locationId: { in: scope.locationIds } }),
        },
        _sum: { quantity: true },
      }),
      // Goods on a transfer between locations are in no Stock row until
      // they land, but they're still the business's — not something to buy.
      // For one branch, only what's heading to it.
      this.prisma.stockTransferItem.groupBy({
        by: ['productId'],
        where: {
          productId: { in: productIds },
          transfer: {
            organizationId,
            status: StockTransferStatus.IN_TRANSIT,
            ...(scope && { toLocationId: { in: scope.locationIds } }),
          },
        },
        _sum: { quantity: true },
      }),
      this.prisma.purchaseOrderItem.findMany({
        where: {
          productId: { in: productIds },
          purchaseOrder: {
            organizationId,
            status: { in: [PurchaseOrderStatus.SENT, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
            ...(scope && this.branchWhere(scope)),
          },
        },
        select: { id: true, productId: true, quantity: true, importedReceivedQuantity: true },
      }),
    ]);
    for (const s of stock) add(onHandBy, s.productId, Number(s._sum.quantity ?? 0));
    for (const t of inTransit) add(onHandBy, t.productId, Number(t._sum.quantity ?? 0));

    const received = ordered.length
      ? await this.prisma.goodsReceiptItem.groupBy({
          by: ['purchaseOrderItemId'],
          where: { purchaseOrderItemId: { in: ordered.map((o) => o.id) } },
          _sum: { quantity: true },
        })
      : [];
    const receivedBy = new Map(received.map((r) => [r.purchaseOrderItemId, Number(r._sum.quantity ?? 0)]));
    for (const item of ordered) {
      const open = Number(item.quantity) - Number(item.importedReceivedQuantity) - (receivedBy.get(item.id) ?? 0);
      if (open > 0 && item.productId) add(onOrderBy, item.productId, open);
    }
    return { onHandBy, onOrderBy };
  }

  // --------------------------------------------------------------- report

  // Every watched product with its position; `onlyLow` keeps just the ones
  // at or below their reorder point. branchId: that branch's stock and
  // points (null = business-wide).
  async report(organizationId: string, onlyLow = true, branchId: string | null = null): Promise<LowStockLine[]> {
    const scope = await this.scopeFor(organizationId, branchId);
    const products = await this.prisma.product.findMany({
      where: {
        organizationId,
        active: true,
        ...(scope
          ? { OR: [{ reorderPoint: { not: null } }, { reorderSettings: { some: { branchId: scope.branchId } } }] }
          : { reorderPoint: { not: null } }),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        costPrice: true,
        reorderPoint: true,
        reorderQuantity: true,
        preferredSupplier: { select: { id: true, name: true } },
        ...(scope && {
          reorderSettings: {
            where: { branchId: scope.branchId },
            select: { reorderPoint: true, reorderQuantity: true },
          },
        }),
      },
      orderBy: { name: 'asc' },
    });
    if (products.length === 0) return [];
    const { onHandBy, onOrderBy } = await this.positions(organizationId, products.map((p) => p.id), scope);

    const lines = products.map((p) => {
      const override = (p as { reorderSettings?: { reorderPoint: Prisma.Decimal; reorderQuantity: Prisma.Decimal | null }[] })
        .reorderSettings?.[0];
      const onHand = round2(onHandBy.get(p.id) ?? 0);
      const onOrder = round2(onOrderBy.get(p.id) ?? 0);
      const reorderPoint = Number(override ? override.reorderPoint : p.reorderPoint);
      const reorderQuantity = override ? num(override.reorderQuantity) : num(p.reorderQuantity);
      const position = onHand + onOrder;
      // The set reorder quantity, or else enough to get back to twice the
      // reorder point.
      const suggestedQuantity = reorderQuantity ?? Math.max(1, Math.ceil(reorderPoint * 2 - position));
      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        onHand,
        onOrder,
        reorderPoint,
        reorderQuantity,
        suggestedQuantity,
        unitCost: num(p.costPrice),
        preferredSupplier: p.preferredSupplier,
        branchOverride: !!override,
        defaultReorderPoint: num(p.reorderPoint),
        low: position <= reorderPoint,
      };
    });
    return (onlyLow ? lines.filter((l) => l.low) : lines).map(({ low: _low, ...rest }) => rest);
  }

  // ------------------------------------------------------------- settings

  async getSettings(organizationId: string, productId: string, branchId: string | null = null) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: {
        id: true,
        reorderPoint: true,
        reorderQuantity: true,
        preferredSupplierId: true,
        reorderSettings: branchId
          ? { where: { branchId }, select: { reorderPoint: true, reorderQuantity: true } }
          : { where: { id: '' }, select: { reorderPoint: true, reorderQuantity: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    const override = product.reorderSettings[0];
    return {
      productId: product.id,
      reorderPoint: num(product.reorderPoint),
      reorderQuantity: num(product.reorderQuantity),
      preferredSupplierId: product.preferredSupplierId,
      branchId,
      branchReorderPoint: override ? num(override.reorderPoint) : null,
      branchReorderQuantity: override ? num(override.reorderQuantity) : null,
    };
  }

  // branchId: write that branch's own point (a null point removes it, so the
  // branch falls back to the product's). Without: the product's business-wide
  // one (null = stop watching). The preferred supplier is always the product's.
  async updateSettings(
    organizationId: string,
    productId: string,
    dto: ReorderSettingsDto,
    branchId: string | null = null,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (dto.preferredSupplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.preferredSupplierId, organizationId },
      });
      if (!supplier) throw new NotFoundException('Supplier not found');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          ...(!branchId && dto.reorderPoint !== undefined && { reorderPoint: dto.reorderPoint }),
          ...(!branchId && dto.reorderQuantity !== undefined && { reorderQuantity: dto.reorderQuantity }),
          ...(dto.preferredSupplierId !== undefined && { preferredSupplierId: dto.preferredSupplierId }),
        },
      });
      if (branchId && dto.reorderPoint !== undefined) {
        await this.writeBranchSetting(tx, organizationId, productId, branchId, dto.reorderPoint, dto.reorderQuantity ?? null);
      }
      return this.getSettingsTx(tx, productId, branchId);
    });
  }

  private async getSettingsTx(tx: Prisma.TransactionClient, productId: string, branchId: string | null) {
    const p = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { id: true, reorderPoint: true, reorderQuantity: true, preferredSupplierId: true },
    });
    const o = branchId
      ? await tx.productReorderSetting.findUnique({ where: { productId_branchId: { productId, branchId } } })
      : null;
    return {
      productId: p.id,
      reorderPoint: num(p.reorderPoint),
      reorderQuantity: num(p.reorderQuantity),
      preferredSupplierId: p.preferredSupplierId,
      branchId,
      branchReorderPoint: o ? num(o.reorderPoint) : null,
      branchReorderQuantity: o ? num(o.reorderQuantity) : null,
    };
  }

  private async writeBranchSetting(
    tx: Prisma.TransactionClient,
    organizationId: string,
    productId: string,
    branchId: string,
    reorderPoint: number | null,
    reorderQuantity: number | null,
  ) {
    const where = { productId_branchId: { productId, branchId } };
    if (reorderPoint == null) {
      await tx.productReorderSetting.deleteMany({ where: { productId, branchId } });
      return;
    }
    await tx.productReorderSetting.upsert({
      where,
      create: { organizationId, productId, branchId, reorderPoint, reorderQuantity },
      update: { reorderPoint, reorderQuantity },
    });
  }

  // ------------------------------------------------------------ auto-fill

  // A reorder point from what actually sells: average daily sales over the
  // last `salesDays` (issued invoices) times `coverDays` of stock to keep —
  // roughly how long a new order takes to arrive. Only products that sold.
  // apply=false previews; apply=true writes.
  async autoFill(organizationId: string, dto: AutoFillReorderDto, branchId: string | null = null) {
    const salesDays = dto.salesDays;
    const coverDays = dto.coverDays;
    const since = new Date(Date.now() - salesDays * 86_400_000);
    const scope = await this.scopeFor(organizationId, branchId);

    const sold = await this.prisma.invoiceItem.groupBy({
      by: ['productId'],
      where: {
        productId: { not: null },
        invoice: {
          organizationId,
          status: InvoiceStatus.ISSUED,
          OR: [{ issuedAt: { gte: since } }, { issuedAt: null, invoiceDate: { gte: since } }],
          ...(scope && this.branchWhere(scope)),
        },
      },
      _sum: { quantity: true },
    });
    const soldBy = new Map(
      sold.filter((s) => s.productId && Number(s._sum.quantity ?? 0) > 0).map((s) => [s.productId!, Number(s._sum.quantity)]),
    );
    const products = await this.prisma.product.findMany({
      where: { organizationId, active: true, id: { in: [...soldBy.keys()] } },
      select: {
        id: true,
        name: true,
        sku: true,
        reorderPoint: true,
        ...(scope && { reorderSettings: { where: { branchId: scope.branchId }, select: { reorderPoint: true } } }),
      },
    });

    const lines = products
      .map((p) => {
        const override = (p as { reorderSettings?: { reorderPoint: Prisma.Decimal }[] }).reorderSettings?.[0];
        // What this scope already has of its own: the branch's point, or the product's.
        const current = scope ? (override ? Number(override.reorderPoint) : null) : num(p.reorderPoint);
        const qty = soldBy.get(p.id)!;
        const proposed = Math.max(1, Math.ceil((qty / salesDays) * coverDays));
        return { productId: p.id, name: p.name, sku: p.sku, sold: round2(qty), current, proposed };
      })
      .filter((l) => !(dto.onlyEmpty && l.current != null))
      .filter((l) => l.current !== l.proposed)
      .sort((a, b) => b.sold - a.sold);

    if (dto.apply) {
      const CHUNK = 200;
      for (let i = 0; i < lines.length; i += CHUNK) {
        const chunk = lines.slice(i, i + CHUNK);
        await this.prisma.$transaction(async (tx) => {
          for (const l of chunk) {
            if (scope) {
              const existing = await tx.productReorderSetting.findUnique({
                where: { productId_branchId: { productId: l.productId, branchId: scope.branchId } },
                select: { reorderQuantity: true },
              });
              await this.writeBranchSetting(
                tx, organizationId, l.productId, scope.branchId, l.proposed, num(existing?.reorderQuantity),
              );
            } else {
              await tx.product.update({ where: { id: l.productId }, data: { reorderPoint: l.proposed } });
            }
          }
        });
      }
    }
    return { salesDays, coverDays, count: lines.length, applied: !!dto.apply, lines: lines.slice(0, 50) };
  }

  // ------------------------------------------------------ Excel round trip

  // Every active product with its reorder settings and stock, for the
  // spreadsheet that's edited and imported back.
  async exportRows(organizationId: string, branchId: string | null = null) {
    const scope = await this.scopeFor(organizationId, branchId);
    const products = await this.prisma.product.findMany({
      where: { organizationId, active: true },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        reorderPoint: true,
        reorderQuantity: true,
        preferredSupplier: { select: { name: true } },
        ...(scope && {
          reorderSettings: {
            where: { branchId: scope.branchId },
            select: { reorderPoint: true, reorderQuantity: true },
          },
        }),
      },
      orderBy: { name: 'asc' },
    });
    const { onHandBy } = await this.positions(organizationId, products.map((p) => p.id), scope);
    return products.map((p) => {
      const override = (p as { reorderSettings?: { reorderPoint: Prisma.Decimal; reorderQuantity: Prisma.Decimal | null }[] })
        .reorderSettings?.[0];
      return {
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        onHand: round2(onHandBy.get(p.id) ?? 0),
        // For a branch, its own figures only; blank = it uses the product's.
        reorderPoint: scope ? (override ? Number(override.reorderPoint) : null) : num(p.reorderPoint),
        reorderQuantity: scope ? (override ? num(override.reorderQuantity) : null) : num(p.reorderQuantity),
        defaultReorderPoint: num(p.reorderPoint),
        supplier: p.preferredSupplier?.name ?? null,
      };
    });
  }

  // Rows from that spreadsheet, matched by SKU (else an exact, unique name).
  // A blank reorder point clears it: business-wide that stops watching the
  // product, for a branch it falls back to the product's. A blank supplier
  // clears the preferred supplier. Only rows that change anything are written.
  async importRows(organizationId: string, dto: ImportReorderDto, branchId: string | null = null) {
    const scope = await this.scopeFor(organizationId, branchId);
    const [products, suppliers] = await Promise.all([
      this.prisma.product.findMany({
        where: { organizationId },
        select: {
          id: true,
          sku: true,
          name: true,
          reorderPoint: true,
          reorderQuantity: true,
          preferredSupplierId: true,
          ...(scope && {
            reorderSettings: { where: { branchId: scope.branchId }, select: { reorderPoint: true, reorderQuantity: true } },
          }),
        },
      }),
      this.prisma.supplier.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ]);
    const key = (s: string) => s.trim().toLowerCase();
    const bySku = new Map(products.filter((p) => p.sku).map((p) => [key(p.sku!), p]));
    const byName = new Map<string, (typeof products)[number] | null>();
    for (const p of products) byName.set(key(p.name), byName.has(key(p.name)) ? null : p);
    const supplierBy = new Map(suppliers.map((s) => [key(s.name), s.id]));

    // code: PRODUCT_NOT_FOUND | SUPPLIER_NOT_FOUND | INVALID_NUMBER — the page words them.
    const errors: { row: number; code: string; value: string }[] = [];
    const writes: { productId: string; point: number | null; qty: number | null; supplierId: string | null }[] = [];
    let unchanged = 0;
    dto.rows.forEach((r, i) => {
      const row = i + 2; // row 1 is the header
      const product = (r.sku && bySku.get(key(r.sku))) || (r.name ? byName.get(key(r.name)) : undefined);
      if (!product) {
        errors.push({ row, code: 'PRODUCT_NOT_FOUND', value: r.sku || r.name || '' });
        return;
      }
      const point = r.reorderPoint ?? null;
      const qty = r.reorderQuantity ?? null;
      if ((point != null && point < 0) || (qty != null && qty <= 0)) {
        errors.push({ row, code: 'INVALID_NUMBER', value: '' });
        return;
      }
      let supplierId: string | null = null;
      if (r.supplier && r.supplier.trim()) {
        supplierId = supplierBy.get(key(r.supplier)) ?? null;
        if (!supplierId) {
          errors.push({ row, code: 'SUPPLIER_NOT_FOUND', value: r.supplier });
          return;
        }
      }
      const override = (product as { reorderSettings?: { reorderPoint: Prisma.Decimal; reorderQuantity: Prisma.Decimal | null }[] })
        .reorderSettings?.[0];
      const curPoint = scope ? (override ? Number(override.reorderPoint) : null) : num(product.reorderPoint);
      const curQty = scope ? (override ? num(override.reorderQuantity) : null) : num(product.reorderQuantity);
      if (curPoint === point && (point == null || curQty === qty) && product.preferredSupplierId === supplierId) {
        unchanged++;
        return;
      }
      writes.push({ productId: product.id, point, qty: point == null ? null : qty, supplierId });
    });

    if (errors.length === 0) {
      const CHUNK = 200;
      for (let i = 0; i < writes.length; i += CHUNK) {
        await this.prisma.$transaction(async (tx) => {
          for (const w of writes.slice(i, i + CHUNK)) {
            await tx.product.update({
              where: { id: w.productId },
              data: {
                preferredSupplierId: w.supplierId,
                ...(!scope && { reorderPoint: w.point, reorderQuantity: w.qty }),
              },
            });
            if (scope) await this.writeBranchSetting(tx, organizationId, w.productId, scope.branchId, w.point, w.qty);
          }
        });
      }
    }
    // All or nothing: a file with mistakes changes nothing, so it can be fixed and sent again.
    return { updated: errors.length ? 0 : writes.length, unchanged, errors: errors.slice(0, 100), errorCount: errors.length };
  }

  // ----------------------------------------------------------- draft POs

  // One draft PO per supplier, priced at each product's current cost.
  // They're drafts on purpose: someone checks quantities and prices and
  // sends them (where approvals apply as usual). branchId: the branch they're
  // booked to; the delivery location must be one of its own.
  async createDraftPurchaseOrders(
    organizationId: string,
    userId: string,
    dto: CreateReorderPosDto,
    branchId: string | null = null,
  ) {
    let locationId = dto.locationId;
    const scope = await this.scopeFor(organizationId, branchId);
    if (scope) {
      if (locationId && !scope.locationIds.includes(locationId)) {
        throw new BadRequestException("The delivery location isn't in this branch");
      }
      if (!locationId) {
        const locations = await this.prisma.location.findMany({
          where: { id: { in: scope.locationIds }, archivedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        locationId = (locations.find((l) => l.name.trim().toUpperCase() === 'CENTRE') ?? locations[0])?.id;
      }
    }

    const bySupplier = new Map<string, { productId: string; quantity: number }[]>();
    for (const line of dto.items) {
      bySupplier.set(line.supplierId, [...(bySupplier.get(line.supplierId) ?? []), line]);
    }
    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: dto.items.map((i) => i.productId) } },
      select: { id: true, costPrice: true },
    });
    const costBy = new Map(products.map((p) => [p.id, p.costPrice != null ? Number(p.costPrice) : 0]));
    if (costBy.size !== new Set(dto.items.map((i) => i.productId)).size) {
      throw new BadRequestException('One or more products were not found');
    }

    const created: Awaited<ReturnType<PurchaseOrderService['create']>>[] = [];
    for (const [supplierId, lines] of bySupplier) {
      created.push(
        await this.purchaseOrders.create(organizationId, userId, {
          supplierId,
          locationId,
          ...(branchId && { branchId }),
          notes: 'Created from reorder suggestions',
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCost: costBy.get(l.productId) ?? 0,
          })),
        }),
      );
    }
    return created;
  }

  // ------------------------------------------------------- notifications

  // Morning nudge when anything is low. Once a day at most, and only for orgs
  // that watch at least one product. With several branches, a branch ADMIN
  // hears about their own branch and MASTER about the business as a whole.
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CRON_TIMEZONE })
  async notifyLowStock() {
    const [byProduct, byOverride] = await Promise.all([
      this.prisma.product.groupBy({ by: ['organizationId'], where: { active: true, reorderPoint: { not: null } } }),
      this.prisma.productReorderSetting.groupBy({ by: ['organizationId'] }),
    ]);
    const orgIds = new Set([...byProduct, ...byOverride].map((o) => o.organizationId));
    for (const organizationId of orgIds) {
      try {
        await this.notifyOrg(organizationId);
      } catch (err) {
        this.logger.warn(`Low-stock check failed for org ${organizationId}: ${err}`);
      }
    }
  }

  private async notifyOrg(organizationId: string) {
    const admins = await this.prisma.user.findMany({
      where: { organizationId, role: { in: [...ADMIN_ROLES] }, active: true, removedAt: null },
      select: { id: true, role: true, branchId: true },
    });
    const branches = await this.prisma.branch.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const multi = branches.length > 1;
    const groups = new Map<string | null, string[]>();
    for (const a of admins) {
      const branch =
        multi && a.role !== 'MASTER'
          ? branches.some((b) => b.id === a.branchId) ? a.branchId! : branches[0].id
          : null;
      groups.set(branch, [...(groups.get(branch) ?? []), a.id]);
    }
    for (const [branchId, userIds] of groups) {
      const low = await this.report(organizationId, true, branchId);
      if (low.length === 0) continue;
      await this.notifications.createMany(
        organizationId,
        userIds,
        'LOW_STOCK',
        `${low.length} product${low.length > 1 ? 's are' : ' is'} low on stock`,
        { body: low.slice(0, 5).map((l) => l.name).join(', '), link: '/purchasing/reorder' },
      );
    }
  }
}
