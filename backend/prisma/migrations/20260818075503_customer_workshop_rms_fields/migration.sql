-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'COMPLETED', 'DELETED');

-- CreateTable
CREATE TABLE "VehicleReminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleReminder_organizationId_status_dueDate_idx" ON "VehicleReminder"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "VehicleReminder_vehicleId_idx" ON "VehicleReminder"("vehicleId");

-- AddForeignKey
ALTER TABLE "VehicleReminder" ADD CONSTRAINT "VehicleReminder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleReminder" ADD CONSTRAINT "VehicleReminder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
