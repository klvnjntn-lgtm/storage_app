/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,customerId,plateNumber]` on the table `Vehicle` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_organizationId_customerId_plateNumber_key" ON "Vehicle"("organizationId", "customerId", "plateNumber");
