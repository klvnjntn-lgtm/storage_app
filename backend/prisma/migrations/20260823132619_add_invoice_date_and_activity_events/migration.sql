-- CreateEnum
CREATE TYPE "InvoiceActivityEventType" AS ENUM ('CREATED', 'ISSUED', 'EDITED', 'PAYMENT_RECORDED', 'MARKED_PAID', 'VOIDED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "invoiceDate" DATE;

-- AlterTable
ALTER TABLE "InvoiceEditEvent" ADD COLUMN     "eventType" "InvoiceActivityEventType" NOT NULL DEFAULT 'EDITED',
ALTER COLUMN "reason" DROP NOT NULL,
ALTER COLUMN "oldTotal" DROP NOT NULL,
ALTER COLUMN "newTotal" DROP NOT NULL,
ALTER COLUMN "changes" DROP NOT NULL;
