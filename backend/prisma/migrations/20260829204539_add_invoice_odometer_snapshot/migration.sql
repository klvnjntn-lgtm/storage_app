/*
  Warnings:

  - A unique constraint covering the columns `[deliveryOrderItemId]` on the table `InvoiceItem` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "billingAddress" TEXT;

-- AlterTable
ALTER TABLE "SalesOrderActivityEvent" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "SalesQuotation" ADD COLUMN     "quotationDate" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItem_deliveryOrderItemId_key" ON "InvoiceItem"("deliveryOrderItemId");
