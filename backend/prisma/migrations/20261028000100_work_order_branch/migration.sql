-- Work orders belong to a branch (multi-branch workshops); the job's
-- invoice is booked to it. Existing jobs take their invoice's branch, else
-- their first part's location's.
ALTER TABLE "WorkOrder" ADD COLUMN "branchId" TEXT;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "WorkOrder" w SET "branchId" = (
  SELECT i."branchId" FROM "Invoice" i
  WHERE i."workOrderId" = w."id" AND i."branchId" IS NOT NULL
  ORDER BY i."createdAt" DESC LIMIT 1
);
UPDATE "WorkOrder" w SET "branchId" = (
  SELECT l."branchId" FROM "WorkOrderItem" wi JOIN "Location" l ON l."id" = wi."locationId"
  WHERE wi."workOrderId" = w."id" AND l."branchId" IS NOT NULL
  ORDER BY wi."sortOrder" LIMIT 1
)
WHERE w."branchId" IS NULL;
