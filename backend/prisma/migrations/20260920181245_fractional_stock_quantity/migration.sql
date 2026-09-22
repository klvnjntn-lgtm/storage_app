-- AlterTable
-- Widening Int -> Decimal(12,2) is a lossless cast: every existing value is
-- a whole number and fits well within the new precision/scale.
ALTER TABLE "Stock" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Event" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,2);
