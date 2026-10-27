-- Branches: what accounting splits by (P&L, expenses, fixed assets),
-- separate from stock locations, which become a WAREHOUSE_OPS-only concept.
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Branch_organizationId_idx" ON "Branch"("organizationId");
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Location" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "branchId" TEXT;
ALTER TABLE "FixedAsset" ADD COLUMN "branchId" TEXT;
ALTER TABLE "JournalEntryLine" ADD COLUMN "branchId" TEXT;

ALTER TABLE "Location" ADD CONSTRAINT "Location_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Until now accounting split by location, so each location becomes a
-- branch of the same name (a lone "CENTRE" takes the business's name) and
-- every record keeps the split it had. Archived locations give archived
-- branches, so history still resolves.
INSERT INTO "Branch" ("id", "organizationId", "name", "address", "phone", "archivedAt", "createdAt")
SELECT 'br_' || l."id",
       l."organizationId",
       CASE WHEN upper(trim(l."name")) = 'CENTRE' THEN o."name" ELSE l."name" END,
       l."address",
       l."phone",
       l."archivedAt",
       l."createdAt"
FROM "Location" l
JOIN "Organization" o ON o."id" = l."organizationId";

-- Orgs with no location at all still get their one branch.
INSERT INTO "Branch" ("id", "organizationId", "name")
SELECT 'br_org_' || o."id", o."id", o."name"
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Location" l WHERE l."organizationId" = o."id");

UPDATE "Location" SET "branchId" = 'br_' || "id";
UPDATE "Invoice" SET "branchId" = 'br_' || "locationId" WHERE "locationId" IS NOT NULL;
UPDATE "Expense" SET "branchId" = 'br_' || "locationId" WHERE "locationId" IS NOT NULL;
UPDATE "FixedAsset" SET "branchId" = 'br_' || "locationId" WHERE "locationId" IS NOT NULL;
UPDATE "JournalEntryLine" SET "branchId" = 'br_' || "locationId" WHERE "locationId" IS NOT NULL;
