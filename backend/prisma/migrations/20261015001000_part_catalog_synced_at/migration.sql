-- AlterTable
ALTER TABLE "PartCatalogEntry" ADD COLUMN     "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "PartCatalogEntry_syncedAt_idx" ON "PartCatalogEntry"("syncedAt");
