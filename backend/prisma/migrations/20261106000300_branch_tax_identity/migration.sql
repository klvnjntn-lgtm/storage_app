-- A branch's tax identity, printed on its Laporan Pajak. Empty = the branch
-- files under the business's own NPWP. nitku identifies the location; legalName
-- and npwp are for a "branch" that is really a separate taxpayer.
ALTER TABLE "Branch" ADD COLUMN "legalName" TEXT;
ALTER TABLE "Branch" ADD COLUMN "npwp" TEXT;
ALTER TABLE "Branch" ADD COLUMN "nitku" TEXT;
