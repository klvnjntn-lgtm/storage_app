-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "confirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SalesQuotation" ADD COLUMN     "sentAt" TIMESTAMP(3);
