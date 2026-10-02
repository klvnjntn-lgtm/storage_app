import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DiscountType, ModuleKey } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { OrganizationModulesService } from 'src/organization-module/organization-modules.service';
import { ensureDefaultPriceLevel } from 'src/price-level/default-price-level';

export type PriceableLine = {
  productId?: string;
  description?: string;
  locationId?: string;
  quantity: number;
  unitPrice?: number;
  taxRateIds?: string[];
  unit?: string;
  // NEW — per-item discount, replaces the old document-level discount.
  discountType?: DiscountType;
  discountValue?: number;
  // Price level the client picked for this line. Only a *request*: the
  // server looks the price up itself (see resolveProductPrice below).
  priceLevelId?: string;
};

export type PricedLine = {
  productId: string | null;
  description: string | null;
  locationId: string | null;
  quantity: number;
  unitPrice: number;
  unitCost: number | null;
  unit: string | null;
  // Where unitPrice came from; null = custom (POS pricing) or service line.
  priceLevelId: string | null;
  // True when the requested level had no price for this product and the
  // default level's price was used instead (priceLevelId is then the
  // default level's id, i.e. the true source of the price).
  priceLevelFallback: boolean;
  lineTotal: number; // gross: quantity × unitPrice
  // NEW
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  netAmount: number; // lineTotal - discountAmount
  taxAmount: number; // computed on netAmount, not lineTotal
  total: number; // netAmount + taxAmount
  taxes: { taxRateId: string; name: string; percentage: number; amount: number }[];
};

@Injectable()
export class LineItemPricingService {
  constructor(
    private prisma: PrismaService,
    private orgModulesService: OrganizationModulesService,
  ) {}

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  // REMOVED: computeDiscount() and applyDiscountToTax(). Both were
  // document-level discount math that operated on the pre-discount
  // aggregate subtotal/taxAmount. Per-item discount (below, inside
  // priceLines) replaces them entirely. Keeping both around risked the
  // exact double-application bug flagged in review — a caller could
  // price lines with per-item discount AND still call computeDiscount()
  // on the resulting subtotal. Deleting the methods makes that a
  // compile error instead of a silent bug.

  // Per-line discount. Same FIXED/PERCENTAGE semantics as the old
  // document-level computeDiscount, just scoped to one line's gross
  // amount. FIXED is capped at the line's grossAmount so a mistyped
  // discount can't push a single line negative. PERCENTAGE is bounded
  // to 0–100 here (unlike the old document-level version) since this
  // runs once per line anyway and a clear per-line error is more useful
  // than a generic one.
  private computeLineDiscount(
    grossAmount: number,
    discountType?: DiscountType | null,
    discountValue?: number | null,
  ): number {
    if (!discountType || discountValue == null) return 0;
    if (discountValue < 0) {
      throw new BadRequestException('Discount value cannot be negative');
    }
    if (discountType === DiscountType.PERCENTAGE) {
      if (discountValue > 100) {
        throw new BadRequestException('Percentage discount cannot exceed 100');
      }
      return this.round2(grossAmount * (discountValue / 100));
    }
    return this.round2(Math.min(discountValue, grossAmount));
  }

  async priceLines(
    organizationId: string,
    items: PriceableLine[],
    client: Pick<
      PrismaService,
      'product' | 'organizationTaxRate' | 'organization' | 'location' | 'priceLevel' | 'productPrice' | 'customer' | 'user'
    > = this.prisma,
    options: {
      serviceLineModuleKey?: ModuleKey | null;
      // NEW — when false, a product line is allowed to have no
      // locationId. Defaults to true (the original, unconditional
      // behavior), so every existing caller is unaffected unless it
      // explicitly opts out. InvoiceService.editIssuedInvoice() passes
      // false for WAREHOUSE_OPS orgs — physical location for those is
      // decided later at pick/fulfillment time (see issue()'s own
      // hasWarehouseOps carve-out for the identical rule), not fixed on
      // the invoice line itself.
      requireLocationForProducts?: boolean;
      // NEW — index (into `items`) -> unit price that must be used
      // as-is, bypassing both posPricingEnabled and product.sellingPrice.
      // InvoiceService.editIssuedInvoice() uses this to keep an
      // already-issued line's price exactly what it was at issue time;
      // without it, editing any line silently re-priced every product
      // line on the invoice to today's selling price.
      forcedUnitPriceByIndex?: Map<number, number>;
      // Price level to record alongside a forced unit price — conversions
      // and issued-invoice edits carry the source line's level forward.
      forcedPriceLevelIdByIndex?: Map<number, string | null>;
      // Document's customer: their price level is the default for lines
      // that don't name one.
      customerId?: string | null;
      // Acting user — checked against the org's
      // priceLevelOverrideRequiresAdmin setting when a line picks a level
      // other than the customer's.
      userId?: string;
    } = {},
  ): Promise<{
    items: PricedLine[];
    subtotal: number; // gross: sum(lineTotal)
    discountAmount: number; // NEW — sum(item discountAmount) = "Item Discount Total"
    taxableAmount: number; // NEW — subtotal - discountAmount
    taxAmount: number; // sum of item taxAmount, now computed on netAmount
    taxLines: { taxRateId: string; name: string; percentage: number; amount: number }[];
  }> {
    const serviceLineModuleKey =
      options.serviceLineModuleKey === undefined ? ModuleKey.WORKSHOP_RMS : options.serviceLineModuleKey;
    const requireLocationForProducts =
      options.requireLocationForProducts === undefined ? true : options.requireLocationForProducts;

    const productItems = items.filter((i) => !!i.productId);
    const serviceItems = items.filter((i) => !i.productId);

    if (serviceItems.length > 0) {
      if (!serviceLineModuleKey) {
        throw new BadRequestException('Service line items are not supported on this document type');
      }
      const hasServiceModule = await this.orgModulesService.isModuleEnabled(
        organizationId,
        serviceLineModuleKey,
      );
      if (!hasServiceModule) {
        throw new BadRequestException(`Service line items require the ${serviceLineModuleKey} module`);
      }
      for (const s of serviceItems) {
        if (!s.description?.trim()) {
          throw new BadRequestException('Service description is required');
        }
        if (s.unitPrice == null) {
          throw new BadRequestException('Service price is required (use 0 if free)');
        }
        if (s.unitPrice < 0) {
          throw new BadRequestException('Service price cannot be negative');
        }
      }
    }

    const productIds = productItems.map((i) => i.productId!);
    const products = await client.product.findMany({
      where: { id: { in: productIds }, organizationId },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Line-level locationId isn't covered by TenantOwnershipService (that
    // only checks header refs), and InvoiceItem/SalesOrderItem/
    // SalesQuotationItem have a single-column FK to Location — so without
    // this, another org's location id would attach without complaint.
    const lineLocationIds = Array.from(
      new Set(productItems.map((i) => i.locationId).filter((id): id is string => !!id)),
    );
    if (lineLocationIds.length > 0) {
      const found = await client.location.count({
        where: { id: { in: lineLocationIds }, organizationId },
      });
      if (found !== lineLocationIds.length) {
        throw new BadRequestException('One or more line item locations were not found');
      }
    }

    const org = await client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { posPricingEnabled: true, priceLevelOverrideRequiresAdmin: true },
    });

    // ── Price levels ────────────────────────────────────────────────────
    // Created outside any caller transaction: a lazily-made default level
    // is harmless to keep even if the document save later rolls back.
    const defaultLevel = productItems.length > 0 ? await ensureDefaultPriceLevel(this.prisma, organizationId) : null;
    const customer = options.customerId
      ? await client.customer.findFirst({
          where: { id: options.customerId, organizationId },
          select: { priceLevel: { select: { id: true, archivedAt: true } } },
        })
      : null;
    const customerLevelId =
      customer?.priceLevel && !customer.priceLevel.archivedAt ? customer.priceLevel.id : null;
    const baseLevelId = customerLevelId ?? defaultLevel?.id ?? null;

    // Lines carrying a forced (historical) price keep their saved level
    // as-is — it may since be archived, or differ from the customer's
    // current level — so they're neither validated nor permission-checked.
    const requestedLevelIds = Array.from(
      new Set(
        items
          .filter((i, idx) => !!i.productId && options.forcedUnitPriceByIndex?.get(idx) == null)
          .map((i) => i.priceLevelId)
          .filter((id): id is string => !!id),
      ),
    );
    const levels = requestedLevelIds.length
      ? await client.priceLevel.findMany({
          where: { id: { in: requestedLevelIds }, organizationId, archivedAt: null },
          select: { id: true },
        })
      : [];
    if (levels.length !== requestedLevelIds.length) {
      throw new BadRequestException('One or more price levels were not found');
    }

    // Looked up once, only when the org restricts price overrides to admins.
    const actorIsAdmin = org.priceLevelOverrideRequiresAdmin
      ? (options.userId
          ? await client.user.findFirst({ where: { id: options.userId, organizationId }, select: { role: true } })
          : null
        )?.role === 'ADMIN'
      : true;

    // A line picking a level other than the customer's is an override.
    if (!actorIsAdmin && requestedLevelIds.some((id) => id !== baseLevelId)) {
      throw new ForbiddenException("Only an admin can change a line's price level");
    }

    const nonDefaultLevelIds = Array.from(
      new Set([...requestedLevelIds, ...(baseLevelId ? [baseLevelId] : [])].filter((id) => id !== defaultLevel?.id)),
    );
    const levelPrices = nonDefaultLevelIds.length
      ? await client.productPrice.findMany({
          where: { productId: { in: productIds }, priceLevelId: { in: nonDefaultLevelIds } },
        })
      : [];
    const levelPrice = new Map(levelPrices.map((lp) => [`${lp.productId}:${lp.priceLevelId}`, Number(lp.price)]));

    // Product + level → stored price. Never trusts a client-sent price.
    const resolveProductPrice = (
      product: (typeof products)[number],
      levelId: string,
    ): { unitPrice: number; priceLevelId: string; fallback: boolean } => {
      if (levelId !== defaultLevel!.id) {
        const p = levelPrice.get(`${product.id}:${levelId}`);
        if (p != null) return { unitPrice: p, priceLevelId: levelId, fallback: false };
      }
      if (product.sellingPrice == null) {
        throw new BadRequestException(`${product.name} has no selling price set`);
      }
      return { unitPrice: Number(product.sellingPrice), priceLevelId: defaultLevel!.id, fallback: levelId !== defaultLevel!.id };
    };

    const allTaxRateIds = Array.from(new Set(items.flatMap((i) => i.taxRateIds ?? [])));
    const rates = allTaxRateIds.length
      ? await client.organizationTaxRate.findMany({
                    where: { id: { in: allTaxRateIds }, organizationId, archivedAt: null },

        })
      : [];
    const ratesById = new Map(rates.map((r) => [r.id, r]));
    if (ratesById.size !== allTaxRateIds.length) {
      throw new BadRequestException('One or more tax rates were not found');
    }

    let subtotal = 0;
    let discountAmount = 0;
    let taxAmount = 0;
    const aggregateTaxes = new Map <
      string,
      { taxRateId: string; name: string; percentage: number; amount: number }
    >();

    const lines: PricedLine[] = items.map((item, index) => {
      const itemTaxRateIds = Array.from(new Set(item.taxRateIds ?? []));

      let unitPrice: number;
      let priceLevelId: string | null = null;
      let priceLevelFallback = false;
      let unitCost: number | null = null;
      let productId: string | null = null;
      let description: string | null = null;
      let locationId: string | null = item.locationId ?? null;
      let unit: string | null = item.unit?.trim() || null;
      let productName: string | undefined;

      if (item.productId) {
        const product = byId.get(item.productId);
        if (!product) {
          throw new NotFoundException(`Product ${item.productId} not found`);
        }
        if (!locationId && requireLocationForProducts) {
          throw new BadRequestException(`${product.name} needs a location`);
        }
        if (!unit) {
          unit = product.unit ?? null;
        }
        const forcedUnitPrice = options.forcedUnitPriceByIndex?.get(index);
        if (forcedUnitPrice != null) {
          // Historical price carried over as-is (conversion / issued edit).
          unitPrice = forcedUnitPrice;
          priceLevelId = options.forcedPriceLevelIdByIndex?.get(index) ?? null;
        } else if (org.posPricingEnabled && item.unitPrice != null) {
          // POS pricing: a typed price is allowed. It counts as coming from
          // a level only when it equals that level's price; otherwise it's
          // custom. A product with no stored price at all can still be
          // sold at a typed price, as before price levels.
          if (item.unitPrice < 0) {
            throw new BadRequestException(`${product.name}: price cannot be negative`);
          }
          let resolved: ReturnType<typeof resolveProductPrice> | null = null;
          try {
            resolved = resolveProductPrice(product, item.priceLevelId ?? baseLevelId!);
          } catch {
            resolved = null; // no selling price set — the typed price stands
          }
          unitPrice = item.unitPrice;
          if (resolved && resolved.unitPrice === item.unitPrice) {
            priceLevelId = resolved.priceLevelId;
            priceLevelFallback = resolved.fallback;
          } else if (!actorIsAdmin && resolved) {
            // A typed price that matches no level is a bigger override than
            // picking another level, so the same admin-only rule applies —
            // otherwise typing a price sidestepped the setting entirely. A
            // product with no stored price at all can still be priced by hand.
            throw new ForbiddenException(`Only an admin can set a custom price for ${product.name}`);
          }
        } else {
          const resolved = resolveProductPrice(product, item.priceLevelId ?? baseLevelId!);
          unitPrice = resolved.unitPrice;
          priceLevelId = resolved.priceLevelId;
          priceLevelFallback = resolved.fallback;
        }
        unitCost = product.costPrice ? Number(product.costPrice) : null;
        productId = product.id;
        productName = product.name;
      } else {
        unitPrice = item.unitPrice!;
        description = item.description!.trim();
        locationId = null;
      }

      const lineTotal = this.round2(unitPrice * item.quantity); // gross
      subtotal = this.round2(subtotal + lineTotal);

      // NEW — per-item discount, computed off this line's gross amount.
      let lineDiscountAmount: number;
      try {
        lineDiscountAmount = this.computeLineDiscount(lineTotal, item.discountType, item.discountValue);
      } catch (e) {
        // Re-throw with the product/line name for a useful error message,
        // since computeLineDiscount doesn't know which line it's on.
        if (e instanceof BadRequestException) {
          throw new BadRequestException(`${productName ?? description ?? 'Line item'}: ${e.message}`);
        }
        throw e;
      }
      discountAmount = this.round2(discountAmount + lineDiscountAmount);
      const netAmount = this.round2(lineTotal - lineDiscountAmount);

      // Tax is now computed on netAmount (post-discount), not the gross
      // lineTotal — this is the "Taxable Amount" from the spec, applied
      // per line so per-line tax rates still work correctly.
      let itemTaxAmount = 0;
      const itemTaxLines = itemTaxRateIds.map((id) => {
        const rate = ratesById.get(id)!;
        const percentage = Number(rate.percentage);
        const amount = this.round2(netAmount * (percentage / 100));
        itemTaxAmount += amount;

        const existing = aggregateTaxes.get(rate.id);
        aggregateTaxes.set(
          rate.id,
          existing
            ? { ...existing, amount: this.round2(existing.amount + amount) }
            : { taxRateId: rate.id, name: rate.name, percentage, amount },
        );

        return { taxRateId: rate.id, name: rate.name, percentage, amount };
      });
      itemTaxAmount = this.round2(itemTaxAmount);
      taxAmount += itemTaxAmount;

      return {
        productId,
        description,
        locationId,
        quantity: item.quantity,
        unitPrice,
        unitCost,
        unit,
        priceLevelId,
        priceLevelFallback,
        lineTotal,
        discountType: item.discountType ?? null,
        discountValue: item.discountValue ?? null,
        discountAmount: lineDiscountAmount,
        netAmount,
        taxAmount: itemTaxAmount,
        total: this.round2(netAmount + itemTaxAmount),
        taxes: itemTaxLines,
      };
    });

    return {
      items: lines,
      subtotal,
      discountAmount: this.round2(discountAmount),
      taxableAmount: this.round2(subtotal - discountAmount),
      taxAmount: this.round2(taxAmount),
      taxLines: Array.from(aggregateTaxes.values()),
    };
  }
}