-- CreateTable
CREATE TABLE "SessionExpectedItem" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "appliedVariance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SessionExpectedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionReopenEvent" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionReopenEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionExpectedItem_sessionId_productId_key" ON "SessionExpectedItem"("sessionId", "productId");

-- AddForeignKey
ALTER TABLE "SessionExpectedItem" ADD CONSTRAINT "SessionExpectedItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExpectedItem" ADD CONSTRAINT "SessionExpectedItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionReopenEvent" ADD CONSTRAINT "SessionReopenEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
