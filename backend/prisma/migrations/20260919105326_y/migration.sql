-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "employeeId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_organizationId_employeeId_idx" ON "Invoice"("organizationId", "employeeId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
