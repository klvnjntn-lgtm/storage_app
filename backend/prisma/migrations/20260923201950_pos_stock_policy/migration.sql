-- CreateEnum
CREATE TYPE "StockPolicy" AS ENUM ('BLOCK', 'WARN', 'ALLOW');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "balanceAfter" DECIMAL(12,2),
ADD COLUMN     "oversold" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "costProvisional" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "stockOverrideRequiresAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stockPolicy" "StockPolicy" NOT NULL DEFAULT 'BLOCK';

-- CreateTable
CREATE TABLE "SettingsAuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettingsAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettingsAuditLog_organizationId_field_idx" ON "SettingsAuditLog"("organizationId", "field");

-- CreateIndex
CREATE INDEX "Event_organizationId_oversold_idx" ON "Event"("organizationId", "oversold");

-- AddForeignKey
ALTER TABLE "SettingsAuditLog" ADD CONSTRAINT "SettingsAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingsAuditLog" ADD CONSTRAINT "SettingsAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
