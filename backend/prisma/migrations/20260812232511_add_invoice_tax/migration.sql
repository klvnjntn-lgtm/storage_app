/*
  Warnings:

  - You are about to drop the column `active` on the `OrganizationTaxRate` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "OrganizationTaxRate" DROP COLUMN "active",
ADD COLUMN     "archivedAt" TIMESTAMP(3);
