-- Photo taken at a failed delivery attempt, kept apart from the proof photo.
ALTER TABLE "DeliveryOrder" ADD COLUMN "failurePhotoKey" TEXT;
ALTER TABLE "RouteStop" ADD COLUMN "failurePhotoKey" TEXT;
