-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeliveryOrderStatus" ADD VALUE 'PARTIALLY_RETURNED';
ALTER TYPE "DeliveryOrderStatus" ADD VALUE 'RETURNED';

-- AlterTable
ALTER TABLE "DeliveryOrderItem" ADD COLUMN     "returnedQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0;
