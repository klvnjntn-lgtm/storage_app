/*
  Warnings:

  - The `invoiceItemId` column on the `DeliveryOrderItem` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `deliveryOrderItemId` on the `InvoiceItem` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[bankAccountId]` on the table `ChartOfAccount` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[invoiceItemId]` on the table `DeliveryOrderItem` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "InvoiceItem" DROP CONSTRAINT "InvoiceItem_deliveryOrderItemId_fkey";

-- DropIndex
DROP INDEX "DeliveryOrder_invoiceId_key";

-- DropIndex
DROP INDEX "InvoiceItem_deliveryOrderItemId_key";

-- AlterTable
ALTER TABLE "ChartOfAccount" ADD COLUMN     "bankAccountId" TEXT;

-- AlterTable
ALTER TABLE "DeliveryOrderItem" DROP COLUMN "invoiceItemId",
ADD COLUMN     "invoiceItemId" INTEGER;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "bankAccountId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItem" DROP COLUMN "deliveryOrderItemId";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "bankAccountId" TEXT;

-- AlterTable
ALTER TABLE "Payroll" ADD COLUMN     "bankAccountId" TEXT;

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "bankAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccount_bankAccountId_key" ON "ChartOfAccount"("bankAccountId");

-- CreateIndex
CREATE INDEX "DeliveryOrder_invoiceId_idx" ON "DeliveryOrder"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrderItem_invoiceItemId_key" ON "DeliveryOrderItem"("invoiceItemId");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrderItem" ADD CONSTRAINT "DeliveryOrderItem_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartOfAccount" ADD CONSTRAINT "ChartOfAccount_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "OrganizationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
