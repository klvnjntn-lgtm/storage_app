-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "quotationItemId" TEXT;

-- AlterTable
ALTER TABLE "SalesOrderItem" ADD COLUMN     "quotationItemId" TEXT;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_quotationItemId_fkey" FOREIGN KEY ("quotationItemId") REFERENCES "SalesQuotationItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_quotationItemId_fkey" FOREIGN KEY ("quotationItemId") REFERENCES "SalesQuotationItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateIndex
CREATE INDEX "SalesOrderItem_quotationItemId_idx" ON "SalesOrderItem"("quotationItemId");
CREATE INDEX "InvoiceItem_quotationItemId_idx" ON "InvoiceItem"("quotationItemId");

-- Backfill: conversions made before lines were linked copied the quotation's lines one for one, so each
-- order line / direct invoice line is matched to its quotation's line with the same product (or, for a
-- service line, the same description). Ambiguous duplicates take the first match.
UPDATE "SalesOrderItem" soi
SET "quotationItemId" = m.qid
FROM (
  SELECT DISTINCT ON (soi2."id") soi2."id" AS sid, qi."id" AS qid
  FROM "SalesOrderItem" soi2
  JOIN "SalesOrder" so ON so."id" = soi2."salesOrderId"
  JOIN "SalesQuotationItem" qi ON qi."salesQuotationId" = so."quotationId"
  WHERE so."quotationId" IS NOT NULL
    AND (soi2."productId" = qi."productId"
      OR (soi2."productId" IS NULL AND qi."productId" IS NULL AND soi2."description" = qi."description"))
  ORDER BY soi2."id", qi."id"
) m
WHERE soi."id" = m.sid AND soi."quotationItemId" IS NULL;

UPDATE "InvoiceItem" ii
SET "quotationItemId" = m.qid
FROM (
  SELECT DISTINCT ON (ii2."id") ii2."id" AS iid, qi."id" AS qid
  FROM "InvoiceItem" ii2
  JOIN "Invoice" i ON i."id" = ii2."invoiceId"
  JOIN "SalesQuotationItem" qi ON qi."salesQuotationId" = i."quotationId"
  WHERE i."quotationId" IS NOT NULL AND i."salesOrderId" IS NULL
    AND (ii2."productId" = qi."productId"
      OR (ii2."productId" IS NULL AND qi."productId" IS NULL AND ii2."description" = qi."description"))
  ORDER BY ii2."id", qi."id"
) m
WHERE ii."id" = m.iid AND ii."quotationItemId" IS NULL;
