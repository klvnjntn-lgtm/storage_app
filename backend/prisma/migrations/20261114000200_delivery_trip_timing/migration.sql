-- Per-business trip timing: a multiplier on road-data travel times and the
-- minutes spent at each stop (was a flat 5, hard-coded).
ALTER TABLE "Organization" ADD COLUMN "deliveryTravelTimeFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN "deliveryStopMinutes" INTEGER NOT NULL DEFAULT 5;
