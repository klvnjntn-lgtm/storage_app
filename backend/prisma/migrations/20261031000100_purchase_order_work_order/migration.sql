-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN "workOrderId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseOrder_workOrderId_idx" ON "PurchaseOrder"("workOrderId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
