-- AlterTable
ALTER TABLE "PartCatalogEntry" ADD COLUMN     "scraperId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PartCatalogEntry_scraperId_key" ON "PartCatalogEntry"("scraperId");
