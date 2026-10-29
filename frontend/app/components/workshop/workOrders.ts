// Shared by the work order pages, Settings and the nav.

// Fired by Settings when an admin turns work orders on or off, so the nav
// can show or hide its link without a reload.
export const WORK_ORDERS_CHANGED = 'waresys:work-orders-changed';

export type WorkOrderStatus = 'ESTIMATE' | 'QUEUED' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'DONE' | 'CANCELLED';

// ESTIMATE is legacy (estimates are quotations now), so it's not offered as a filter.
export const WORK_ORDER_STATUSES: WorkOrderStatus[] = ['QUEUED', 'IN_PROGRESS', 'WAITING_PARTS', 'DONE', 'CANCELLED'];

// Work recommended on a job for a later visit — a vehicle reminder.
export type Recommendation = {
  id: string;
  note: string;
  dueDate: string;
  // Also due at this odometer reading (km), whichever comes first.
  dueOdometer?: number | null;
  status: 'PENDING' | 'COMPLETED' | 'DELETED';
  followUpWorkOrderId: string | null;
};

export type WorkOrderItem = {
  id: string;
  productId: string | null;
  description: string | null;
  locationId: string | null;
  quantity: string;
  unitPrice: string | null;
  product: { id: string; name: string; sku: string | null; sellingPrice: string | null } | null;
};

export type WorkOrder = {
  id: string;
  number: string;
  status: WorkOrderStatus;
  customerId: string;
  vehicleId: string;
  mechanicId: string | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  odometer: number | null;
  complaint: string | null;
  notes: string | null;
  estimatedTotal: string;
  validUntil: string | null;
  customerPoNumber: string | null;
  paymentTerms: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  // The quotation it was made from, and additions for parts found mid-job.
  quotations?: { id: string; quotationNumber: string | null; status: string; parentQuotationId: string | null }[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    companyName: string | null;
    npwp: string | null;
    address: string | null;
  };
  vehicle: {
    id: string;
    plateNumber: string;
    vehicleModel: string;
    odometer: number | null;
    // The car as the parts catalogue knows it; null until saved.
    carBrand?: string | null;
    carModel?: string | null;
    carYear?: number | null;
  };
  mechanic: { id: string; name: string } | null;
  items: WorkOrderItem[];
  invoices: { id: string; invoiceNumber: string | null; status: string; total: string; createdAt: string }[];
  invoicedId: string | null;
  recommendations: Recommendation[];
  // The reminder this job was started from, if any.
  followedUp: { id: string; note: string; sourceWorkOrder: { id: string; number: string } | null }[];
  // The earlier job this one redoes (a comeback), and jobs that came back to redo this one.
  comebackOf?: { id: string; number: string; completedAt: string | null; mechanic: { id: string; name: string } | null } | null;
  comebackReason?: string | null;
  comebacks?: { id: string; number: string; comebackReason: string | null; createdAt: string }[];
  // When the customer was last told the car is ready.
  readyNotifiedAt?: string | null;
};

export type Mechanic = { id: string; name: string; position: string | null };

// One editable line in the form. A part has product + location; a labour
// line has a description and its own price.
export type DraftLine =
  | { kind: 'part'; key: string; productId: string; name: string; sku: string | null; locationId: string; quantity: number; unitPrice: number | null }
  | { kind: 'labour'; key: string; description: string; quantity: number; unitPrice: number };

export function toDraftLines(items: WorkOrderItem[]): DraftLine[] {
  return items.map((i) =>
    i.productId
      ? {
          kind: 'part',
          key: i.id,
          productId: i.productId,
          name: i.product?.name ?? '',
          sku: i.product?.sku ?? null,
          locationId: i.locationId ?? '',
          quantity: Number(i.quantity),
          unitPrice: i.unitPrice != null ? Number(i.unitPrice) : null,
        }
      : {
          kind: 'labour',
          key: i.id,
          description: i.description ?? '',
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice ?? 0),
        },
  );
}

export function toPayloadLines(lines: DraftLine[]) {
  return lines.map((l) =>
    l.kind === 'part'
      ? {
          productId: l.productId,
          locationId: l.locationId,
          quantity: l.quantity,
          ...(l.unitPrice != null && { unitPrice: l.unitPrice }),
        }
      : { description: l.description.trim(), quantity: l.quantity, unitPrice: l.unitPrice },
  );
}

export function statusStyle(status: WorkOrderStatus): string {
  switch (status) {
    case 'ESTIMATE':
      return 'bg-purple-50 text-purple-700 border-purple-300';
    case 'QUEUED':
      return 'bg-gray-50 text-gray-700 border-gray-300';
    case 'IN_PROGRESS':
      return 'bg-blue-50 text-blue-700 border-blue-300';
    case 'WAITING_PARTS':
      return 'bg-amber-50 text-amber-700 border-amber-300';
    case 'DONE':
      return 'bg-green-50 text-green-700 border-green-300';
    case 'CANCELLED':
      return 'bg-red-50 text-red-700 border-red-300';
  }
}
