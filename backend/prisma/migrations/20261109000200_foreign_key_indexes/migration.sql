-- Indexes on foreign keys that were scanned in full on every lookup or delete — deleting one
-- invoice scanned all of InvoiceItem. IF NOT EXISTS: production already has them (created
-- CONCURRENTLY by hand on 2026-11-09 before this migration ran).
CREATE INDEX IF NOT EXISTS "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
CREATE INDEX IF NOT EXISTS "InvoiceItem_productId_idx" ON "InvoiceItem"("productId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");
CREATE INDEX IF NOT EXISTS "SupplierBill_purchaseOrderId_idx" ON "SupplierBill"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE INDEX IF NOT EXISTS "Product_brandId_idx" ON "Product"("brandId");
CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX IF NOT EXISTS "Product_preferredSupplierId_idx" ON "Product"("preferredSupplierId");
CREATE INDEX IF NOT EXISTS "Invoice_salesOrderId_idx" ON "Invoice"("salesOrderId");
CREATE INDEX IF NOT EXISTS "Invoice_quotationId_idx" ON "Invoice"("quotationId");
CREATE INDEX IF NOT EXISTS "RouteStop_customerAddressId_idx" ON "RouteStop"("customerAddressId");
CREATE INDEX IF NOT EXISTS "Customer_priceLevelId_idx" ON "Customer"("priceLevelId");
