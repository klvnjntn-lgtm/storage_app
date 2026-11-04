-- Supplier payments are voided (journal entry reversed) instead of deleted, so the history stays.
ALTER TABLE "SupplierPayment" ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedById" TEXT,
ADD COLUMN "voidReason" TEXT;
