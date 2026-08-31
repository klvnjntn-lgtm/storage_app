-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('FIXED', 'PERCENTAGE');

-- AlterTable
ALTER TABLE "DeliveryOrder" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "deliveredBy" TEXT,
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "receivedBy" TEXT;

-- AlterTable
ALTER TABLE "DeliveryOrderItem" ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "customerPoNumber" TEXT,
ADD COLUMN     "discountType" "DiscountType",
ADD COLUMN     "discountValue" DECIMAL(65,30),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paymentTerms" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "customerPoNumber" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "SalesOrderItem" ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "SalesQuotation" ADD COLUMN     "customerPoNumber" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "termsAndConditions" TEXT;

-- AlterTable
ALTER TABLE "SalesQuotationItem" ADD COLUMN     "unit" TEXT;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
