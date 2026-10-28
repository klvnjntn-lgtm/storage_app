-- The mechanic who did an invoice's work, separate from its salesperson
-- (employeeId). Invoices from a work order take the job's mechanic.
ALTER TABLE "Invoice" ADD COLUMN "mechanicId" TEXT;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Invoice_organizationId_mechanicId_idx" ON "Invoice"("organizationId", "mechanicId");

UPDATE "Invoice" i SET "mechanicId" = w."mechanicId"
FROM "WorkOrder" w
WHERE i."workOrderId" = w."id" AND w."mechanicId" IS NOT NULL;
