import { InvoiceStatus, Prisma, WorkOrderStatus } from '@prisma/client';

// Parts on open workshop jobs are held for them: a job holds its lines from
// approval (an estimate holds nothing) until it's cancelled or its invoice is issued (the stock then leaves for
// real). Derived from the job lines rather than stored, so editing or
// cancelling a job releases its hold with nothing to sync. Only applies
// while the org has work orders turned on — callers check that.
export function heldWorkOrderItemsWhere(
  organizationId: string,
  // The job's own invoice may take what its job is holding.
  excludeInvoiceId?: string,
): Prisma.WorkOrderItemWhereInput {
  return {
    productId: { not: null },
    locationId: { not: null },
    workOrder: {
      organizationId,
      status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.ESTIMATE] },
      invoices: { none: { status: InvoiceStatus.ISSUED } },
      ...(excludeInvoiceId && { NOT: { invoices: { some: { id: excludeInvoiceId } } } }),
    },
  };
}
