-- When and where a customer location (landmark) photo was taken.
ALTER TABLE "CustomerLocationPhoto" ADD COLUMN "takenAt" TIMESTAMP(3),
ADD COLUMN "latitude" DECIMAL(9,6),
ADD COLUMN "longitude" DECIMAL(9,6),
ADD COLUMN "accuracy" DOUBLE PRECISION;
