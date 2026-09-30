import { NotFoundException } from '@nestjs/common';
import { FulfillmentStatus, Prisma } from '@prisma/client';

// Recomputes Invoice.fulfillmentStatus from its physical lines'
// fulfilledQuantity. A plain function rather than an InvoiceService method
// so SessionsService can call it — InvoiceService already depends on
// SessionsService, so the reverse injection would be circular.
export async function recomputeInvoiceFulfillmentStatus(
  client: Pick<Prisma.TransactionClient, 'invoice'>,
  organizationId: string,
  invoiceId: string,
) {
  const invoice = await client.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: { items: true },
  });
  if (!invoice) throw new NotFoundException('Invoice not found');

  const physicalItems = invoice.items.filter((i) => i.productId);
  const totalQuantity = physicalItems.reduce((sum, i) => sum + Number(i.quantity), 0);
  const totalFulfilled = physicalItems.reduce((sum, i) => sum + Number(i.fulfilledQuantity), 0);

  const newStatus =
    totalQuantity === 0 || totalFulfilled >= totalQuantity
      ? FulfillmentStatus.FULFILLED
      : totalFulfilled > 0
      ? FulfillmentStatus.PARTIALLY_FULFILLED
      : FulfillmentStatus.UNFULFILLED;

  if (newStatus === invoice.fulfillmentStatus) return invoice;
  return client.invoice.update({ where: { id: invoiceId }, data: { fulfillmentStatus: newStatus } });
}
