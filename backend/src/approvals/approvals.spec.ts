import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApprovalDocumentType, ApprovalStatus, PurchaseOrderStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsModule } from './approvals.module';
import { ApprovalsService } from './approvals.service';

const PO = ApprovalDocumentType.PURCHASE_ORDER;
const INVOICE = ApprovalDocumentType.INVOICE;

// The two-person rule on big POs and heavy discounts, against the
// isolated test DB (test/setup-test-env.ts).
describe('Approvals', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let approvals: ApprovalsService;
  let orgId: string;
  let adminId: string;
  let staffId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, ApprovalsModule] }).compile();
    prisma = module.get(PrismaService);
    approvals = module.get(ApprovalsService);
    orgId = (await prisma.organization.create({ data: { name: `Approvals ${randomUUID()}` } })).id;
    const user = (role: 'ADMIN' | 'USER') =>
      prisma.user.create({
        data: { email: `ap-${randomUUID()}@example.com`, password: 'x', role, organizationId: orgId },
      });
    adminId = (await user('ADMIN')).id;
    staffId = (await user('USER')).id;
    await approvals.updateSettings(orgId, { poApprovalThreshold: 10_000_000, discountApprovalPercent: 10 });
  });

  afterAll(async () => {
    await module?.close();
  });

  const po = (total: number) =>
    prisma.purchaseOrder.create({ data: { organizationId: orgId, status: PurchaseOrderStatus.DRAFT, subtotal: total, total } });

  async function invoice(gross: number, discount: number) {
    return prisma.invoice.create({
      data: {
        organizationId: orgId,
        format: 'A4',
        items: {
          create: [
            {
              description: 'Jasa',
              quantity: 1,
              unitPrice: gross,
              lineTotal: gross,
              discountAmount: discount,
              netAmount: gross - discount,
              total: gross - discount,
            },
          ],
        },
      },
    });
  }

  it('only asks for approval above the limit, and never of an admin', async () => {
    const small = await po(10_000_000);
    await approvals.assertApproved(orgId, PO, small.id, 'USER');

    const big = await po(10_000_001);
    await expect(approvals.assertApproved(orgId, PO, big.id, 'USER')).rejects.toThrow(ForbiddenException);
    await approvals.assertApproved(orgId, PO, big.id, 'ADMIN');
    await expect(approvals.request(orgId, staffId, PO, small.id)).rejects.toThrow(BadRequestException);
  });

  it('lets an approved PO through, until its total rises past what was approved', async () => {
    const order = await po(15_000_000);
    const req = await approvals.request(orgId, staffId, PO, order.id, 'Stock for Lebaran');
    expect(req.status).toBe(ApprovalStatus.PENDING);

    // Asking again for the same value returns the same request.
    expect((await approvals.request(orgId, staffId, PO, order.id)).id).toBe(req.id);

    await approvals.decide(orgId, adminId, req.id, true, 'OK');
    await approvals.assertApproved(orgId, PO, order.id, 'USER');
    await expect(approvals.decide(orgId, adminId, req.id, false)).rejects.toThrow('already been decided');

    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { total: 20_000_000 } });
    await expect(approvals.assertApproved(orgId, PO, order.id, 'USER')).rejects.toThrow(ForbiddenException);

    // Coming back down to the approved value is fine again.
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { total: 12_000_000 } });
    await approvals.assertApproved(orgId, PO, order.id, 'USER');
  });

  it('replaces a pending request when the document grows', async () => {
    const order = await po(11_000_000);
    const first = await approvals.request(orgId, staffId, PO, order.id);
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { total: 13_000_000 } });
    const second = await approvals.request(orgId, staffId, PO, order.id);
    expect(second.id).not.toBe(first.id);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(ApprovalStatus.CANCELLED);
  });

  it('measures invoice discounts as a share of the gross', async () => {
    const fine = await invoice(1_000_000, 100_000); // 10%
    expect((await approvals.requirement(orgId, INVOICE, fine.id)).required).toBe(false);

    const heavy = await invoice(1_000_000, 150_000); // 15%
    const reqmt = await approvals.requirement(orgId, INVOICE, heavy.id);
    expect(reqmt).toMatchObject({ required: true, value: 15, limit: 10 });

    const req = await approvals.request(orgId, staffId, INVOICE, heavy.id);
    await approvals.decide(orgId, adminId, req.id, false, 'Too much');
    await expect(approvals.assertApproved(orgId, INVOICE, heavy.id, 'USER')).rejects.toThrow(ForbiddenException);
  });

  it('lets only the requester cancel, and only while pending', async () => {
    const order = await po(30_000_000);
    const req = await approvals.request(orgId, staffId, PO, order.id);
    await expect(approvals.cancel(orgId, adminId, req.id)).rejects.toThrow('No pending request');
    await approvals.cancel(orgId, staffId, req.id);
    await expect(approvals.cancel(orgId, staffId, req.id)).rejects.toThrow('No pending request');
  });

  it('turns a rule off when its limit is cleared', async () => {
    await approvals.updateSettings(orgId, { poApprovalThreshold: null });
    try {
      const order = await po(999_000_000);
      await approvals.assertApproved(orgId, PO, order.id, 'USER');
    } finally {
      await approvals.updateSettings(orgId, { poApprovalThreshold: 10_000_000 });
    }
  });
});
