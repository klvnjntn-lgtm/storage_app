-- Landmark photos filled in from a driver's proof photo: which delivery
-- (stop or delivery order id) it came from.
ALTER TABLE "CustomerLocationPhoto" ADD COLUMN "fromProofOf" TEXT;
