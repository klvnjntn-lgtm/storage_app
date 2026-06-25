-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "oem" TEXT,
ALTER COLUMN "sku" DROP NOT NULL;
