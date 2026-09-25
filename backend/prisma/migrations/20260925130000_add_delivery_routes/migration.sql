-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'DRIVER';

-- AlterEnum
ALTER TYPE "ModuleKey" ADD VALUE 'DELIVERY';

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "routeDate" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "status" "RouteStatus" NOT NULL DEFAULT 'PLANNED',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "deliveryOrderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "plannedEta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Route_organizationId_idx" ON "Route"("organizationId");

-- CreateIndex
CREATE INDEX "Route_organizationId_driverId_routeDate_idx" ON "Route"("organizationId", "driverId", "routeDate");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_deliveryOrderId_key" ON "RouteStop"("deliveryOrderId");

-- CreateIndex
CREATE INDEX "RouteStop_routeId_idx" ON "RouteStop"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_routeId_sequence_key" ON "RouteStop"("routeId", "sequence");

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
