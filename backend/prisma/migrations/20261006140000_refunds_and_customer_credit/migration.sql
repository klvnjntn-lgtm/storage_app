-- Refunds and customer credit: a payment row now has a kind (payment,
-- refund, or one leg of moving credit between invoices), and the invoice
-- activity log records refunds and credit applications.
-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND', 'CREDIT_OUT', 'CREDIT_IN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceActivityEventType" ADD VALUE 'REFUNDED';
ALTER TYPE "InvoiceActivityEventType" ADD VALUE 'CREDIT_APPLIED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
ADD COLUMN     "linkedPaymentId" TEXT;

