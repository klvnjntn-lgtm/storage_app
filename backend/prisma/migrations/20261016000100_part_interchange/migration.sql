-- CreateTable
CREATE TABLE "PartInterchange" (
    "id" SERIAL NOT NULL,
    "groupKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "oemNumber" TEXT NOT NULL,
    "oemNormalized" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartInterchange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartInterchange_oemNormalized_idx" ON "PartInterchange"("oemNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "PartInterchange_groupKey_oemNormalized_key" ON "PartInterchange"("groupKey", "oemNormalized");
