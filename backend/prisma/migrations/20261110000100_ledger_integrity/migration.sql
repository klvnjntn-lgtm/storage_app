-- Recost only the units that were sold at a provisional cost.
ALTER TABLE "InvoiceItem" ADD COLUMN "provisionalQuantity" DECIMAL(12,2);

-- The day a payment's money actually moved.
ALTER TABLE "Payment" ADD COLUMN "paymentDate" DATE;

-- Branches of one company share its NPWP; a repeat is confirmed, not refused.
DROP INDEX "Customer_organizationId_npwp_key";
CREATE INDEX "Customer_organizationId_npwp_idx" ON "Customer"("organizationId", "npwp");

-- Replayed writes (Idempotency-Key header).
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "statusCode" INTEGER,
    "response" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdempotencyRecord_userId_key_key" ON "IdempotencyRecord"("userId", "key");
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");
