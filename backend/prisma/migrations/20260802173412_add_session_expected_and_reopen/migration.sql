-- AddForeignKey
ALTER TABLE "SessionReopenEvent" ADD CONSTRAINT "SessionReopenEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
