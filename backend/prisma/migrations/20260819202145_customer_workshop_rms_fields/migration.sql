-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_locationId_fkey";

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "locationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
