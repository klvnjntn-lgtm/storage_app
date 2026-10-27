-- Every job so far was checked straight in, i.e. approved when it was
-- created. Separate from the enum change: a new enum value can't be used in
-- the transaction that adds it, and this keeps that one schema-only.
UPDATE "WorkOrder" SET "approvedAt" = "createdAt" WHERE "approvedAt" IS NULL;
