// The sales editors' (quotation, sales order, invoice) cart and services, as LineItemsTable rows, and the
// item search behind the table's empty row.

import type { ReactNode } from 'react';
import { apiFetch } from '@/lib/apifetch';
import PriceLevelSelect from '@/app/components/shared/PriceLevelSelect';
import type { CartLine, ProductSearchResult, ServiceLine } from '@/app/components/invoices/types';
import type { SearchOption, TableLine } from './LineItemsTable';

type Priced = { lineSubtotal: number; lineDiscountAmount: number; netAmount: number };

export async function searchSalesProducts(q: string): Promise<ProductSearchResult[]> {
  const res = await apiFetch(`/products/search-for-invoice?${new URLSearchParams({ q })}`);
  return res.ok ? res.json() : [];
}

// blockNoStock: the document can't go past stock (Inventory Ops, or Stock Enforcement = Block), so a
// product with none is greyed out and can't be picked.
export function describeSalesProduct(
  p: ProductSearchResult,
  stockLabel?: (qty: number) => string,
  blockNoStock = false,
): SearchOption {
  const stock = p.stockByLocation.reduce((sum, s) => sum + s.quantity, 0);
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    meta: stockLabel ? stockLabel(stock) : null,
    disabled: blockNoStock && stock <= 0,
  };
}

export function salesTableLines({
  cartLines,
  services,
  posPricingEnabled,
  showLocation,
  noPriceLabel,
  onChangePriceLevel,
  lineExtra,
}: {
  cartLines: (CartLine & Priced & { key: string })[];
  services: (ServiceLine & Priced)[];
  posPricingEnabled: boolean;
  // Warehouse orgs see which location each line comes from.
  showLocation: boolean;
  noPriceLabel: string;
  onChangePriceLevel?: (key: string, levelId: string) => void;
  // More controls under a product line's name (e.g. the invoice's serial-number button).
  lineExtra?: (line: CartLine & { key: string }) => ReactNode;
}): TableLine[] {
  return [
    ...cartLines.map(
      (line): TableLine => ({
        key: line.key,
        kind: 'product',
        name: line.product.name,
        sub: [line.product.sku, showLocation ? line.locationName : null].filter(Boolean).join(' · ') || null,
        quantity: Number(line.quantity),
        unit: line.unit,
        unitPrice: line.unitPrice,
        discountType: line.discountType,
        discountValue: line.discountValue,
        discountAmount: line.lineDiscountAmount,
        total: line.netAmount,
        priceLocked: !posPricingEnabled,
        warning: !posPricingEnabled && line.product.sellingPrice == null ? noPriceLabel : null,
        extra: (onChangePriceLevel || lineExtra) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {lineExtra?.(line)}
            {onChangePriceLevel && (
              <PriceLevelSelect
                product={line.product}
                value={line.priceLevelId ?? null}
                custom={!!line.priceCustom}
                onChange={(levelId) => onChangePriceLevel(line.key, levelId)}
              />
            )}
          </div>
        ),
      }),
    ),
    ...services.map(
      (s): TableLine => ({
        key: s.key,
        kind: 'service',
        name: s.description,
        quantity: 1,
        quantityFixed: true,
        unit: s.unit,
        unitPrice: s.unitPrice,
        discountType: s.discountType,
        discountValue: s.discountValue,
        discountAmount: s.lineDiscountAmount,
        total: s.netAmount,
      }),
    ),
  ];
}
