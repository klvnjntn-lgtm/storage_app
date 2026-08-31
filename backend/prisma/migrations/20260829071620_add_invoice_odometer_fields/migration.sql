/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,name,externalWarehouseId]` on the table `Location` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Location_organizationId_name_key";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "nextServiceKm" INTEGER,
ADD COLUMN     "odometer" INTEGER;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "externalWarehouseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Location_organizationId_name_externalWarehouseId_key" ON "Location"("organizationId", "name", "externalWarehouseId");
