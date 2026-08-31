-- AlterTable
ALTER TABLE "DeliveryOrder" ADD COLUMN     "customerAddress" TEXT,
ADD COLUMN     "customerPoNumber" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3);
