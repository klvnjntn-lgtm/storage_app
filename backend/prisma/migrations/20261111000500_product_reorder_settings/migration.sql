-- A branch's own reorder point for a product (src/reorder).
CREATE TABLE "ProductReorderSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reorderPoint" DECIMAL(12,2) NOT NULL,
    "reorderQuantity" DECIMAL(12,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReorderSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductReorderSetting_productId_branchId_key" ON "ProductReorderSetting"("productId", "branchId");
CREATE INDEX "ProductReorderSetting_organizationId_branchId_idx" ON "ProductReorderSetting"("organizationId", "branchId");

ALTER TABLE "ProductReorderSetting" ADD CONSTRAINT "ProductReorderSetting_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReorderSetting" ADD CONSTRAINT "ProductReorderSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
