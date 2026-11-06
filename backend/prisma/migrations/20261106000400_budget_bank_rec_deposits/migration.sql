-- Monthly budgets per account, bank statement reconciliation, and customer
-- down payments (uang muka).
ALTER TYPE "SystemAccountKey" ADD VALUE 'CUSTOMER_DEPOSITS';
ALTER TYPE "JournalSourceType" ADD VALUE 'CUSTOMER_DEPOSIT';
ALTER TYPE "PaymentKind" ADD VALUE 'DEPOSIT_IN';

CREATE TYPE "BankStatementLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

CREATE TABLE "AccountBudget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountBudget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountBudget_organizationId_accountId_year_month_scope_key" ON "AccountBudget"("organizationId", "accountId", "year", "month", "scope");
CREATE INDEX "AccountBudget_organizationId_year_scope_idx" ON "AccountBudget"("organizationId", "year", "scope");
ALTER TABLE "AccountBudget" ADD CONSTRAINT "AccountBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountBudget" ADD CONSTRAINT "AccountBudget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balance" DECIMAL(14,2),
    "dedupeKey" TEXT NOT NULL,
    "fileName" TEXT,
    "status" "BankStatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankStatementLine_bankAccountId_dedupeKey_key" ON "BankStatementLine"("bankAccountId", "dedupeKey");
CREATE INDEX "BankStatementLine_organizationId_bankAccountId_date_idx" ON "BankStatementLine"("organizationId", "bankAccountId", "date");
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BankReconciliationMatch" (
    "id" TEXT NOT NULL,
    "statementLineId" TEXT NOT NULL,
    "journalEntryLineId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankReconciliationMatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankReconciliationMatch_journalEntryLineId_key" ON "BankReconciliationMatch"("journalEntryLineId");
CREATE INDEX "BankReconciliationMatch_statementLineId_idx" ON "BankReconciliationMatch"("statementLineId");
ALTER TABLE "BankReconciliationMatch" ADD CONSTRAINT "BankReconciliationMatch_statementLineId_fkey" FOREIGN KEY ("statementLineId") REFERENCES "BankStatementLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankReconciliationMatch" ADD CONSTRAINT "BankReconciliationMatch_journalEntryLineId_fkey" FOREIGN KEY ("journalEntryLineId") REFERENCES "JournalEntryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CustomerDeposit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "customerId" TEXT NOT NULL,
    "depositNumber" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "appliedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "bankAccountId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    CONSTRAINT "CustomerDeposit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerDeposit_organizationId_depositNumber_key" ON "CustomerDeposit"("organizationId", "depositNumber");
CREATE INDEX "CustomerDeposit_organizationId_customerId_idx" ON "CustomerDeposit"("organizationId", "customerId");
CREATE INDEX "CustomerDeposit_organizationId_date_idx" ON "CustomerDeposit"("organizationId", "date");
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD COLUMN "customerDepositId" TEXT;
CREATE INDEX "Payment_customerDepositId_idx" ON "Payment"("customerDepositId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerDepositId_fkey" FOREIGN KEY ("customerDepositId") REFERENCES "CustomerDeposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
