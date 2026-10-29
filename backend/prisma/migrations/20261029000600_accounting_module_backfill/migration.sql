-- Accounting used to come with INVOICE_POS. Every org that has INVOICE_POS
-- keeps it on the same terms (enabled, expiry, paid-until), so nobody loses
-- the books when the module is split out.
INSERT INTO "OrganizationModule" ("id", "organizationId", "module", "enabled", "activatedAt", "expiresAt", "paidUntil")
SELECT gen_random_uuid()::text, m."organizationId", 'ACCOUNTING', m."enabled", m."activatedAt", m."expiresAt", m."paidUntil"
FROM "OrganizationModule" m
WHERE m."module" = 'INVOICE_POS'
ON CONFLICT ("organizationId", "module") DO NOTHING;
