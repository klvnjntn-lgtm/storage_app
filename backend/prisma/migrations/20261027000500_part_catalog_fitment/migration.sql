-- AlterTable
ALTER TABLE "PartCatalogEntry" ADD COLUMN     "fitment" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fitmentRank" INTEGER NOT NULL DEFAULT 0;
