-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "address" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "InvoiceEditEvent" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT NOT NULL,
    "oldTotal" DECIMAL(65,30) NOT NULL,
    "newTotal" DECIMAL(65,30) NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceEditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceEditEvent_invoiceId_idx" ON "InvoiceEditEvent"("invoiceId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- RenameForeignKey
ALTER TABLE "Customer" RENAME CONSTRAINT "Customer_orgId_fkey" TO "Customer_organizationId_fkey";

-- AddForeignKey

-- AddForeignKey
ALTER TABLE "InvoiceEditEvent" ADD CONSTRAINT "InvoiceEditEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEditEvent" ADD CONSTRAINT "InvoiceEditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
