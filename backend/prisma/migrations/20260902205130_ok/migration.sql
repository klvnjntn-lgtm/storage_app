/*
  Warnings:

  - You are about to drop the column `bankAccountName` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `bankAccountNumber` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `bankName` on the `Organization` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT;

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "bankAccountName",
DROP COLUMN "bankAccountNumber",
DROP COLUMN "bankName";

-- CreateTable
CREATE TABLE "OrganizationBankAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "OrganizationBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_OrganizationBankAccountToSalesQuotation" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OrganizationBankAccountToSalesQuotation_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "OrganizationBankAccount_organizationId_idx" ON "OrganizationBankAccount"("organizationId");

-- CreateIndex
CREATE INDEX "_OrganizationBankAccountToSalesQuotation_B_index" ON "_OrganizationBankAccountToSalesQuotation"("B");

-- AddForeignKey
ALTER TABLE "OrganizationBankAccount" ADD CONSTRAINT "OrganizationBankAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OrganizationBankAccountToSalesQuotation" ADD CONSTRAINT "_OrganizationBankAccountToSalesQuotation_A_fkey" FOREIGN KEY ("A") REFERENCES "OrganizationBankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OrganizationBankAccountToSalesQuotation" ADD CONSTRAINT "_OrganizationBankAccountToSalesQuotation_B_fkey" FOREIGN KEY ("B") REFERENCES "SalesQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
