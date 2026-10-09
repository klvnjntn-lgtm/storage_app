-- Where a customer / saved-address pin came from: set by the office
-- (MANUAL, locked) or from a driver's GPS at a delivery (GPS, replaced by
-- a later, more accurate fix). pinAccuracy is that fix's accuracy in metres.
-- CreateEnum
CREATE TYPE "PinSource" AS ENUM ('MANUAL', 'GPS');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "pinSource" "PinSource",
ADD COLUMN "pinAccuracy" DOUBLE PRECISION,
ADD COLUMN "pinSetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CustomerAddress" ADD COLUMN "pinSource" "PinSource",
ADD COLUMN "pinAccuracy" DOUBLE PRECISION,
ADD COLUMN "pinSetAt" TIMESTAMP(3);

-- Existing pins. One that matches a completed delivery's GPS fix for the
-- same customer exactly was filled from the driver's GPS: mark it GPS with
-- that fix's accuracy (the best one, if several match). Every other
-- existing pin was placed by someone in the office: MANUAL.
WITH fixes AS (
  SELECT "customerId", "completedLatitude" AS lat, "completedLongitude" AS lng,
         "completedAccuracy" AS acc, "signedAt" AS at
  FROM "DeliveryOrder"
  WHERE "customerId" IS NOT NULL AND "completedLatitude" IS NOT NULL AND "completedAccuracy" IS NOT NULL
  UNION ALL
  SELECT "customerId", "completedLatitude", "completedLongitude", "completedAccuracy", "signedAt"
  FROM "RouteStop"
  WHERE "customerId" IS NOT NULL AND "completedLatitude" IS NOT NULL AND "completedAccuracy" IS NOT NULL
),
best AS (
  SELECT DISTINCT ON ("customerId", lat, lng) "customerId", lat, lng, acc, at
  FROM fixes
  ORDER BY "customerId", lat, lng, acc ASC, at ASC
)
UPDATE "Customer" c
SET "pinSource" = 'GPS', "pinAccuracy" = b.acc, "pinSetAt" = b.at
FROM best b
WHERE b."customerId" = c."id" AND b.lat = c."latitude" AND b.lng = c."longitude";

WITH fixes AS (
  SELECT "customerId", "completedLatitude" AS lat, "completedLongitude" AS lng,
         "completedAccuracy" AS acc, "signedAt" AS at
  FROM "DeliveryOrder"
  WHERE "customerId" IS NOT NULL AND "completedLatitude" IS NOT NULL AND "completedAccuracy" IS NOT NULL
  UNION ALL
  SELECT "customerId", "completedLatitude", "completedLongitude", "completedAccuracy", "signedAt"
  FROM "RouteStop"
  WHERE "customerId" IS NOT NULL AND "completedLatitude" IS NOT NULL AND "completedAccuracy" IS NOT NULL
),
best AS (
  SELECT DISTINCT ON ("customerId", lat, lng) "customerId", lat, lng, acc, at
  FROM fixes
  ORDER BY "customerId", lat, lng, acc ASC, at ASC
)
UPDATE "CustomerAddress" a
SET "pinSource" = 'GPS', "pinAccuracy" = b.acc, "pinSetAt" = b.at
FROM best b
WHERE b."customerId" = a."customerId" AND b.lat = a."latitude" AND b.lng = a."longitude";

UPDATE "Customer" SET "pinSource" = 'MANUAL'
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "pinSource" IS NULL;

UPDATE "CustomerAddress" SET "pinSource" = 'MANUAL'
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "pinSource" IS NULL;
