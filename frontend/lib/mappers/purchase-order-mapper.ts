// lib/mappers/purchase-order-mapper.ts
//
// FIX — the purchase-order print page used to pass the raw fetch
// response straight to PurchaseOrderTemplate via a bare type assertion,
// trusting PurchaseOrderPrintView's types (all money/quantity fields
// typed as `number`) at face value. Every sibling print page
// (invoices, sales-orders, quotations) was already corrected to route
// through a mapper instead — this brings purchase-orders in line, and
// for real reason, not just consistency: backend/src/purchase-order/
// purchase-order.service.ts's mapForPrint() wraps every OTHER Decimal
// field in Number(...) before responding except item.quantity, which is
// a Prisma Decimal(12,2) and therefore actually arrives over JSON as a
// STRING despite the type claiming `number`. Coercing here closes that
// gap defensively, the same way sales-order-mapper.ts/invoice-mapper.ts
// coerce their own item fields even though their raw types also claim
// `number`.
import { PurchaseOrderPrintView } from '@/app/components/purchase-orders/types';

export type RawPurchaseOrderPrintView = Omit<PurchaseOrderPrintView, 'subtotal' | 'discountAmount' | 'taxAmount' | 'total' | 'taxPercentage' | 'items'> & {
  subtotal: number | string;
  discountAmount: number | string;
  taxAmount: number | string;
  total: number | string;
  taxPercentage: number | string | null;
  items: {
    id: string;
    productName: string;
    sku: string | null;
    quantity: number | string;
    unitCost: number | string;
    lineTotal: number | string;
  }[];
};

export function toPurchaseOrderView(raw: RawPurchaseOrderPrintView): PurchaseOrderPrintView {
  return {
    ...raw,
    subtotal: Number(raw.subtotal),
    discountAmount: Number(raw.discountAmount),
    taxAmount: Number(raw.taxAmount),
    total: Number(raw.total),
    taxPercentage: raw.taxPercentage != null ? Number(raw.taxPercentage) : null,
    items: raw.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      sku: item.sku,
      quantity: Number(item.quantity),
      unitCost: Number(item.unitCost),
      lineTotal: Number(item.lineTotal),
    })),
  };
}
