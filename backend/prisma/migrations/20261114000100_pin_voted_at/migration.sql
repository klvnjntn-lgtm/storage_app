-- When a delivery last counted toward a pin, so several delivery orders
-- dropped in one visit count as one confirmation or vote (PIN_VISIT_GAP_MS).
-- Existing pins start with none: their next delivery counts as usual.
ALTER TABLE "Customer" ADD COLUMN "pinVotedAt" TIMESTAMP(3);
ALTER TABLE "CustomerAddress" ADD COLUMN "pinVotedAt" TIMESTAMP(3);
