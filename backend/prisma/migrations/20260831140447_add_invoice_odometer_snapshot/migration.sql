-- CreateEnum
CREATE TYPE "PurchaseOrderActivityEventType" AS ENUM ('CREATED', 'EDITED', 'SENT', 'CANCELLED');

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "PurchaseOrderActivityEvent" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "poNumber" TEXT,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "PurchaseOrderActivityEventType" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrderActivityEvent_organizationId_purchaseOrderId_idx" ON "PurchaseOrderActivityEvent"("organizationId", "purchaseOrderId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderActivityEvent" ADD CONSTRAINT "PurchaseOrderActivityEvent_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderActivityEvent" ADD CONSTRAINT "PurchaseOrderActivityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderActivityEvent" ADD CONSTRAINT "PurchaseOrderActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
