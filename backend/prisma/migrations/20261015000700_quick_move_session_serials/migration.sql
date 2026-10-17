-- AlterTable
ALTER TABLE "ProductSerial" ADD COLUMN     "sessionId" TEXT;

-- AlterTable
ALTER TABLE "StockTransfer" ADD COLUMN     "quickMove" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ProductSerial_sessionId_idx" ON "ProductSerial"("sessionId");
