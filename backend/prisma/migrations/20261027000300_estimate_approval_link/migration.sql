-- A link staff can paste to the customer so they approve or decline an
-- estimate themselves; the office is notified of the answer.
ALTER TYPE "NotificationType" ADD VALUE 'WORK_ORDER_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'WORK_ORDER_DECLINED';

ALTER TABLE "WorkOrder" ADD COLUMN "approvalToken" TEXT,
ADD COLUMN "approvalTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "WorkOrder_approvalToken_key" ON "WorkOrder"("approvalToken");
