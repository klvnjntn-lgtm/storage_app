-- DropForeignKey
ALTER TABLE "SalesQuotationActivityEvent" DROP CONSTRAINT "SalesQuotationActivityEvent_quotationId_fkey";

-- AlterTable
ALTER TABLE "SalesQuotationActivityEvent" ADD COLUMN     "quotationNumber" TEXT,
ALTER COLUMN "quotationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SalesQuotationActivityEvent" ADD CONSTRAINT "SalesQuotationActivityEvent_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "SalesQuotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
