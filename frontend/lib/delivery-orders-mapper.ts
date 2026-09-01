// lib/delivery-orders-mapper.ts
import type {
  CreateDeliveryOrderDto,
  DeliverableLine,
  DeliveryOrderDetail,
  DeliveryOrderListItem,
  DeliveryOrderPrintView,
  SalesOrderForDelivery,
} from '@/app/components/delivery-orders/types';

// ---- inbound: raw sales order -> deliverable lines ----------------------
//
// Mirrors the remaining-quantity math in DeliveryOrderService.create():
//   remaining = soItem.quantity - soItem.deliveredQuantity
// Keeping that formula in one place here means the cart panel can never
// silently drift from what the backend will actually accept.

type RawSalesOrderItem = {
  id: string;
  productId: string | null;
  product?: { name: string | null } | null;
  description?: string | null;
  unit: string | null;
  quantity: number | string;
  deliveredQuantity: number | string;
};

type RawSalesOrder = {
  id: string;
  orderNumber: string | null;
  status: string;
  customerId: string | null;
  customer?: { name: string | null; address: string | null } | null;
  customerName?: string | null;
  customerPoNumber: string | null;
  locationId?: string | null;
  items: RawSalesOrderItem[];
};

export function mapSalesOrderToDeliverable(raw: RawSalesOrder): SalesOrderForDelivery {
  const items: DeliverableLine[] = raw.items.map((item) => {
    const ordered = Number(item.quantity);
    const alreadyDelivered = Number(item.deliveredQuantity);
    const remaining = Math.max(ordered - alreadyDelivered, 0);
    return {
      salesOrderItemId: item.id,
      productId: item.productId,
      productName: item.product?.name ?? item.description ?? 'Service',
      unit: item.unit,
      ordered,
      alreadyDelivered,
      remaining,
      // default to fully delivering the line — user can dial it down
      quantityToDeliver: remaining,
    };
  });

  return {
    id: raw.id,
    orderNumber: raw.orderNumber,
    status: raw.status,
    customerId: raw.customerId,
    customerName: raw.customer?.name ?? raw.customerName ?? null,
    customerAddress: raw.customer?.address ?? null,
    customerPoNumber: raw.customerPoNumber,
    locationId: raw.locationId ?? null,
    items,
  };
}

// ---- outbound: cart panel state -> CreateDeliveryOrderDto ----------------

export function mapDeliverableLinesToDto(params: {
  salesOrderId: string;
  sessionId?: string;
  locationId: string;
  deliveryAddress?: string;
  notes?: string;
  lines: DeliverableLine[];
}): CreateDeliveryOrderDto {
  const items = params.lines
    .filter((line) => line.quantityToDeliver > 0)
    .map((line) => ({
      salesOrderItemId: line.salesOrderItemId,
      quantity: line.quantityToDeliver,
    }));

  return {
    salesOrderId: params.salesOrderId,
    sessionId: params.sessionId,
    locationId: params.locationId,
    deliveryAddress: params.deliveryAddress || undefined,
    notes: params.notes || undefined,
    items,
  };
}

// Client-side mirror of the validation in DeliveryOrderService.create(),
// so the cart panel can disable Submit / show inline errors instead of
// round-tripping to the server for something we already know.
export function validateDeliverableLines(lines: DeliverableLine[]): string | null {
  const toDeliver = lines.filter((l) => l.quantityToDeliver > 0);
  if (toDeliver.length === 0) return 'Enter a quantity for at least one item.';
  for (const line of toDeliver) {
    if (line.quantityToDeliver > line.remaining) {
      return `${line.productName}: cannot deliver ${line.quantityToDeliver} — only ${line.remaining} remaining.`;
    }
    if (line.quantityToDeliver < 0) {
      return `${line.productName}: quantity cannot be negative.`;
    }
  }
  return null;
}

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
