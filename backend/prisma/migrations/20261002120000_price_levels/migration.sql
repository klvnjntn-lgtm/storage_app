-- Organization-wide price levels (Retail, Wholesale, Member …) with a
-- per-product price for each, a default level per customer, and the
-- source level recorded on every quotation/order/invoice line. See the
-- PriceLevel model comment in schema.prisma.
--
-- The default level's price stays in Product.sellingPrice, so existing
-- products, imports and reports are unaffected; ProductPrice only holds
-- prices for the other levels.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "priceLevelId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "priceLevelOverrideRequiresAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SalesQuotationItem" ADD COLUMN     "priceLevelId" TEXT;

-- AlterTable
ALTER TABLE "SalesOrderItem" ADD COLUMN     "priceLevelId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "priceLevelId" TEXT;

-- CreateTable
CREATE TABLE "PriceLevel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPrice" (
    "productId" TEXT NOT NULL,
    "priceLevelId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("productId","priceLevelId")
);

-- CreateIndex
CREATE INDEX "PriceLevel_organizationId_idx" ON "PriceLevel"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceLevel_organizationId_name_key" ON "PriceLevel"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ProductPrice_priceLevelId_idx" ON "ProductPrice"("priceLevelId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_priceLevelId_fkey" FOREIGN KEY ("priceLevelId") REFERENCES "PriceLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotationItem" ADD CONSTRAINT "SalesQuotationItem_priceLevelId_fkey" FOREIGN KEY ("priceLevelId") REFERENCES "PriceLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_priceLevelId_fkey" FOREIGN KEY ("priceLevelId") REFERENCES "PriceLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_priceLevelId_fkey" FOREIGN KEY ("priceLevelId") REFERENCES "PriceLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceLevel" ADD CONSTRAINT "PriceLevel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_priceLevelId_fkey" FOREIGN KEY ("priceLevelId") REFERENCES "PriceLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Backfill: every existing org gets one default level ───────────────
-- Its product prices are the existing Product.sellingPrice values, so
-- nothing about current pricing changes. Rename it in Settings.
INSERT INTO "PriceLevel" ("id", "organizationId", "name", "isDefault", "sortOrder", "createdAt")
SELECT 'mig' || md5(random()::text || o."id"), o."id", 'Retail', true, 0, CURRENT_TIMESTAMP
FROM "Organization" o;
