-- Expense payments can be voided (journal entry reversed) instead of needing a manual adjusting entry.
ALTER TABLE "ExpensePayment" ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedById" TEXT,
ADD COLUMN "voidReason" TEXT;
