-- Accurate source keys so a GDB re-import updates the rows it created
-- instead of duplicating them.
ALTER TABLE "Employee" ADD COLUMN "externalId" TEXT;
ALTER TABLE "SupplierBill" ADD COLUMN "externalId" TEXT;
ALTER TABLE "SupplierPayment" ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "Employee_organizationId_externalId_key" ON "Employee"("organizationId", "externalId");
CREATE UNIQUE INDEX "SupplierBill_organizationId_externalId_key" ON "SupplierBill"("organizationId", "externalId");
CREATE UNIQUE INDEX "SupplierPayment_organizationId_externalId_key" ON "SupplierPayment"("organizationId", "externalId");
