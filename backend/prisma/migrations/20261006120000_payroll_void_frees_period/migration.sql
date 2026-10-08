-- A voided payroll run no longer blocks re-running its period: the unique
-- key now includes activeSlot, which is true for live runs and NULL for
-- voided ones (NULLs never collide in a Postgres unique index).
ALTER TABLE "Payroll" ADD COLUMN "activeSlot" BOOLEAN DEFAULT true;

UPDATE "Payroll" SET "activeSlot" = NULL WHERE "status" = 'VOID';

DROP INDEX "Payroll_organizationId_periodYear_periodMonth_payType_key";

CREATE UNIQUE INDEX "Payroll_organizationId_periodYear_periodMonth_payType_activ_key" ON "Payroll"("organizationId", "periodYear", "periodMonth", "payType", "activeSlot");
