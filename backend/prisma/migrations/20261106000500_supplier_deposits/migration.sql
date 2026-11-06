-- Supplier down payments (uang muka pembelian): paid before there's anything
-- owed, held as an asset until set against a purchase order.
ALTER TYPE "SystemAccountKey" ADD VALUE 'SUPPLIER_ADVANCES';
ALTER TYPE "JournalSourceType" ADD VALUE 'SUPPLIER_DEPOSIT';

CREATE TABLE "SupplierDeposit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "supplierId" TEXT NOT NULL,
    "depositNumber" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "appliedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "method" "PaymentMethod" NOT NULL DEFAULT 'TRANSFER',
    "bankAccountId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    CONSTRAINT "SupplierDeposit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierDeposit_organizationId_depositNumber_key" ON "SupplierDeposit"("organizationId", "depositNumber");
CREATE INDEX "SupplierDeposit_organizationId_supplierId_idx" ON "SupplierDeposit"("organizationId", "supplierId");
CREATE INDEX "SupplierDeposit_organizationId_date_idx" ON "SupplierDeposit"("organizationId", "date");
ALTER TABLE "SupplierDeposit" ADD CONSTRAINT "SupplierDeposit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierDeposit" ADD CONSTRAINT "SupplierDeposit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierDeposit" ADD CONSTRAINT "SupplierDeposit_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierDeposit" ADD CONSTRAINT "SupplierDeposit_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierPayment" ADD COLUMN "supplierDepositId" TEXT;
CREATE INDEX "SupplierPayment_supplierDepositId_idx" ON "SupplierPayment"("supplierDepositId");
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierDepositId_fkey" FOREIGN KEY ("supplierDepositId") REFERENCES "SupplierDeposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
