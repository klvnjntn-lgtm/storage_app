-- The start point moves from each route to the business: one place every
-- route leaves from, set once.
ALTER TABLE "Organization" ADD COLUMN "deliveryStartLatitude" DECIMAL(9,6),
ADD COLUMN "deliveryStartLongitude" DECIMAL(9,6);

-- Keep the start a business already uses: its most recent route's.
UPDATE "Organization" o
SET "deliveryStartLatitude" = r."startLatitude", "deliveryStartLongitude" = r."startLongitude"
FROM (
  SELECT DISTINCT ON ("organizationId") "organizationId", "startLatitude", "startLongitude"
  FROM "Route"
  WHERE "startLatitude" IS NOT NULL AND "startLongitude" IS NOT NULL
  ORDER BY "organizationId", "routeDate" DESC, "createdAt" DESC
) r
WHERE r."organizationId" = o.id;

ALTER TABLE "Route" DROP COLUMN "startLatitude",
DROP COLUMN "startLongitude";
