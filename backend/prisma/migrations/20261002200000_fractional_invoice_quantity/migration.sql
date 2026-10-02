-- Invoice lines, picking sessions, external orders and goods receipts accept
-- two-decimal quantities (e.g. 1.5 kg), matching quotations, sales orders,
-- delivery orders and Stock.
ALTER TABLE "InvoiceItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "fulfilledQuantity" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "reservedQuantity" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "SessionItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "ExternalOrderItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "GoodsReceiptItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,2);
