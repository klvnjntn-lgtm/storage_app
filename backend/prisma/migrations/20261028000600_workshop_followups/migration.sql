-- Comebacks (a job redoing an earlier one) and when the customer was told the car is ready.
ALTER TABLE "WorkOrder" ADD COLUMN "comebackOfId" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "comebackReason" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "readyNotifiedAt" TIMESTAMP(3);
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_comebackOfId_fkey" FOREIGN KEY ("comebackOfId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Service reminders can also fall due by odometer.
ALTER TABLE "VehicleReminder" ADD COLUMN "dueOdometer" INTEGER;

-- Quotations, sales orders and delivery orders belong to a branch, like invoices.
ALTER TABLE "SalesQuotation" ADD COLUMN "branchId" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "branchId" TEXT;
ALTER TABLE "DeliveryOrder" ADD COLUMN "branchId" TEXT;
ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing documents: their invoice's branch, else their location's, else the org's first.
UPDATE "DeliveryOrder" d SET "branchId" = i."branchId" FROM "Invoice" i WHERE d."invoiceId" = i."id" AND d."branchId" IS NULL;
UPDATE "SalesOrder" o SET "branchId" = (
  SELECT i."branchId" FROM "Invoice" i WHERE i."salesOrderId" = o."id" AND i."branchId" IS NOT NULL ORDER BY i."createdAt" DESC LIMIT 1
) WHERE o."branchId" IS NULL;
UPDATE "SalesQuotation" q SET "branchId" = (
  SELECT i."branchId" FROM "Invoice" i WHERE i."quotationId" = q."id" AND i."branchId" IS NOT NULL ORDER BY i."createdAt" DESC LIMIT 1
) WHERE q."branchId" IS NULL;
UPDATE "SalesQuotation" q SET "branchId" = l."branchId" FROM "Location" l WHERE q."locationId" = l."id" AND q."branchId" IS NULL;
UPDATE "SalesOrder" o SET "branchId" = l."branchId" FROM "Location" l WHERE o."locationId" = l."id" AND o."branchId" IS NULL;
UPDATE "DeliveryOrder" d SET "branchId" = o."branchId" FROM "SalesOrder" o WHERE d."salesOrderId" = o."id" AND d."branchId" IS NULL;
UPDATE "DeliveryOrder" d SET "branchId" = l."branchId" FROM "Location" l WHERE d."locationId" = l."id" AND d."branchId" IS NULL;

CREATE TEMP TABLE "_FirstBranch" AS
SELECT DISTINCT ON (b."organizationId") b."organizationId", b."id"
FROM "Branch" b WHERE b."archivedAt" IS NULL
ORDER BY b."organizationId", b."createdAt", b."id";
UPDATE "SalesQuotation" q SET "branchId" = f."id" FROM "_FirstBranch" f WHERE q."branchId" IS NULL AND f."organizationId" = q."organizationId";
UPDATE "SalesOrder" o SET "branchId" = f."id" FROM "_FirstBranch" f WHERE o."branchId" IS NULL AND f."organizationId" = o."organizationId";
UPDATE "DeliveryOrder" d SET "branchId" = f."id" FROM "_FirstBranch" f WHERE d."branchId" IS NULL AND f."organizationId" = d."organizationId";
DROP TABLE "_FirstBranch";
