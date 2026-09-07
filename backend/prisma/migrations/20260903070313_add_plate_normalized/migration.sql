/*
  Warnings:

  - You are about to drop the column `bankAccountId` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `bankAccountName` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `bankAccountNumber` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `bankName` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the `_OrganizationBankAccountToSalesQuotation` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[organizationId,npwp]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[organizationId,receiptNumber]` on the table `GoodsReceipt` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[salesOrderId]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[organizationId,bankName,accountNumber]` on the table `OrganizationBankAccount` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[organizationId,npwp]` on the table `Supplier` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[organizationId,vin]` on the table `Vehicle` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `plateNormalized` to the `Vehicle` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_bankAccountId_fkey";

-- DropForeignKey
ALTER TABLE "_OrganizationBankAccountToSalesQuotation" DROP CONSTRAINT "_OrganizationBankAccountToSalesQuotation_A_fkey";

-- DropForeignKey
ALTER TABLE "_OrganizationBankAccountToSalesQuotation" DROP CONSTRAINT "_OrganizationBankAccountToSalesQuotation_B_fkey";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "bankAccountId",
DROP COLUMN "bankAccountName",
DROP COLUMN "bankAccountNumber",
DROP COLUMN "bankName";

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN "plateNormalized" TEXT;

UPDATE "Vehicle"
SET "plateNormalized" = upper(regexp_replace("plateNumber", '[^A-Za-z0-9]', '', 'g'));

ALTER TABLE "Vehicle" ALTER COLUMN "plateNormalized" SET NOT NULL;

-- DropTable
DROP TABLE "_OrganizationBankAccountToSalesQuotation";

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_npwp_key" ON "Customer"("organizationId", "npwp");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_organizationId_receiptNumber_key" ON "GoodsReceipt"("organizationId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_salesOrderId_key" ON "Invoice"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationBankAccount_organizationId_bankName_accountNumb_key" ON "OrganizationBankAccount"("organizationId", "bankName", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_organizationId_npwp_key" ON "Supplier"("organizationId", "npwp");

-- CreateIndex
CREATE INDEX "Vehicle_organizationId_plateNormalized_idx" ON "Vehicle"("organizationId", "plateNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_organizationId_vin_key" ON "Vehicle"("organizationId", "vin");
