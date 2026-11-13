-- See Customer.pinRecheck. Until this release the driver app saved the
-- most accurate GPS reading from the 20s before a photo, which could be a
-- spot the driver had already driven past (the road behind the customer).
-- Every GPS pin from before now may hold one, so the next delivery's fix
-- replaces it. MANUAL pins were set in the office and aren't touched.
ALTER TABLE "Customer" ADD COLUMN "pinRecheck" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerAddress" ADD COLUMN "pinRecheck" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Customer" SET "pinRecheck" = true WHERE "pinSource" = 'GPS';
UPDATE "CustomerAddress" SET "pinRecheck" = true WHERE "pinSource" = 'GPS';
