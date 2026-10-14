-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('INVOICE', 'PURCHASE_ORDER', 'STATEMENT', 'PAYMENT_REMINDER');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "WaLedgerKind" AS ENUM ('TOPUP', 'MESSAGE', 'REFUND', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "reminderEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reminderWhatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "waLowBalanceNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "documentId" TEXT,
    "recipient" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "error" TEXT,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "reminderKey" TEXT,
    "attachmentKey" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaLedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "WaLedgerKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "messageLogId" TEXT,
    "billingPaymentId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageLog_organizationId_createdAt_idx" ON "MessageLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_documentId_idx" ON "MessageLog"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_organizationId_reminderKey_key" ON "MessageLog"("organizationId", "reminderKey");

-- CreateIndex
CREATE INDEX "WaLedgerEntry_organizationId_createdAt_idx" ON "WaLedgerEntry"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaLedgerEntry" ADD CONSTRAINT "WaLedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
