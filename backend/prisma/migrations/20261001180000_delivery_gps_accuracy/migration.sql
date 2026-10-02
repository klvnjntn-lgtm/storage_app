-- Accuracy radius (metres) of the driver's GPS fix when a delivery is
-- completed. See DeliveryOrder.completedAccuracy.
ALTER TABLE "DeliveryOrder" ADD COLUMN "completedAccuracy" DOUBLE PRECISION;
ALTER TABLE "RouteStop" ADD COLUMN "completedAccuracy" DOUBLE PRECISION;
