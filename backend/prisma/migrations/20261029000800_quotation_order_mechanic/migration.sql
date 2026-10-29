-- Workshops: the mechanic on a quotation / sales order, carried on to the
-- invoice and work order it becomes.
ALTER TABLE "SalesQuotation" ADD COLUMN "mechanicId" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "mechanicId" TEXT;

ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_mechanicId_organizationId_fkey" FOREIGN KEY ("mechanicId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_mechanicId_organizationId_fkey" FOREIGN KEY ("mechanicId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
