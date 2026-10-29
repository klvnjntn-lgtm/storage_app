-- The branch a purchase order is made for, picked on the PO form (branch
-- staff get their own). Existing POs keep none.
ALTER TABLE "PurchaseOrder" ADD COLUMN "branchId" TEXT;

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
