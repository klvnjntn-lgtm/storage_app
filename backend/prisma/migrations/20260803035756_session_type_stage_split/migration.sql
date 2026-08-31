-- 1. Create the new enum
CREATE TYPE "SessionType" AS ENUM ('RECEIVE', 'RETURNS', 'MOVE', 'ADJUSTMENT', 'FULFILLMENT');

-- 2. Add a temporary text column to hold the converted value
ALTER TABLE "Session" ADD COLUMN "type_new" "SessionType";

-- 3. Backfill: map old EventType values to new SessionType values
UPDATE "Session" SET "type_new" = 
  CASE "type"::text
    WHEN 'PICK' THEN 'FULFILLMENT'
    WHEN 'PACK' THEN 'FULFILLMENT'
    WHEN 'SHIP' THEN 'FULFILLMENT'
    WHEN 'RECEIVE' THEN 'RECEIVE'
    WHEN 'RETURNS' THEN 'RETURNS'
    WHEN 'MOVE' THEN 'MOVE'
    WHEN 'ADJUSTMENT' THEN 'ADJUSTMENT'
    ELSE NULL
  END::"SessionType";

-- 4. Add the stage column (nullable EventType), and backfill it
--    for any session that became FULFILLMENT — set stage to the
--    old type, since that's literally which stage it was at.
ALTER TABLE "Session" ADD COLUMN "stage" "EventType";

UPDATE "Session" SET "stage" = "type"::text::"EventType"
  WHERE "type"::text IN ('PICK', 'PACK', 'SHIP');

-- 5. Drop the old column, rename the new one into place
ALTER TABLE "Session" DROP COLUMN "type";
ALTER TABLE "Session" RENAME COLUMN "type_new" TO "type";

-- 6. Make it required again now that it's backfilled
ALTER TABLE "Session" ALTER COLUMN "type" SET NOT NULL;