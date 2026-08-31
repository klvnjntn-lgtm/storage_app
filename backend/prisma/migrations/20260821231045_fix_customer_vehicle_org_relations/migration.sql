-- ============================================================
-- 1. Customer.orgId -> Customer.organizationId
-- ============================================================
-- Simple rename — data is preserved, no backfill needed.
-- This alone fixes the "Customer.organizationId does not exist" errors.

ALTER TABLE "Customer" RENAME COLUMN "orgId" TO "organizationId";

-- The old indexes are tied to the old column name and won't auto-rename
-- with the column in all Postgres setups — drop and recreate explicitly
-- so they match what schema.prisma now expects.
DROP INDEX IF EXISTS "Customer_orgId_idx";
DROP INDEX IF EXISTS "Customer_orgId_name_idx";

CREATE INDEX "Customer_organizationId_idx" ON "Customer"("organizationId");
CREATE INDEX "Customer_organizationId_name_idx" ON "Customer"("organizationId", "name");

-- Composite unique needed for Invoice.customer's FK to [id, organizationId]
ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_id_organizationId_key" UNIQUE ("id", "organizationId");


-- ============================================================
-- 2. Vehicle.organizationId — new column, did not exist before
-- ============================================================
-- Add nullable first so existing rows don't fail the ADD COLUMN step.

ALTER TABLE "Vehicle" ADD COLUMN "organizationId" TEXT;

-- Backfill from the vehicle's customer, since Vehicle -> Customer -> Organization
-- was the only path to an org before this column existed.
UPDATE "Vehicle" v
SET "organizationId" = c."organizationId"
FROM "Customer" c
WHERE v."customerId" = c."id";

-- Sanity check before locking it down — this should return 0 rows.
-- If it doesn't, some vehicles have a customerId that doesn't resolve
-- to a customer (orphaned FK) and need manual attention before the
-- NOT NULL constraint below will succeed.
-- SELECT id, "customerId" FROM "Vehicle" WHERE "organizationId" IS NULL;

ALTER TABLE "Vehicle" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Vehicle"
  ADD CONSTRAINT "Vehicle_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id");

CREATE INDEX "Vehicle_organizationId_idx" ON "Vehicle"("organizationId");

-- Composite unique needed for Invoice.vehicle's FK to [id, organizationId]
ALTER TABLE "Vehicle"
  ADD CONSTRAINT "Vehicle_id_organizationId_key" UNIQUE ("id", "organizationId");


-- ============================================================
-- 3. Location — composite unique needed for Invoice.location's FK
-- ============================================================
-- (organizationId column already existed on Location — this just adds
-- the constraint that Invoice's composite FK requires.)

ALTER TABLE "Location"
  ADD CONSTRAINT "Location_id_organizationId_key" UNIQUE ("id", "organizationId");

  ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_locationId_organizationId_fkey"
  FOREIGN KEY ("locationId", "organizationId")
  REFERENCES "Location"("id", "organizationId")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_customerId_organizationId_fkey"
  FOREIGN KEY ("customerId", "organizationId")
  REFERENCES "Customer"("id", "organizationId")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_vehicleId_organizationId_fkey"
  FOREIGN KEY ("vehicleId", "organizationId")
  REFERENCES "Vehicle"("id", "organizationId")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;