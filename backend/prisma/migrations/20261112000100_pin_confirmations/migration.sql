-- See Customer.pinConfirmations. Existing pins start at 0: every GPS pin is
-- marked for recheck (20261112000000_pin_recheck), so its next delivery sets
-- it afresh with a count of 1.
ALTER TABLE "Customer" ADD COLUMN "pinConfirmations" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CustomerAddress" ADD COLUMN "pinConfirmations" INTEGER NOT NULL DEFAULT 0;
