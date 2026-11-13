-- When each delivery's GPS reading was taken, so only a reading close to
-- the proof photo can move a customer's pin (PIN_FIX_WINDOW_MS).
ALTER TABLE "DeliveryOrder" ADD COLUMN "proofPhotoLocationAt" TIMESTAMP(3);
ALTER TABLE "DeliveryOrder" ADD COLUMN "completedLocationAt" TIMESTAMP(3);
ALTER TABLE "RouteStop" ADD COLUMN "proofPhotoLocationAt" TIMESTAMP(3);
ALTER TABLE "RouteStop" ADD COLUMN "completedLocationAt" TIMESTAMP(3);

-- See Customer.pinChallengerLatitude.
ALTER TABLE "Customer" ADD COLUMN "pinChallengerLatitude" DECIMAL(9,6);
ALTER TABLE "Customer" ADD COLUMN "pinChallengerLongitude" DECIMAL(9,6);
ALTER TABLE "Customer" ADD COLUMN "pinChallengerCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CustomerAddress" ADD COLUMN "pinChallengerLatitude" DECIMAL(9,6);
ALTER TABLE "CustomerAddress" ADD COLUMN "pinChallengerLongitude" DECIMAL(9,6);
ALTER TABLE "CustomerAddress" ADD COLUMN "pinChallengerCount" INTEGER NOT NULL DEFAULT 0;
