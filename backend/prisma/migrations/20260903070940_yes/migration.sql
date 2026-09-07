-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT;

-- AlterTable
ALTER TABLE "SalesQuotation" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT;

-- AddForeignKey
ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
