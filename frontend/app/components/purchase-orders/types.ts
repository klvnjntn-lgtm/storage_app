// app/components/purchase-orders/types.ts

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'SENT'
  | 'CANCELLED'
  | 'PARTIALLY_RECEIVED'
  | 'FULLY_RECEIVED';

export type PurchaseOrderListItem = {
  id: string;
  poNumber: string | null;
  status: PurchaseOrderStatus;
  supplier: { name: string } | null;
  location: { name: string } | null;
  subtotal: string | number;
  discountAmount: string | number;
  taxAmount: string | number;
  total: string | number;
  createdAt: string;
  items: { id: string }[];
};

export type POProduct = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
};

// Keyed by productId — a PO has a single receiving location for the
// whole order, unlike the sales cart which keys by product+location.
export type POCartLine = {
  product: POProduct;
  quantity: number;
  unitCost: number;
};

// A line with no productId. PurchaseOrderLineDto has no description
// field, so this can only ever be "Custom item" with a qty and cost —
// nothing more expressive is possible without a backend/DTO change.
export type POCustomItem = {
  key: string;
  quantity: number;
  unitCost: number;
};

export type LocationOption = { id: string; name: string };

export type TaxRate = { id: string; name: string; percentage: number; isDefault?: boolean };

export type PurchaseOrderDetail = {
  id: string;
  poNumber: string | null;
  status: PurchaseOrderStatus;
  supplierId: string | null;
  locationId: string | null;
  taxRateId: string | null;
  subtotal: string | number;
  discountAmount: string | number;
  taxAmount: string | number;
  total: string | number;
  createdAt: string;
  items: {
    id: string;
    productId: string | null;
    quantity: number;
    unitCost: string | number;
    lineTotal: string | number;
    product: { id: string; name: string; sku: string | null } | null;
  }[];
};
// types.ts — add
export type PONewProductLine = {
  key: string;
  name: string;
  sku: string;
  category: string;
  brand?: string;
  oem?: string;
  barcode?: string;
  quantity: number;
  unitCost: number;
};
export type PurchaseOrderPrintView = {
  id: string;
  poNumber: string | null;
  status: string;
  businessName: string;
  businessLegalName: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessLogoUrl: string | null;
  locationName: string;
  locationAddress: string | null;
  supplierName: string | null;
  supplierAddress: string | null;
  supplierPhone: string | null;
  supplierNpwp: string | null;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  taxName: string | null;
  taxPercentage: number | null;
  items: {
    id: string;
    productName: string;
    sku: string | null;
    quantity: number;
    unitCost: number;
    lineTotal: number;
  }[];
};