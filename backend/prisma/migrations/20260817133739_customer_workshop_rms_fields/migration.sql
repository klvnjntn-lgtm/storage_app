/*
  Warnings:

  - You are about to drop the column `odometer` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `plateNumber` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `vehicleModel` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `vin` on the `Customer` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "odometer",
DROP COLUMN "plateNumber",
DROP COLUMN "vehicleModel",
DROP COLUMN "vin";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "vehicleId" TEXT;

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "vehicleModel" TEXT NOT NULL,
    "vin" TEXT,
    "odometer" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vehicle_customerId_idx" ON "Vehicle"("customerId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
