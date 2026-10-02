-- Voided payments are kept (soft void) instead of deleted.
ALTER TABLE "Payment" ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedById" TEXT,
ADD COLUMN "voidReason" TEXT;
