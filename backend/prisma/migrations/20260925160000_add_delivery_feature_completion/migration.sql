-- CreateEnum
CREATE TYPE "RouteHistoryEventType" AS ENUM ('CREATED', 'DRIVER_CHANGED', 'START_SET', 'STOP_ADDED', 'STOP_REMOVED', 'STOPS_REORDERED', 'OPTIMIZED');

-- CreateEnum
CREATE TYPE "DeliveryPriority" AS ENUM ('NORMAL', 'HIGH');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "DeliveryOrder" ADD COLUMN     "priority" "DeliveryPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "deliveryWindowStart" TIMESTAMP(3),
ADD COLUMN     "deliveryWindowEnd" TIMESTAMP(3),
ADD COLUMN     "proofPhotoUrl" TEXT,
ADD COLUMN     "rescheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteHistoryEvent" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "type" "RouteHistoryEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "RouteHistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_organizationId_name_key" ON "Team"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Team_organizationId_idx" ON "Team"("organizationId");

-- CreateIndex
CREATE INDEX "RouteHistoryEvent_routeId_createdAt_idx" ON "RouteHistoryEvent"("routeId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteHistoryEvent" ADD CONSTRAINT "RouteHistoryEvent_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteHistoryEvent" ADD CONSTRAINT "RouteHistoryEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
