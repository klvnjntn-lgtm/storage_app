-- The four accounts amortisasi posts to, for every business that already has a chart of
-- accounts (new ones get them from ChartOfAccountsSeedService). Separate from the migration
-- that adds the SystemAccountKey values, which can't be used in the transaction adding them.
-- A code the business already uses for something else gets "-AM" appended rather than failing.
INSERT INTO "ChartOfAccount" ("id", "organizationId", "code", "name", "type", "normalBalance", "systemKey", "isActive", "createdAt")
SELECT gen_random_uuid()::text,
       o.org,
       CASE WHEN EXISTS (SELECT 1 FROM "ChartOfAccount" c WHERE c."organizationId" = o.org AND c.code = v.code)
            THEN v.code || '-AM' ELSE v.code END,
       v.name,
       v.type::"AccountType",
       v.nb::"NormalBalance",
       v.key::"SystemAccountKey",
       true,
       CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "organizationId" AS org FROM "ChartOfAccount") o
CROSS JOIN (VALUES
  ('1450', 'Prepaid Expenses', 'ASSET', 'DEBIT', 'PREPAID_EXPENSES'),
  ('1600', 'Intangible Assets', 'ASSET', 'DEBIT', 'INTANGIBLE_ASSETS'),
  ('1610', 'Accumulated Amortization', 'ASSET', 'CREDIT', 'ACCUMULATED_AMORTIZATION'),
  ('5120', 'Amortization Expense', 'EXPENSE', 'DEBIT', 'AMORTIZATION_EXPENSE')
) AS v(code, name, type, nb, key)
WHERE NOT EXISTS (
  SELECT 1 FROM "ChartOfAccount" c WHERE c."organizationId" = o.org AND c."systemKey" = v.key::"SystemAccountKey"
);
