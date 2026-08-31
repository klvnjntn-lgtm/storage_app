/*
  Warnings:
  - Added the required column `locationId` to the `InvoiceItem` table without a default value. This is not possible if the table is not empty.
*/
-- AlterTable: add as nullable first so existing rows don't block it
ALTER TABLE "InvoiceItem" ADD COLUMN "locationId" TEXT;

-- Backfill: every existing InvoiceItem inherits its parent Invoice's location
UPDATE "InvoiceItem" ii
SET "locationId" = inv."locationId"
FROM "Invoice" inv
WHERE ii."invoiceId" = inv.id;

-- Now safe to enforce NOT NULL
ALTER TABLE "InvoiceItem" ALTER COLUMN "locationId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;