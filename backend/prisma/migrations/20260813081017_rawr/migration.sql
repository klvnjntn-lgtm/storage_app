-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceFormat" ADD VALUE 'THERMAL_58';
ALTER TYPE "InvoiceFormat" ADD VALUE 'A4';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "taxName" TEXT,
ADD COLUMN     "taxPercentage" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "OrganizationTaxRate" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;
