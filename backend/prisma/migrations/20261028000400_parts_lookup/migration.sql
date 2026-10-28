-- Tokopedia asking-price range per OEM number, written by the car-parts scraper's sync.
ALTER TABLE "PartCatalogEntry" ADD COLUMN "priceLow" INTEGER;
ALTER TABLE "PartCatalogEntry" ADD COLUMN "priceMedian" INTEGER;
ALTER TABLE "PartCatalogEntry" ADD COLUMN "priceHigh" INTEGER;
ALTER TABLE "PartCatalogEntry" ADD COLUMN "pricedListings" INTEGER NOT NULL DEFAULT 0;

-- The car as the parts catalogue knows it, so a plate opens straight to its parts.
ALTER TABLE "Vehicle" ADD COLUMN "carBrand" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "carModel" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "carYear" INTEGER;
ALTER TABLE "Vehicle" ADD COLUMN "engine" TEXT;
