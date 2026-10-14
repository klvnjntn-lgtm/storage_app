-- CreateEnum
CREATE TYPE "SerialStatus" AS ENUM ('IN_STOCK', 'IN_TRANSIT', 'SOLD', 'RETURNED_TO_SUPPLIER', 'WRITTEN_OFF');

-- AlterTable
ALTER TABLE "GoodsReceiptItem" ADD COLUMN     "serialNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "serialNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "trackSerials" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PurchaseReturnItem" ADD COLUMN     "serialNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "StockTransferItem" ADD COLUMN     "serialNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ProductSerial" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "status" "SerialStatus" NOT NULL DEFAULT 'IN_STOCK',
    "locationId" TEXT,
    "goodsReceiptId" TEXT,
    "invoiceId" TEXT,
    "soldAt" TIMESTAMP(3),
    "purchaseReturnId" TEXT,
    "stockTransferId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSerial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSerial_organizationId_serialNumber_idx" ON "ProductSerial"("organizationId", "serialNumber");

-- CreateIndex
CREATE INDEX "ProductSerial_invoiceId_idx" ON "ProductSerial"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSerial_productId_serialNumber_key" ON "ProductSerial"("productId", "serialNumber");

-- AddForeignKey
ALTER TABLE "ProductSerial" ADD CONSTRAINT "ProductSerial_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSerial" ADD CONSTRAINT "ProductSerial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSerial" ADD CONSTRAINT "ProductSerial_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
