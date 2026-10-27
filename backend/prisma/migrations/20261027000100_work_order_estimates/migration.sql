-- Work order estimates: a job can wait for the customer's approval first,
-- and can leave recommended work behind as vehicle reminders.
ALTER TYPE "WorkOrderStatus" ADD VALUE 'ESTIMATE' BEFORE 'QUEUED';

ALTER TABLE "WorkOrder" ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedById" TEXT,
ADD COLUMN "approvalNote" TEXT;

ALTER TABLE "VehicleReminder" ADD COLUMN "sourceWorkOrderId" TEXT,
ADD COLUMN "followUpWorkOrderId" TEXT;

ALTER TABLE "VehicleReminder" ADD CONSTRAINT "VehicleReminder_sourceWorkOrderId_fkey" FOREIGN KEY ("sourceWorkOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VehicleReminder" ADD CONSTRAINT "VehicleReminder_followUpWorkOrderId_fkey" FOREIGN KEY ("followUpWorkOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "VehicleReminder_sourceWorkOrderId_idx" ON "VehicleReminder"("sourceWorkOrderId");
