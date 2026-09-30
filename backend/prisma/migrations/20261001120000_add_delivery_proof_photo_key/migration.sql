-- Private delivery-proof photo storage key (see DeliveryOrder.proofPhotoKey).
ALTER TABLE "DeliveryOrder" ADD COLUMN "proofPhotoKey" TEXT;
