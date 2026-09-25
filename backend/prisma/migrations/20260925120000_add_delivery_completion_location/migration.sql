-- AlterEnum
ALTER TYPE "DeliveryOrderStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "DeliveryOrder" ADD COLUMN     "completedLatitude" DECIMAL(9,6),
ADD COLUMN     "completedLongitude" DECIMAL(9,6),
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "failureLatitude" DECIMAL(9,6),
ADD COLUMN     "failureLongitude" DECIMAL(9,6);
