import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DiscountType, ModuleKey } from '@prisma/client';
import { OrganizationModulesService } from 'src/organization-module/organization-modules.service';

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
};

export type PricedLine = {
  productId: string | null;
  description: string | null;
  locationId: string | null;
  quantity: number;
  unitPrice: number;
  unitCost: number | null;
  unit: string | null;
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
    client: Pick<PrismaService, 'product' | 'organizationTaxRate' | 'organization'> = this.prisma,
    options: { serviceLineModuleKey?: ModuleKey | null } = {},
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

    const org = await client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { posPricingEnabled: true },
    });

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

    const lines: PricedLine[] = items.map((item) => {
      const itemTaxRateIds = Array.from(new Set(item.taxRateIds ?? []));

      let unitPrice: number;
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
        if (!locationId) {
          throw new BadRequestException(`${product.name} needs a location`);
        }
        if (!unit) {
          unit = product.unit ?? null;
        }
        if (org.posPricingEnabled && item.unitPrice != null) {
          unitPrice = item.unitPrice;
        } else {
          if (product.sellingPrice == null) {
            throw new BadRequestException(`${product.name} has no selling price set`);
          }
          unitPrice = Number(product.sellingPrice);
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