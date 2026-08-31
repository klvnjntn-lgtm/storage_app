DROP INDEX IF EXISTS "Product_sku_key";
CREATE UNIQUE INDEX "Product_organizationId_sku_key" ON "Product"("organizationId", "sku");
