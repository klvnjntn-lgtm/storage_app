-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InvoiceItemTax" (
    "id" TEXT NOT NULL,
    "invoiceItemId" INTEGER NOT NULL,
    "taxRateId" TEXT,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "InvoiceItemTax_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceItemTax_invoiceItemId_idx" ON "InvoiceItemTax"("invoiceItemId");

-- AddForeignKey
ALTER TABLE "InvoiceItemTax" ADD CONSTRAINT "InvoiceItemTax_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItemTax" ADD CONSTRAINT "InvoiceItemTax_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "OrganizationTaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
