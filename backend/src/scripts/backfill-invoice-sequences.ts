// scripts/backfill-invoice-sequences.ts
//
// Run once with: npx ts-node scripts/backfill-invoice-sequences.ts
//
// Seeds DocumentSequence.INVOICE for every organization that has invoices
// with a detectable "PREFIX + trailing number" format but no sequence row
// yet — i.e. orgs that were imported BEFORE the DocumentSequence feature
// shipped, so the seeding logic inside importInvoices() never ran for them.
//
// Safe to run multiple times: only creates a row when none exists, and
// only advances lastNumber forward (never backward) via the same
// compare-and-swap pattern used in the importer itself.
//
// Now imports detectInvoiceNumberFormat from the shared util instead of
// keeping its own copy — the two-copies-drift-apart bug that produced the
// ATL-/ATL- vs ATL - mismatch is exactly why this was consolidated.

import { PrismaClient, DocumentType } from '@prisma/client';
import { detectInvoiceNumberFormat } from '../shared/documents/invoice-number-format.util';

const prisma = new PrismaClient();

async function backfillInvoiceSequences() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Checking ${orgs.length} organization(s)...`);

  for (const org of orgs) {
    const invoices = await prisma.invoice.findMany({
      where: { organizationId: org.id, invoiceNumber: { not: null } },
      select: { invoiceNumber: true },
    });

    if (invoices.length === 0) continue;

    const detected = detectInvoiceNumberFormat(invoices.map((i) => i.invoiceNumber));
    if (!detected) {
      console.log(`  [${org.name}] no detectable prefix+number format — skipping`);
      continue;
    }

    const existing = await prisma.documentSequence.findUnique({
      where: { organizationId_documentType: { organizationId: org.id, documentType: DocumentType.INVOICE } },
    });

    if (!existing) {
      await prisma.documentSequence.create({
        data: {
          organizationId: org.id,
          documentType: DocumentType.INVOICE,
          prefix: detected.prefix,
          lastNumber: detected.lastNumber,
        },
      });
      console.log(`  [${org.name}] CREATED sequence: prefix="${detected.prefix}" lastNumber=${detected.lastNumber}`);
    } else if (detected.lastNumber > existing.lastNumber) {
      await prisma.documentSequence.updateMany({
        where: { id: existing.id, lastNumber: { lt: detected.lastNumber } },
        data: { lastNumber: detected.lastNumber, prefix: detected.prefix },
      });
      console.log(
        `  [${org.name}] ADVANCED sequence: ${existing.lastNumber} -> ${detected.lastNumber} (prefix="${detected.prefix}")`,
      );
    } else {
      console.log(`  [${org.name}] already up to date (lastNumber=${existing.lastNumber})`);
    }
  }

  console.log('Done.');
}

backfillInvoiceSequences()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });