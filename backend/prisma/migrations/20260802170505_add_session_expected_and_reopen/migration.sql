-- CreateTable
CREATE TABLE "SessionReopenEvent" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionReopenEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SessionReopenEvent" ADD CONSTRAINT "SessionReopenEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
