/*
  Warnings:

  - A unique constraint covering the columns `[replacesInvoiceId]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "replacesInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "paymentTerms" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_replacesInvoiceId_key" ON "Invoice"("replacesInvoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_replacesInvoiceId_fkey" FOREIGN KEY ("replacesInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
