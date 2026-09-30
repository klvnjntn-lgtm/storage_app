-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "returnInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "importBatchId" TEXT;

-- CreateTable
CREATE TABLE "StockImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockImportBatch_organizationId_createdAt_idx" ON "StockImportBatch"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Session_returnInvoiceId_idx" ON "Session"("returnInvoiceId");

-- CreateIndex
CREATE INDEX "Session_importBatchId_idx" ON "Session"("importBatchId");

-- CreateIndex
CREATE INDEX "Event_importBatchId_idx" ON "Event"("importBatchId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "StockImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_returnInvoiceId_fkey" FOREIGN KEY ("returnInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "StockImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockImportBatch" ADD CONSTRAINT "StockImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: warehouse-session picks never recorded InvoiceItem.fulfilledQuantity,
-- so SESSION-path invoices stayed UNFULFILLED and had nothing a linked return
-- could be counted against. Allocate each invoice's picked quantity per
-- product across its lines in line order (same FIFO rule the code now uses).
WITH picked AS (
    SELECT s."invoiceId", e."productId", -SUM(e."quantity") AS picked
    FROM "Event" e
    JOIN "Session" s ON s."id" = e."sessionId"
    WHERE e."type" = 'PICK' AND s."type" = 'FULFILLMENT' AND s."invoiceId" IS NOT NULL
    GROUP BY s."invoiceId", e."productId"
),
alloc AS (
    SELECT ii."id",
           LEAST(
               ii."quantity",
               GREATEST(0, p."picked" - (SUM(ii."quantity") OVER (PARTITION BY ii."invoiceId", ii."productId" ORDER BY ii."id") - ii."quantity"))
           ) AS fulfilled
    FROM "InvoiceItem" ii
    JOIN picked p ON p."invoiceId" = ii."invoiceId" AND p."productId" = ii."productId"
    JOIN "Invoice" i ON i."id" = ii."invoiceId"
    WHERE i."fulfillmentPath" = 'SESSION'
)
UPDATE "InvoiceItem" ii
SET "fulfilledQuantity" = a.fulfilled::int
FROM alloc a
WHERE a."id" = ii."id" AND ii."fulfilledQuantity" = 0;

UPDATE "Invoice" i
SET "fulfillmentStatus" = (CASE
    WHEN t.total = 0 OR t.done >= t.total THEN 'FULFILLED'
    WHEN t.done > 0 THEN 'PARTIALLY_FULFILLED'
    ELSE 'UNFULFILLED'
END)::"FulfillmentStatus"
FROM (
    SELECT "invoiceId", SUM("quantity") AS total, SUM("fulfilledQuantity") AS done
    FROM "InvoiceItem"
    WHERE "productId" IS NOT NULL
    GROUP BY "invoiceId"
) t
WHERE t."invoiceId" = i."id" AND i."fulfillmentPath" = 'SESSION';
