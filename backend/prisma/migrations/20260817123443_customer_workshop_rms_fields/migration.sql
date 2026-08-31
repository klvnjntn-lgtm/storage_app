/*
  Warnings:

  - You are about to drop the column `notes` on the `Customer` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "ModuleKey" ADD VALUE 'WORKSHOP_RMS';

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "notes",
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "odometer" INTEGER,
ADD COLUMN     "plateNumber" TEXT,
ADD COLUMN     "vehicleModel" TEXT,
ADD COLUMN     "vin" TEXT;
