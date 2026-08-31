// components/sales-orders/types.ts

// Re-exported rather than redefined — same shapes as invoices/quotations.
export type {
  CartLine,
  Customer,
  DiscountType,
  LocationOption,
  ProductSearchResult,
  ServiceLine,
  TaxRate,
} from '@/app/components/invoices/types';

export type SalesOrderItemView = {
  productName: string;
  sku: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  itemDiscount: number;
  itemTotal: number;
  lineTotal: number;
  itemTaxAmount: number;
};

export type SalesOrderTaxView = {
  name: string;
  percentage: number;
  amount: number;
};

// Mirrors SalesOrderPrintView from the backend. No validUntil (that's a
// quotation-only concept) and no bank fields — SalesOrderPrintView doesn't
// carry them, since an order is a committed transaction rather than a
// proposal to accept or negotiate on. Discount IS carried, unlike before —
// the backend now writes SalesOrder.discount and per-item discountAmount.
export type SalesOrderView = {
  orderNumber: string | null;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
  orderDate: string | null;
  customerPoNumber: string | null;

  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerNpwp: string | null;

  locationName: string;
  locationAddress: string | null;
  locationPhone: string | null;

  items: SalesOrderItemView[];
  subtotal: number;
  discount: number;
  taxAmount: number;
  taxes: SalesOrderTaxView[];
  total: number;

  businessName: string;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
};