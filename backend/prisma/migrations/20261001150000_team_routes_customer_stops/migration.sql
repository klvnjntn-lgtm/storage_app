-- Routes belong to teams (one team = one driver = one route per day);
-- stops can be customer visits instead of delivery orders; customers get
-- driver directions + location photos. See schema comments on Route,
-- RouteStop, Team and CustomerLocationPhoto.

-- ── Route.driverId → Route.teamId ──────────────────────────────────────
ALTER TABLE "Route" ADD COLUMN "teamId" TEXT;

-- Every driver with routes needs a team. Drivers already in a team keep
-- it; the rest get their own team named after them (email when the
-- display name is already taken as a team name in that org).
DO $$
DECLARE
  d RECORD;
  team_name TEXT;
  new_id TEXT;
BEGIN
  FOR d IN
    SELECT DISTINCT u."id", u."organizationId", u."displayName", u."email"
    FROM "Route" r JOIN "User" u ON u."id" = r."driverId"
    WHERE u."teamId" IS NULL
  LOOP
    team_name := COALESCE(NULLIF(TRIM(d."displayName"), ''), d."email");
    IF EXISTS (SELECT 1 FROM "Team" t WHERE t."organizationId" = d."organizationId" AND t."name" = team_name) THEN
      team_name := d."email";
    END IF;
    new_id := 'mig' || md5(random()::text || d."id");
    INSERT INTO "Team" ("id", "organizationId", "name", "createdAt")
    VALUES (new_id, d."organizationId", team_name, CURRENT_TIMESTAMP);
    UPDATE "User" SET "teamId" = new_id WHERE "id" = d."id";
  END LOOP;
END $$;

UPDATE "Route" r SET "teamId" = u."teamId" FROM "User" u WHERE u."id" = r."driverId";

ALTER TABLE "Route" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "Route" DROP CONSTRAINT "Route_driverId_fkey";
DROP INDEX "Route_organizationId_driverId_routeDate_idx";
ALTER TABLE "Route" DROP COLUMN "driverId";
CREATE INDEX "Route_organizationId_teamId_routeDate_idx" ON "Route"("organizationId", "teamId", "routeDate");
ALTER TABLE "Route" ADD CONSTRAINT "Route_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Customer stops ─────────────────────────────────────────────────────
ALTER TABLE "RouteStop" DROP CONSTRAINT "RouteStop_deliveryOrderId_fkey";
ALTER TABLE "RouteStop" ADD COLUMN     "address" TEXT,
ADD COLUMN     "completedByUserId" TEXT,
ADD COLUMN     "completedLatitude" DECIMAL(9,6),
ADD COLUMN     "completedLongitude" DECIMAL(9,6),
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "deliveryWindowEnd" TIMESTAMP(3),
ADD COLUMN     "deliveryWindowStart" TIMESTAMP(3),
ADD COLUMN     "destinationLatitude" DECIMAL(9,6),
ADD COLUMN     "destinationLongitude" DECIMAL(9,6),
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureLatitude" DECIMAL(9,6),
ADD COLUMN     "failureLongitude" DECIMAL(9,6),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "priority" "DeliveryPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "proofPhotoKey" TEXT,
ADD COLUMN     "receivedBy" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3),
ALTER COLUMN "deliveryOrderId" DROP NOT NULL;

CREATE INDEX "RouteStop_customerId_idx" ON "RouteStop"("customerId");
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A stop is a DO or a customer visit, never both. customerName (the
-- snapshot) rather than customerId marks a customer stop, so deleting the
-- customer later (customerId → NULL) keeps the historical stop valid.
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_target_check" CHECK (
  ("deliveryOrderId" IS NOT NULL AND "customerName" IS NULL)
  OR ("deliveryOrderId" IS NULL AND "customerName" IS NOT NULL)
);

-- ── Customer delivery info ─────────────────────────────────────────────
ALTER TABLE "Customer" ADD COLUMN "deliveryNotes" TEXT;

CREATE TABLE "CustomerLocationPhoto" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerLocationPhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerLocationPhoto_organizationId_customerId_idx" ON "CustomerLocationPhoto"("organizationId", "customerId");
ALTER TABLE "CustomerLocationPhoto" ADD CONSTRAINT "CustomerLocationPhoto_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerLocationPhoto" ADD CONSTRAINT "CustomerLocationPhoto_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
