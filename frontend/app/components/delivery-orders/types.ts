// components/delivery-orders/types.ts

// ---- shared bits reused from the sales-order side --------------------
// (same pattern as components/quotations/types.ts re-exporting from
// components/invoices/types — swap these two lines for the real imports
// once this lives in the repo)
export type { LocationOption } from '@/app/components/invoices/types';

export type DeliveryOrderStatus = 'PACKED' | 'SHIPPED' | 'CANCELLED';

// ---- creation form (DeliveryOrderCartPanel) ---------------------------

// One line of the source sales order, annotated with how much of it is
// still deliverable. This is what the cart panel renders and edits.
export type DeliverableLine = {
  salesOrderItemId: string;
  productId: string | null;
  productName: string;
  unit: string | null;
  ordered: number;
  alreadyDelivered: number;
  remaining: number;
  /** Quantity the user is packing into *this* delivery order. */
  quantityToDeliver: number;
};

export type SalesOrderForDelivery = {
  id: string;
  orderNumber: string | null;
  status: string;
  customerId: string | null;
  customerName: string | null;
  customerAddress: string | null;
  customerPoNumber: string | null;
  locationId: string | null;
  items: DeliverableLine[];
};

// Matches CreateDeliveryOrderDto on the backend.
export type CreateDeliveryOrderDto = {
  salesOrderId: string;
  sessionId?: string;
  locationId?: string; 
  deliveryAddress?: string;
  notes?: string;
  items: { salesOrderItemId: string; quantity: number }[];
};

// ---- list page ---------------------------------------------------------

export type DeliveryOrderListItem = {
  id: string;
  doNumber: string | null;
  status: DeliveryOrderStatus;
  customerName: string | null;
  createdAt: string;
  shippedAt: string | null;
  salesOrder: { orderNumber: string | null; customerName: string | null } | null;
  items: { id: string }[];
};

export type DeliveryOrderListResponse = {
  data: DeliveryOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type DeliveryOrderListFilters = {
  salesOrderId?: string;
  status?: DeliveryOrderStatus;
  page?: number;
  pageSize?: number;
};

// ---- detail page ---------------------------------------------------------
export type DeliveryOrderDetail = {
  id: string;
  doNumber: string | null;
  status: DeliveryOrderStatus;
  salesOrderId: string | null; // CHANGED: was required, now optional (invoice-sourced DOs have none)
  invoiceId: string | null; // NEW
  customerName: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  customerPoNumber: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  createdAt: string;
  shippedAt: string | null;
  deliveredBy: string | null;
  receivedBy: string | null;
  signedAt: string | null;
  salesOrder: { orderNumber: string | null } | null;
  invoice: { invoiceNumber: string | null } | null; // NEW
  location: { name: string | null } | null;
  invoices: { id: string; invoiceNumber: string | null; status: string }[];

  items: {
    id: string;
    productId: string | null;
    productName: string;
    quantity: number;
    unit: string | null;
  }[];
};

export type RecordProofOfDeliveryInput = {
  deliveredBy?: string;
  receivedBy?: string;
  signedAt?: string;
};

// ---- print view ------------------------------------------------------
// Mirrors DeliveryOrderPrintView in delivery-order.service.ts exactly —
// this is what GET /delivery-orders/:id/print returns and what the
// puppeteer render hits at /print/delivery-orders/:id.
export type DeliveryOrderPrintView = {
  id: string;
  doNumber: string | null;
  status: string;

  businessName: string;
  businessLegalName: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessLogoUrl: string | null;
  invoiceNumber: string | null; // NEW

  locationName: string;
  locationAddress: string | null;

  salesOrderNumber: string | null;

  customerName: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  customerPoNumber: string | null;
  deliveryAddress: string | null;

  createdAt: string;
  shippedAt: string | null;
  notes: string | null;

  deliveredBy: string | null;
  receivedBy: string | null;
  signedAt: string | null;

  items: {
    id: string;
    productName: string;
    quantity: number;
    unit: string | null;
  }[];
};