-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "startLatitude" DECIMAL(9,6),
ADD COLUMN     "startLongitude" DECIMAL(9,6),
ADD COLUMN     "plannedDepartureAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RouteStop" ADD COLUMN     "travelMetersFromPrevious" DECIMAL(10,2),
ADD COLUMN     "travelSecondsFromPrevious" INTEGER;
