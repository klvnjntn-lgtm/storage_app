-- AlterTable
-- No backfill: existing invoices with a return already recorded before this
-- column existed will read creditedAmount=0 until they get a new return (or
-- a manual one-off correction) — same "legacy data starts at the default"
-- policy already used for cutover invoices elsewhere in this schema.
ALTER TABLE "Invoice" ADD COLUMN "creditedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
