-- When and where the proof photo was taken, and the receiver name typed so
-- far — sent before the driver taps Done, so the office can see a delivery
-- that was never confirmed.
ALTER TABLE "DeliveryOrder" ADD COLUMN "proofPhotoTakenAt" TIMESTAMP(3),
ADD COLUMN "proofPhotoLatitude" DECIMAL(9,6),
ADD COLUMN "proofPhotoLongitude" DECIMAL(9,6),
ADD COLUMN "proofPhotoAccuracy" DOUBLE PRECISION,
ADD COLUMN "pendingReceivedBy" TEXT;

ALTER TABLE "RouteStop" ADD COLUMN "proofPhotoTakenAt" TIMESTAMP(3),
ADD COLUMN "proofPhotoLatitude" DECIMAL(9,6),
ADD COLUMN "proofPhotoLongitude" DECIMAL(9,6),
ADD COLUMN "proofPhotoAccuracy" DOUBLE PRECISION,
ADD COLUMN "pendingReceivedBy" TEXT;
