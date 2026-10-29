-- Issued invoices that never were "backordered":
-- 1. Imported from Accurate (issued without WareSys's issue step, which always logs an ISSUED event) and
--    not tied to a sales order or a delivery order — history whose goods were handed over in Accurate.
-- 2. Any issued invoice with no product lines — nothing to deliver.
UPDATE "Invoice" i
SET "fulfillmentStatus" = 'FULFILLED'
WHERE i."status" = 'ISSUED'
  AND i."fulfillmentStatus" <> 'FULFILLED'
  AND (
    (
      i."fulfillmentPath" IS NULL
      AND i."salesOrderId" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "InvoiceEditEvent" e WHERE e."invoiceId" = i."id" AND e."eventType" = 'ISSUED')
      AND NOT EXISTS (SELECT 1 FROM "DeliveryOrder" d WHERE d."invoiceId" = i."id")
    )
    OR NOT EXISTS (SELECT 1 FROM "InvoiceItem" it WHERE it."invoiceId" = i."id" AND it."productId" IS NOT NULL)
  );
