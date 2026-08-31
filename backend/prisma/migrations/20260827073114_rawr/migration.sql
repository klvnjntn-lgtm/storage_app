-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "salesOrderId" TEXT;

-- CreateIndex
CREATE INDEX "Event_invoiceId_idx" ON "Event"("invoiceId");

-- CreateIndex
CREATE INDEX "Event_salesOrderId_idx" ON "Event"("salesOrderId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
