-- Amortisasi: intangible assets and prepaid expenses spread over the months they benefit.
-- See the Amortization model in schema.prisma.

-- CreateEnum
CREATE TYPE "AmortizationKind" AS ENUM ('INTANGIBLE', 'PREPAID');

-- CreateEnum
CREATE TYPE "AmortizationStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'WRITTEN_OFF');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalSourceType" ADD VALUE 'INTANGIBLE_ASSET';
ALTER TYPE "JournalSourceType" ADD VALUE 'PREPAID_EXPENSE';
ALTER TYPE "JournalSourceType" ADD VALUE 'AMORTIZATION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SystemAccountKey" ADD VALUE 'PREPAID_EXPENSES';
ALTER TYPE "SystemAccountKey" ADD VALUE 'INTANGIBLE_ASSETS';
ALTER TYPE "SystemAccountKey" ADD VALUE 'ACCUMULATED_AMORTIZATION';
ALTER TYPE "SystemAccountKey" ADD VALUE 'AMORTIZATION_EXPENSE';

-- CreateTable
CREATE TABLE "Amortization" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "AmortizationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "branchId" TEXT,
    "startDate" DATE NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "expenseAccountId" TEXT,
    "accumulatedAmortization" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lastAmortizedThrough" DATE,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "AmortizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "writtenOffAt" DATE,
    "notes" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Amortization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmortizationPayment" (
    "id" TEXT NOT NULL,
    "amortizationId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paidAt" DATE NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "bankAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmortizationPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Amortization_organizationId_status_idx" ON "Amortization"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Amortization_branchId_idx" ON "Amortization"("branchId");

-- CreateIndex
CREATE INDEX "Amortization_expenseAccountId_idx" ON "Amortization"("expenseAccountId");

-- CreateIndex
CREATE INDEX "AmortizationPayment_amortizationId_idx" ON "AmortizationPayment"("amortizationId");

-- AddForeignKey
ALTER TABLE "Amortization" ADD CONSTRAINT "Amortization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Amortization" ADD CONSTRAINT "Amortization_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Amortization" ADD CONSTRAINT "Amortization_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Amortization" ADD CONSTRAINT "Amortization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmortizationPayment" ADD CONSTRAINT "AmortizationPayment_amortizationId_fkey" FOREIGN KEY ("amortizationId") REFERENCES "Amortization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmortizationPayment" ADD CONSTRAINT "AmortizationPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmortizationPayment" ADD CONSTRAINT "AmortizationPayment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

