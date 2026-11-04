-- The stop order from before a route was first optimized, for going back to it.
ALTER TABLE "Route" ADD COLUMN "originalOrder" JSONB;
