-- Weighted-average costing: every change to Product.costPrice is logged
-- with its cause, so a product's current cost can be traced back to the
-- receipts/returns/imports that produced it.
-- CreateEnum
CREATE TYPE "CostChangeSource" AS ENUM ('GOODS_RECEIPT', 'SALES_RETURN', 'SALE_REVERSAL', 'OPENING_IMPORT', 'MANUAL');

-- CreateTable
CREATE TABLE "ProductCostHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "source" "CostChangeSource" NOT NULL,
    "sourceId" TEXT,
    "previousCost" DECIMAL(12,2),
    "newCost" DECIMAL(12,2),
    "quantityBefore" DECIMAL(12,2) NOT NULL,
    "quantityIn" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unitCostIn" DECIMAL(12,2),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCostHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductCostHistory_productId_createdAt_idx" ON "ProductCostHistory"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductCostHistory_organizationId_idx" ON "ProductCostHistory"("organizationId");

-- AddForeignKey
ALTER TABLE "ProductCostHistory" ADD CONSTRAINT "ProductCostHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostHistory" ADD CONSTRAINT "ProductCostHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

