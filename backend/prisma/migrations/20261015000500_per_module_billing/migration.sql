-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTH', 'YEAR');

-- AlterTable
ALTER TABLE "BillingPayment" DROP COLUMN "months",
DROP COLUMN "plan",
ADD COLUMN     "modules" "ModuleKey"[] DEFAULT ARRAY[]::"ModuleKey"[],
ADD COLUMN     "period" "BillingPeriod";

-- AlterTable
ALTER TABLE "OrganizationModule" ADD COLUMN     "paidUntil" TIMESTAMP(3);
