-- Delivery DMS fixes:
--  * RouteStop no longer 1:1 with DeliveryOrder — a rescheduled DO keeps its
--    failed stop on the original route (supersededAt) and gets a new live
--    stop elsewhere. "At most one LIVE stop per DO" moves from a unique index
--    on deliveryOrderId to one on activeDeliveryOrderId (NULL once superseded).
--  * atRiskNotifiedAt: one DELIVERY_AT_RISK alert per stop.
--  * New RouteHistoryEventType values for status changes and reschedules.
--  * DeliveryOrderItem.returnedQuantity gets the same Decimal(12,2) as quantity.

-- AlterEnum (PostgreSQL 12+ allows several ADD VALUEs in one migration)
ALTER TYPE "RouteHistoryEventType" ADD VALUE 'STATUS_CHANGED';
ALTER TYPE "RouteHistoryEventType" ADD VALUE 'STOP_RESCHEDULED';

-- AlterTable
ALTER TABLE "DeliveryOrderItem" ALTER COLUMN "returnedQuantity" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "RouteStop" ADD COLUMN     "activeDeliveryOrderId" TEXT,
ADD COLUMN     "atRiskNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- Backfill: every existing stop was live (the old unique index guaranteed
-- at most one per DO), so each one becomes that DO's active stop.
UPDATE "RouteStop" SET "activeDeliveryOrderId" = "deliveryOrderId";

-- DropIndex
DROP INDEX "RouteStop_deliveryOrderId_key";

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_activeDeliveryOrderId_key" ON "RouteStop"("activeDeliveryOrderId");

-- CreateIndex
CREATE INDEX "RouteStop_deliveryOrderId_idx" ON "RouteStop"("deliveryOrderId");

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_activeDeliveryOrderId_fkey" FOREIGN KEY ("activeDeliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
