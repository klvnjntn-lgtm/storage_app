-- A pending stop well past its ETA (or past the customer's window) is
-- "late", distinct from "at risk" (still on time, but its ETA lands after
-- the window). Each gets its own one-time notification.
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_LATE';
ALTER TABLE "RouteStop" ADD COLUMN "lateNotifiedAt" TIMESTAMP(3);
