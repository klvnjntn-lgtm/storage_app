// lib/mappers/delivery-orders-mapper.ts
import type {
  DeliveryOrderDetail,
  DeliveryOrderListItem,
  DeliveryOrderPrintView,
} from '@/app/components/delivery-orders/types';

// FIX — this file used to also export mapSalesOrderToDeliverable(),
// mapDeliverableLinesToDto(), and validateDeliverableLines(), meant to be
// the single source of truth for the remaining-quantity formula
// (ordered - deliveredQuantity) so DeliveryOrdersPanel.tsx couldn't
// silently drift from what DeliveryOrderService.create() accepts. None
// of the three ever had a caller — DeliveryOrdersPanel.tsx reimplements
// the identical formula inline instead — so the "can never drift"
// guarantee the old comment here claimed was never actually true.
// Removed rather than left as unused, misleading dead code; see
// DeliveryOrdersPanel.tsx's own `remaining()` for the live version of
// this formula.

// ---- inbound: raw delivery order -> list row / detail view ---------------

// A delivery order as the API sends it: the always-present fields, plus the
// rest of the detail shape optionally (list rows carry fewer fields).
type RawDeliveryOrder = Pick<DeliveryOrderDetail, 'id' | 'doNumber' | 'status' | 'createdAt'> &
  Partial<
    Omit<
      DeliveryOrderDetail,
      'id' | 'doNumber' | 'status' | 'createdAt' | 'hasProofPhoto' | 'salesOrder' | 'invoice' | 'location' | 'items'
    >
  > & {
    proofPhotoKey?: string | null;
    proofPhotoUrl?: string | null;
    salesOrder?: { id?: string; orderNumber: string | null; customerName?: string | null } | null;
    invoice?: { id?: string; invoiceNumber: string | null; status?: string | null } | null;
    location?: { name: string } | null;
    items?: {
      id: string;
      productId?: string | null;
      productName: string;
      quantity: number | string;
      unit?: string | null;
    }[];
  };

export function mapDeliveryOrderToListItem(raw: RawDeliveryOrder): DeliveryOrderListItem {
  return {
    id: raw.id,
    doNumber: raw.doNumber,
    status: raw.status,
    customerName: raw.customerName ?? null,
    createdAt: raw.createdAt,
    shippedAt: raw.shippedAt ?? null,
    salesOrder: raw.salesOrder
      ? { id: raw.salesOrder.id ?? raw.salesOrderId ?? '', orderNumber: raw.salesOrder.orderNumber, customerName: raw.salesOrder.customerName ?? null }
      : null,
    // A delivery shipped straight from an invoice (no sales order).
    invoice: raw.invoice?.id
      ? { id: raw.invoice.id, invoiceNumber: raw.invoice.invoiceNumber, status: raw.invoice.status ?? null }
      : null,
    items: raw.items ?? [],
  };
}

export function mapDeliveryOrderToDetail(raw: RawDeliveryOrder): DeliveryOrderDetail {
  return {
    id: raw.id,
    doNumber: raw.doNumber,
    status: raw.status,
    salesOrderId: raw.salesOrderId ?? null,
    invoiceId: raw.invoiceId ?? null,

    customerName: raw.customerName ?? null,
    customerAddress: raw.customerAddress ?? null,
    customerPhone: raw.customerPhone ?? null,
    customerPoNumber: raw.customerPoNumber ?? null,
    deliveryAddress: raw.deliveryAddress ?? null,
    customerId: raw.customerId ?? null,
    destinationLatitude: raw.destinationLatitude ?? null,
    destinationLongitude: raw.destinationLongitude ?? null,
    notes: raw.notes ?? null,
    createdAt: raw.createdAt,
    shippedAt: raw.shippedAt ?? null,
    deliveredBy: raw.deliveredBy ?? null,
    receivedBy: raw.receivedBy ?? null,
    signedAt: raw.signedAt ?? null,
    hasProofPhoto: !!(raw.proofPhotoKey || raw.proofPhotoUrl),
    completedLatitude: raw.completedLatitude ?? null,
    completedLongitude: raw.completedLongitude ?? null,
    completedAccuracy: raw.completedAccuracy ?? null,
    invoice: raw.invoice ? { invoiceNumber: raw.invoice.invoiceNumber } : null,
    salesOrder: raw.salesOrder ? { orderNumber: raw.salesOrder.orderNumber } : null,
    location: raw.location ? { name: raw.location.name } : null,
    // Needed so the detail page can hide "Convert to Invoice" once this
    // delivery order has already been invoiced — same guard the quotation
    // detail page uses against its own `invoices` relation.
    invoices: raw.invoices ?? [],
    items: (raw.items ?? []).map((item) => ({
      id: item.id,
      productId: item.productId ?? null,
      productName: item.productName,
      quantity: Number(item.quantity),
      unit: item.unit ?? null,
    })),
  };
}

// ---- print view: flat backend shape -> nested view for the A4 template ---
//
// Same split as lib/quotation-mapper.ts's toQuotationView(): the backend
// returns DeliveryOrderPrintView flat (that's what GET /delivery-orders/:id/print
// and the puppeteer render both consume), but the template reads more
// naturally off grouped objects (business / location / customer / proof).

export type DeliveryOrderView = {
  doNumber: string | null;
  status: string;
  business: {
    name: string;
    legalName: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
  location: { name: string; address: string | null };
  salesOrderNumber: string | null;
  invoiceNumber: string | null; // NEW
  customer: {
    name: string | null;
    address: string | null;
    phone: string | null;
    poNumber: string | null;
  };
  deliveryAddress: string | null;
  createdAt: string;
  shippedAt: string | null;
  notes: string | null;
  proofOfDelivery: {
    deliveredBy: string | null;
    receivedBy: string | null;
    signedAt: string | null;
  };
  items: { id: string; productName: string; quantity: number; unit: string | null }[];
};

export function toDeliveryOrderView(raw: DeliveryOrderPrintView): DeliveryOrderView {
  return {
    doNumber: raw.doNumber,
    status: raw.status,
    business: {
      name: raw.businessName,
      legalName: raw.businessLegalName,
      address: raw.businessAddress,
      phone: raw.businessPhone,
      logoUrl: raw.businessLogoUrl,
    },
    location: { name: raw.locationName, address: raw.locationAddress },
    salesOrderNumber: raw.salesOrderNumber,
    invoiceNumber: raw.invoiceNumber, // NEW
    customer: {
      name: raw.customerName,
      address: raw.customerAddress,
      phone: raw.customerPhone,
      poNumber: raw.customerPoNumber,
    },
    deliveryAddress: raw.deliveryAddress,
    createdAt: raw.createdAt,
    shippedAt: raw.shippedAt,
    notes: raw.notes,
    proofOfDelivery: {
      deliveredBy: raw.deliveredBy,
      receivedBy: raw.receivedBy,
      signedAt: raw.signedAt,
    },
    items: raw.items,
  };
}
