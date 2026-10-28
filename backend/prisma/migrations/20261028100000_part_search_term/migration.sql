-- CreateTable
CREATE TABLE "PartSearchTerm" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "carBrand" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "generation" TEXT NOT NULL DEFAULT '',
    "itemType" TEXT NOT NULL DEFAULT '',
    "item" TEXT NOT NULL DEFAULT '',
    "term" TEXT NOT NULL,
    "termNormalized" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartSearchTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartSearchTerm_kind_idx" ON "PartSearchTerm"("kind");
