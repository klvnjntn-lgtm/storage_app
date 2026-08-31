-- CreateEnum
CREATE TYPE "QuotationFormat" AS ENUM ('A4', 'A5');

-- AlterTable
ALTER TABLE "SalesQuotation" ADD COLUMN     "format" "QuotationFormat" NOT NULL DEFAULT 'A4';
