-- AlterTable
ALTER TABLE "PartCatalogEntry" ADD COLUMN     "sellers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "spec" TEXT NOT NULL DEFAULT '';
