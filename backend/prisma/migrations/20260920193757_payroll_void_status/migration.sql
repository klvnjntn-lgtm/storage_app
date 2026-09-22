-- CreateEnum
CREATE TYPE "FulfillmentPath" AS ENUM ('DIRECT_ISSUE', 'DELIVERY_ORDER', 'SESSION');

-- AlterEnum
ALTER TYPE "JournalSourceType" ADD VALUE 'STOCK_ADJUSTMENT';

-- AlterEnum
ALTER TYPE "PayrollStatus" ADD VALUE 'VOID';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SystemAccountKey" ADD VALUE 'INVENTORY_ADJUSTMENT';
ALTER TYPE "SystemAccountKey" ADD VALUE 'OPENING_BALANCE_EQUITY';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "fulfillmentPath" "FulfillmentPath",
ALTER COLUMN "amountPaid" SET DEFAULT 0,
ALTER COLUMN "amountPaid" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);
