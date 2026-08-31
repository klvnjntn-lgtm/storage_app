/*
  Warnings:

  - The values [A5] on the enum `QuotationFormat` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "SalesOrderFormat" AS ENUM ('A4');

-- AlterEnum
BEGIN;
CREATE TYPE "QuotationFormat_new" AS ENUM ('A4');
ALTER TABLE "public"."SalesQuotation" ALTER COLUMN "format" DROP DEFAULT;
ALTER TABLE "SalesQuotation" ALTER COLUMN "format" TYPE "QuotationFormat_new" USING ("format"::text::"QuotationFormat_new");
ALTER TYPE "QuotationFormat" RENAME TO "QuotationFormat_old";
ALTER TYPE "QuotationFormat_new" RENAME TO "QuotationFormat";
DROP TYPE "public"."QuotationFormat_old";
ALTER TABLE "SalesQuotation" ALTER COLUMN "format" SET DEFAULT 'A4';
COMMIT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "format" "SalesOrderFormat" NOT NULL DEFAULT 'A4';
