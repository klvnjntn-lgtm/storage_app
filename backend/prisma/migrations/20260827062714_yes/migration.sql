-- CreateEnum
CREATE TYPE "SalesQuotationActivityEventType" AS ENUM ('CREATED', 'EDITED', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'CONVERTED', 'DISCARDED');

-- CreateTable
CREATE TABLE "SalesQuotationActivityEvent" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "SalesQuotationActivityEventType" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesQuotationActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesQuotationActivityEvent_quotationId_idx" ON "SalesQuotationActivityEvent"("quotationId");

-- CreateIndex
CREATE INDEX "SalesQuotationActivityEvent_organizationId_createdAt_idx" ON "SalesQuotationActivityEvent"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "SalesQuotationActivityEvent" ADD CONSTRAINT "SalesQuotationActivityEvent_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "SalesQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotationActivityEvent" ADD CONSTRAINT "SalesQuotationActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotationActivityEvent" ADD CONSTRAINT "SalesQuotationActivityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
