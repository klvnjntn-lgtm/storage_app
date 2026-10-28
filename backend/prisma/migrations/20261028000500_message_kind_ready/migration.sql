-- "Your car is ready" messages. On its own: Postgres can't use a new enum
-- value in the transaction that adds it.
ALTER TYPE "MessageKind" ADD VALUE 'WORK_ORDER_READY';
