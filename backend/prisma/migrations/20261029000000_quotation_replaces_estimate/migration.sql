-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "workshopBoardToken" TEXT;

-- AlterTable
ALTER TABLE "SalesQuotation" ADD COLUMN     "approvalToken" TEXT,
ADD COLUMN     "approvalTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "complaint" TEXT,
ADD COLUMN     "odometer" INTEGER,
ADD COLUMN     "parentQuotationId" TEXT,
ADD COLUMN     "responseNote" TEXT,
ADD COLUMN     "vehicleId" TEXT,
ADD COLUMN     "workOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_workshopBoardToken_key" ON "Organization"("workshopBoardToken");

-- CreateIndex
CREATE UNIQUE INDEX "SalesQuotation_approvalToken_key" ON "SalesQuotation"("approvalToken");

-- CreateIndex
CREATE INDEX "SalesQuotation_workOrderId_idx" ON "SalesQuotation"("workOrderId");

-- AddForeignKey
ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_vehicleId_organizationId_fkey" FOREIGN KEY ("vehicleId", "organizationId") REFERENCES "Vehicle"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_parentQuotationId_fkey" FOREIGN KEY ("parentQuotationId") REFERENCES "SalesQuotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

