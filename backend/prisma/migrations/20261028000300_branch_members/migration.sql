-- ADMIN now runs a single branch and MASTER runs the whole business.
-- Every existing admin had business-wide control, so they become MASTER.
UPDATE "User" SET "role" = 'MASTER' WHERE "role" = 'ADMIN';

-- The branch an ADMIN or USER works at, and only sees.
ALTER TABLE "User" ADD COLUMN "branchId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_branchId_idx" ON "User"("branchId");

-- Bank accounts can belong to one branch (null = shared).
ALTER TABLE "OrganizationBankAccount" ADD COLUMN "branchId" TEXT;
ALTER TABLE "OrganizationBankAccount" ADD CONSTRAINT "OrganizationBankAccount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Employees can belong to a branch, so payroll splits by branch.
ALTER TABLE "Employee" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Branch staff only see their branch's sales and jobs, so nothing can be
-- left without one: every org gets its first branch (as
-- ensureDefaultBranch would), and untagged invoices, work orders and
-- staff go to it.
INSERT INTO "Branch" ("id", "organizationId", "name")
SELECT gen_random_uuid()::text, o."id", o."name"
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Branch" b WHERE b."organizationId" = o."id" AND b."archivedAt" IS NULL);

CREATE TEMP TABLE "_FirstBranch" AS
SELECT DISTINCT ON (b."organizationId") b."organizationId", b."id"
FROM "Branch" b
WHERE b."archivedAt" IS NULL
ORDER BY b."organizationId", b."createdAt", b."id";

UPDATE "Invoice" i SET "branchId" = f."id" FROM "_FirstBranch" f
WHERE i."branchId" IS NULL AND f."organizationId" = i."organizationId";
UPDATE "WorkOrder" w SET "branchId" = f."id" FROM "_FirstBranch" f
WHERE w."branchId" IS NULL AND f."organizationId" = w."organizationId";
UPDATE "User" u SET "branchId" = f."id" FROM "_FirstBranch" f
WHERE u."branchId" IS NULL AND u."role" IN ('ADMIN', 'USER') AND f."organizationId" = u."organizationId";

DROP TABLE "_FirstBranch";
