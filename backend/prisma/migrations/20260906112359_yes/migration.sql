/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,externalId]` on the table `PurchaseOrder` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[purchaseOrderId,externalSeq]` on the table `PurchaseOrderItem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[organizationId,externalId]` on the table `Supplier` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'SALES_QUOTATION', 'SALES_ORDER', 'DELIVERY_ORDER', 'PURCHASE_ORDER');

-- DropIndex
DROP INDEX "Invoice_salesOrderId_key";

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "orderDate" DATE;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "discountPercentage" DECIMAL(5,2),
ADD COLUMN     "externalSeq" INTEGER,
ADD COLUMN     "importedReceivedQuantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unit" TEXT,
ADD COLUMN     "unitRatio" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "externalId" TEXT;

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_organizationId_documentType_key" ON "DocumentSequence"("organizationId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_externalId_key" ON "PurchaseOrder"("organizationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_externalSeq_key" ON "PurchaseOrderItem"("purchaseOrderId", "externalSeq");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_organizationId_externalId_key" ON "Supplier"("organizationId", "externalId");

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
