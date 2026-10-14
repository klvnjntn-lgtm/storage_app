-- CreateEnum
CREATE TYPE "BillingPurpose" AS ENUM ('SUBSCRIPTION', 'WA_TOPUP');

-- CreateEnum
CREATE TYPE "BillingPaymentStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BILLING_PAYMENT_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'PLAN_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'LOW_STOCK';
ALTER TYPE "NotificationType" ADD VALUE 'BATCH_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE 'WA_BALANCE_LOW';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ALTER COLUMN "plan" SET DEFAULT 'custom';

-- CreateTable
CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purpose" "BillingPurpose" NOT NULL,
    "status" "BillingPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "plan" TEXT,
    "months" INTEGER,
    "credit" DECIMAL(14,2),
    "gateway" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "gatewayInvoiceId" TEXT,
    "checkoutUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingPayment_externalId_key" ON "BillingPayment"("externalId");

-- CreateIndex
CREATE INDEX "BillingPayment_organizationId_createdAt_idx" ON "BillingPayment"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every org that already exists is managed by hand from the platform
-- console: keep it on "custom" so no plan limit applies to it retroactively.
UPDATE "Organization" SET "plan" = 'custom';
