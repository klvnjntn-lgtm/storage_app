-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "sessionItemId" INTEGER;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_sessionItemId_fkey" FOREIGN KEY ("sessionItemId") REFERENCES "SessionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
