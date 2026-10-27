-- Formal estimates for fleet customers: validity, their PO number and
-- payment terms (the last two carry over to the invoice).
ALTER TABLE "WorkOrder" ADD COLUMN "validUntil" DATE,
ADD COLUMN "customerPoNumber" TEXT,
ADD COLUMN "paymentTerms" TEXT;
