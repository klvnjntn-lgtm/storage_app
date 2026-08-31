// lib/sales-order-mapper.ts
import { SalesOrderView } from '@/app/components/sales-orders/types';

// Mirrors toInvoiceView/toQuotationView — SalesOrderPrintView is the type
// already defined in sales-order.service.ts (backend), reproduced here as
// the fetch's expected shape.
export type SalesOrderPrintView = {
  id: string;
  orderNumber: string | null;
  status: string;
  format: string;

  businessName: string;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  orderDate: string | null;          // NEW
  customerPoNumber: string | null;   // NEW

  locationName: string;
  locationAddress: string | null;
  locationPhone: string | null;

  customerName: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  customerNpwp: string | null;

  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;

  confirmedAt: string | null;
  createdAt: string;

  taxes: { name: string; percentage: number; amount: number }[];
  items: {
    id: string;
    productName: string;
    sku: string | null;
    quantity: number;
    unit: string | null;
    itemTaxAmount: number;   
    itemDiscount: number;
    itemTotal: number;
    unitPrice: number;
    lineTotal: number;
  }[];
};

export function toSalesOrderView(order: SalesOrderPrintView): SalesOrderView {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt,

    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerAddress: order.customerAddress,
    customerNpwp: order.customerNpwp,
    orderDate: order.orderDate,                 // NEW
    customerPoNumber: order.customerPoNumber,   // NEW

    locationName: order.locationName,
    locationAddress: order.locationAddress,
    locationPhone: order.locationPhone,

    items: order.items.map((item) => ({
      productName: item.productName ?? '',
      sku: item.sku,
      quantity: item.quantity,
      unit: item.unit,
        itemTaxAmount: Number(item.itemTaxAmount ?? 0),   // NEW

      unitPrice: Number(item.unitPrice),
      itemDiscount: Number(item.itemDiscount ?? 0),
      itemTotal: Number(item.itemTotal ?? item.lineTotal),
      lineTotal: Number(item.lineTotal),
    })),
    subtotal: Number(order.subtotal),
    discount: Number(order.discount ?? 0),
    taxAmount: Number(order.taxAmount ?? 0),
    taxes: (order.taxes ?? []).map((t) => ({
      name: t.name,
      percentage: Number(t.percentage),
      amount: Number(t.amount),
    })),
    total: Number(order.total),

    businessName: order.businessLegalName ?? order.businessName,
    businessLegalName: order.businessLegalName,
    businessNpwp: order.businessNpwp,
    businessLogoUrl: order.businessLogoUrl,
    businessAddress: order.businessAddress ?? order.locationAddress ?? null,
    businessPhone: order.businessPhone ?? order.locationPhone ?? null,
  };
}