-- CreateTable
CREATE TABLE "PartCatalogEntry" (
    "id" SERIAL NOT NULL,
    "carBrand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generation" TEXT NOT NULL DEFAULT '',
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "itemType" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "oemNumber" TEXT NOT NULL DEFAULT '',
    "oemNormalized" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL,
    "partBrand" TEXT NOT NULL DEFAULT '',
    "listingsSeen" INTEGER NOT NULL DEFAULT 0,
    "sources" TEXT NOT NULL DEFAULT '',
    "exampleUrl" TEXT NOT NULL DEFAULT '',
    "lastSeen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartCatalogEntry_carBrand_model_idx" ON "PartCatalogEntry"("carBrand", "model");

-- CreateIndex
CREATE INDEX "PartCatalogEntry_itemType_item_idx" ON "PartCatalogEntry"("itemType", "item");

-- CreateIndex
CREATE INDEX "PartCatalogEntry_oemNormalized_idx" ON "PartCatalogEntry"("oemNormalized");
