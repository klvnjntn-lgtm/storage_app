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

export function mapDeliveryOrderToListItem(raw: any): DeliveryOrderListItem {
  return {
    id: raw.id,
    doNumber: raw.doNumber,
    status: raw.status,
    customerName: raw.customerName ?? null,
    createdAt: raw.createdAt,
    shippedAt: raw.shippedAt ?? null,
    salesOrder: raw.salesOrder
      ? { orderNumber: raw.salesOrder.orderNumber, customerName: raw.salesOrder.customerName }
      : null,
    items: raw.items ?? [],
  };
}

export function mapDeliveryOrderToDetail(raw: any): DeliveryOrderDetail {
  return {
    id: raw.id,
    doNumber: raw.doNumber,
    status: raw.status,
    salesOrderId: raw.salesOrderId,
        invoiceId: raw.invoiceId ?? null, // NEW

    customerName: raw.customerName ?? null,
    customerAddress: raw.customerAddress ?? null,
    customerPhone: raw.customerPhone ?? null,
    customerPoNumber: raw.customerPoNumber ?? null,
    deliveryAddress: raw.deliveryAddress ?? null,
    notes: raw.notes ?? null,
    createdAt: raw.createdAt,
    shippedAt: raw.shippedAt ?? null,
    deliveredBy: raw.deliveredBy ?? null,
    receivedBy: raw.receivedBy ?? null,
    signedAt: raw.signedAt ?? null,
        invoice: raw.invoice ? { invoiceNumber: raw.invoice.invoiceNumber } : null, // NEW

    salesOrder: raw.salesOrder ? { orderNumber: raw.salesOrder.orderNumber } : null,
    location: raw.location ? { name: raw.location.name } : null,
    // Needed so the detail page can hide "Convert to Invoice" once this
    // delivery order has already been invoiced — same guard the quotation
    // detail page uses against its own `invoices` relation.
    invoices: raw.invoices ?? [],
    items: (raw.items ?? []).map((item: any) => ({
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
