// scripts/estimates-to-quotations.ts
//
// Run once per install with: npx ts-node -r tsconfig-paths/register src/scripts/estimates-to-quotations.ts
// (add --dry-run to only list what it would convert).
//
// Work order estimates (status ESTIMATE) are sales quotations now. For each one still waiting, this makes
// the quotation it would be today — same customer, car, odometer, complaint, PO number, validity and
// lines, priced by the same code a new quotation uses — sends it (so it gets its number) and moves the
// customer's approval link over, so a link already sent on WhatsApp opens the quotation. The old estimate
// is then cancelled with a note naming its quotation, rather than deleted, so nothing is lost.
//
// Safe to run more than once: only ESTIMATE work orders are touched, and each becomes CANCELLED.
// Once every install has run it, the ESTIMATE value can be dropped from WorkOrderStatus.

import { NestFactory } from '@nestjs/core';
import { WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesQuotationModule } from '../sales-quotation/sales-quotation.module';
import { SalesQuotationService } from '../sales-quotation/sales-quotation.service';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(SalesQuotationModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const quotations = app.get(SalesQuotationService);

  const estimates = await prisma.workOrder.findMany({
    where: { status: WorkOrderStatus.ESTIMATE },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${estimates.length} estimate(s) to convert${dryRun ? ' (dry run)' : ''}`);

  let converted = 0;
  for (const wo of estimates) {
    // Filed under whoever made the estimate, else the org's owner.
    const userId =
      wo.createdById ??
      (await prisma.user.findFirst({ where: { organizationId: wo.organizationId, role: 'MASTER' }, select: { id: true } }))
        ?.id;
    if (!userId) {
      console.warn(`  ${wo.number}: no member to file it under — skipped`);
      continue;
    }
    if (dryRun) {
      console.log(`  ${wo.number}: ${wo.items.length} line(s)`);
      continue;
    }
    try {
      const firstPart = wo.items.find((i) => i.productId && i.locationId);
      const quotation = await quotations.create(wo.organizationId, userId, {
        format: 'A4',
        branchId: wo.branchId ?? undefined,
        locationId: firstPart?.locationId ?? undefined,
        customerId: wo.customerId,
        vehicleId: wo.vehicleId,
        odometer: wo.odometer,
        complaint: wo.complaint,
        customerPoNumber: wo.customerPoNumber ?? undefined,
        validUntil: wo.validUntil ? wo.validUntil.toISOString().slice(0, 10) : undefined,
        termsAndConditions: wo.paymentTerms ?? undefined,
        items: wo.items.map((i) => ({
          ...(i.productId
            ? { productId: i.productId, locationId: i.locationId ?? undefined }
            : { description: i.description ?? '-' }),
          quantity: Number(i.quantity),
          ...(i.unitPrice != null ? { unitPrice: Number(i.unitPrice) } : {}),
        })),
      } as never);
      // An estimate with no lines yet stays a draft (it can't be sent empty); otherwise it's sent, and a
      // failed send takes its draft back out rather than leaving it behind.
      let quotationNumber: string | null = null;
      if (wo.items.length > 0) {
        try {
          quotationNumber = (await quotations.send(wo.organizationId, quotation.id, userId)).quotationNumber;
        } catch (err) {
          await quotations.discardDraft(wo.organizationId, quotation.id, userId);
          throw err;
        }
      }
      const label = quotationNumber ?? 'a draft quotation';
      await prisma.$transaction([
        // The token is unique: off the work order first, then onto the quotation.
        prisma.workOrder.update({
          where: { id: wo.id },
          data: {
            status: WorkOrderStatus.CANCELLED,
            approvalToken: null,
            approvalTokenExpiresAt: null,
            approvalNote: `Moved to ${quotationNumber ? `quotation ${quotationNumber}` : label}`,
          },
        }),
        prisma.salesQuotation.update({
          where: { id: quotation.id },
          data: { approvalToken: wo.approvalToken, approvalTokenExpiresAt: wo.approvalTokenExpiresAt },
        }),
      ]);
      converted++;
      console.log(`  ${wo.number} → ${label}`);
    } catch (err) {
      console.warn(`  ${wo.number}: ${(err as Error).message} — left as it was`);
    }
  }
  console.log(`Converted ${converted} of ${estimates.length}.`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
