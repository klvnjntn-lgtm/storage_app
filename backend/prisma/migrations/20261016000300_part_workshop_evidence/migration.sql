-- CreateTable
CREATE TABLE "PartWorkshopEvidence" (
    "id" SERIAL NOT NULL,
    "carBrand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueNormalized" TEXT NOT NULL,
    "workshops" INTEGER NOT NULL,
    "installs" INTEGER NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartWorkshopEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartWorkshopEvidence_carBrand_model_idx" ON "PartWorkshopEvidence"("carBrand", "model");

-- CreateIndex
CREATE INDEX "PartWorkshopEvidence_syncedAt_idx" ON "PartWorkshopEvidence"("syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartWorkshopEvidence_carBrand_model_item_kind_valueNormalized_key" ON "PartWorkshopEvidence"("carBrand", "model", "item", "kind", "valueNormalized");
