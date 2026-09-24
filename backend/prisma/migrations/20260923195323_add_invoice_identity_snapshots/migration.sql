-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "customerAddress" TEXT,
ADD COLUMN     "customerBillingAddress" TEXT,
ADD COLUMN     "customerNpwp" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "vehicleModel" TEXT,
ADD COLUMN     "vehiclePlateNumber" TEXT,
ADD COLUMN     "vehicleVin" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "productName" TEXT,
ADD COLUMN     "sku" TEXT;
