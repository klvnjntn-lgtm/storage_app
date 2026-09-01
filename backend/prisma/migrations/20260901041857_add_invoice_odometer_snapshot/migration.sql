/*
  Warnings:

  - A unique constraint covering the columns `[invoiceId]` on the table `DeliveryOrder` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "DeliveryOrder" DROP CONSTRAINT "DeliveryOrder_salesOrderId_fkey";

-- DropForeignKey
ALTER TABLE "DeliveryOrderItem" DROP CONSTRAINT "DeliveryOrderItem_salesOrderItemId_fkey";

-- AlterTable
ALTER TABLE "DeliveryOrder" ADD COLUMN     "invoiceId" TEXT,
ALTER COLUMN "salesOrderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DeliveryOrderItem" ALTER COLUMN "salesOrderItemId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_invoiceId_key" ON "DeliveryOrder"("invoiceId");

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrderItem" ADD CONSTRAINT "DeliveryOrderItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
