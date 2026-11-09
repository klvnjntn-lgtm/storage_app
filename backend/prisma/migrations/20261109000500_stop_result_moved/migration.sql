-- A delivery result moved from the stop it was recorded on to the right one
-- (DeliveryRoutesService.moveStopResult).
ALTER TYPE "RouteHistoryEventType" ADD VALUE 'STOP_RESULT_MOVED';
