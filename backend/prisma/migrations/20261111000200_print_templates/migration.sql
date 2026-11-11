-- Free-form print designs per branch (Settings → Print designs).
CREATE TYPE "PrintDocType" AS ENUM ('INVOICE', 'QUOTATION', 'WORK_ORDER');

CREATE TABLE "PrintTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "docType" "PrintDocType" NOT NULL,
    "name" TEXT NOT NULL,
    "paperSize" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrintTemplate_organizationId_branchId_docType_idx" ON "PrintTemplate"("organizationId", "branchId", "docType");

-- At most one default per branch, document type and paper size.
CREATE UNIQUE INDEX "PrintTemplate_one_default" ON "PrintTemplate"("branchId", "docType", "paperSize") WHERE "isDefault";

ALTER TABLE "PrintTemplate" ADD CONSTRAINT "PrintTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrintTemplate" ADD CONSTRAINT "PrintTemplate_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
