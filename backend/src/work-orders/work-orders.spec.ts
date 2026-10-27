import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, WorkOrderStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { InvoiceService } from '../invoice/invoice.service';
import { WorkOrdersModule } from './work-orders.module';
import { WorkOrdersService } from './work-orders.service';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { VehiclesService } from '../vehicles/vehicles.service';
import { heldWorkOrderItemsWhere } from '../stock/work-order-holds';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Job card → draft invoice, against the isolated test DB
// (test/setup-test-env.ts) in a fresh workshop org.
describe('Workshop work orders', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let workOrders: WorkOrdersService;
  let invoices: InvoiceService;

  let orgId: string;
  let userId: string;
  let rackId: string;
  let productId: string;
  let vehicleId: string;
  let customerId: string;
  let mechanicId: string;

  const PRICE = 150_000;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, WorkOrdersModule, VehiclesModule] }).compile();
    prisma = module.get(PrismaService);
    workOrders = module.get(WorkOrdersService);
    invoices = module.get(InvoiceService);

    orgId = (await prisma.organization.create({ data: { name: `WO ${randomUUID()}`, workOrdersEnabled: true } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    for (const m of ['INVOICE_POS', 'WORKSHOP_RMS'] as const) {
      await prisma.organizationModule.create({ data: { organizationId: orgId, module: m, enabled: true } });
    }
    userId = (
      await prisma.user.create({
        data: { email: `wo-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    rackId = (await prisma.location.create({ data: { name: 'Rack', organizationId: orgId } })).id;
    const categoryId = (await prisma.category.create({ data: { name: 'Oil', organizationId: orgId } })).id;
    productId = (
      await prisma.product.create({
        data: { name: 'Engine oil 1L', sku: `OIL-${randomUUID().slice(0, 8)}`, categoryId, organizationId: orgId, sellingPrice: PRICE },
      })
    ).id;
    await prisma.stock.create({ data: { productId, locationId: rackId, organizationId: orgId, quantity: 20 } });
    customerId = (await prisma.customer.create({ data: { name: 'Budi', organizationId: orgId } })).id;
    vehicleId = (
      await prisma.vehicle.create({
        data: {
          organizationId: orgId,
          customerId,
          plateNumber: 'B 1234 XY',
          plateNormalized: 'B1234XY',
          vehicleModel: 'Avanza',
          odometer: 50_000,
        },
      })
    ).id;
    mechanicId = (await prisma.employee.create({ data: { organizationId: orgId, name: 'Andi', baseSalary: 0 } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  function newJob(odometer = 50_500) {
    return workOrders.create(orgId, userId, {
      vehicleId,
      mechanicId,
      odometer,
      complaint: 'Oil change and brake noise',
      items: [
        { productId, locationId: rackId, quantity: 4 },
        { description: 'Labour: oil change', quantity: 1, unitPrice: 50_000 },
      ],
    });
  }

  it('numbers the job, takes the customer from the vehicle and estimates the total', async () => {
    const wo = await newJob();
    expect(wo.number).toMatch(/^WO-\d{4}-\d{5}$/);
    expect(wo.customerId).toBe(customerId);
    expect(wo.status).toBe(WorkOrderStatus.QUEUED);
    expect(Number(wo.estimatedTotal)).toBe(4 * PRICE + 50_000);
    expect(wo.items.map((i) => i.sortOrder)).toEqual([0, 1]);
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(vehicle.odometer).toBe(50_500);
  });

  it('rejects an odometer reading below the vehicle’s', async () => {
    await expect(newJob(10)).rejects.toThrow(BadRequestException);
  });

  it('stamps startedAt once and completedAt on DONE', async () => {
    const wo = await newJob(51_000);
    const started = await workOrders.setStatus(orgId, wo.id, WorkOrderStatus.IN_PROGRESS);
    expect(started.startedAt).not.toBeNull();
    await workOrders.setStatus(orgId, wo.id, WorkOrderStatus.WAITING_PARTS);
    const again = await workOrders.setStatus(orgId, wo.id, WorkOrderStatus.IN_PROGRESS);
    expect(again.startedAt).toEqual(started.startedAt);
    const done = await workOrders.setStatus(orgId, wo.id, WorkOrderStatus.DONE);
    expect(done.completedAt).not.toBeNull();
  });

  it('becomes one draft invoice, and is locked until that invoice is voided', async () => {
    const wo = await newJob(52_000);
    const { invoiceId } = await workOrders.createInvoice(orgId, userId, wo.id);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true } });
    expect(invoice.status).toBe(InvoiceStatus.DRAFT);
    expect(invoice.workOrderId).toBe(wo.id);
    expect(invoice.vehicleId).toBe(vehicleId);
    expect(invoice.employeeId).toBe(mechanicId);
    expect(Number(invoice.total)).toBe(4 * PRICE + 50_000);
    expect(invoice.items).toHaveLength(2);

    const invoiced = await workOrders.getOne(orgId, wo.id);
    expect(invoiced.invoicedId).toBe(invoiceId);
    // Invoicing closes the job even if nobody moved it to Done.
    expect(invoiced.status).toBe(WorkOrderStatus.DONE);
    expect(invoiced.completedAt).not.toBeNull();
    await expect(workOrders.createInvoice(orgId, userId, wo.id)).rejects.toThrow('already been invoiced');
    await expect(workOrders.update(orgId, userId, wo.id, { notes: 'x' })).rejects.toThrow(BadRequestException);

    // A discarded draft doesn't count as an invoice any more.
    await invoices.discardDraft(orgId, invoiceId, userId);
    const reopened = await workOrders.getOne(orgId, wo.id);
    expect(reopened.invoicedId).toBeNull();
    await workOrders.update(orgId, userId, wo.id, { notes: 'Customer approved extra pads' });
  });

  it('still invoices an older job after the car came back with a higher reading', async () => {
    const wo = await newJob(60_000);
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { odometer: 61_000 } });
    const { invoiceId } = await workOrders.createInvoice(orgId, userId, wo.id);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).odometer).toBe(61_000);
    await invoices.discardDraft(orgId, invoiceId, userId);
  });

  it('can unassign the mechanic', async () => {
    const wo = await newJob(61_500);
    expect((await workOrders.update(orgId, userId, wo.id, { mechanicId: null })).mechanicId).toBeNull();
    // Put the reading back for the tests below.
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { odometer: 52_000 } });
  });

  it('refuses a cancelled job and a job with no lines', async () => {
    const empty = await workOrders.create(orgId, userId, { vehicleId });
    await expect(workOrders.createInvoice(orgId, userId, empty.id)).rejects.toThrow('at least one');

    const wo = await newJob(53_000);
    await workOrders.setStatus(orgId, wo.id, WorkOrderStatus.CANCELLED);
    await expect(workOrders.createInvoice(orgId, userId, wo.id)).rejects.toThrow('cancelled');
    await expect(workOrders.update(orgId, userId, wo.id, { notes: 'x' })).rejects.toThrow('cancelled');
  });

  it('rejects a mechanic from another org', async () => {
    const otherOrg = (await prisma.organization.create({ data: { name: `WO other ${randomUUID()}` } })).id;
    const stranger = (await prisma.employee.create({ data: { organizationId: otherOrg, name: 'X', baseSalary: 0 } })).id;
    await expect(workOrders.create(orgId, userId, { vehicleId, mechanicId: stranger })).rejects.toThrow('Mechanic');
  });

  it('prints the job with the workshop letterhead', async () => {
    const wo = await newJob(59_000);
    const view = await workOrders.printView(orgId, wo.id);
    expect(view.workOrder.number).toBe(wo.number);
    expect(view.workOrder.items).toHaveLength(2);
    expect(view.business.name).toMatch(/^WO /);
  });

  it('finds a job by plate regardless of spacing', async () => {
    const wo = await newJob(60_000);
    const found = await workOrders.list(orgId, { q: 'b1234xy' });
    expect(found.map((w) => w.id)).toContain(wo.id);
  });

  it('keeps a typed part price only with POS pricing on', async () => {
    const line = { productId, locationId: rackId, quantity: 1, unitPrice: 99_000 };
    const off = await workOrders.create(orgId, userId, { vehicleId, items: [line] });
    expect(off.items[0].unitPrice).toBeNull();
    expect(Number(off.estimatedTotal)).toBe(PRICE);

    await prisma.organization.update({ where: { id: orgId }, data: { posPricingEnabled: true } });
    try {
      expect((await workOrders.config(orgId)).posPricingEnabled).toBe(true);
      const on = await workOrders.create(orgId, userId, { vehicleId, items: [line] });
      expect(Number(on.items[0].unitPrice)).toBe(99_000);
      expect(Number(on.estimatedTotal)).toBe(99_000);
    } finally {
      await prisma.organization.update({ where: { id: orgId }, data: { posPricingEnabled: false } });
    }
  });

  it('lets a non-admin invoice and re-save a job an admin priced', async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: { posPricingEnabled: true, priceLevelOverrideRequiresAdmin: true },
    });
    try {
      const wo = await workOrders.create(orgId, userId, {
        vehicleId,
        items: [{ productId, locationId: rackId, quantity: 1, unitPrice: 99_000 }],
      });
      const cashier = (
        await prisma.user.create({
          data: { email: `wo-c-${randomUUID()}@example.com`, password: 'x', role: 'USER', organizationId: orgId },
        })
      ).id;
      const { invoiceId } = await workOrders.createInvoice(orgId, cashier, wo.id);
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(Number(invoice.total)).toBe(99_000);

      // The editor re-sends the lines: the price already there is kept…
      const line = { productId, locationId: rackId, quantity: 2, unitPrice: 99_000 };
      const saved = await invoices.updateDraft(orgId, invoiceId, { items: [line] }, cashier);
      expect(Number(saved.total)).toBe(198_000);
      // …but a new custom price still needs an admin.
      await expect(
        invoices.updateDraft(orgId, invoiceId, { items: [{ ...line, unitPrice: 50_000 }] }, cashier),
      ).rejects.toThrow(ForbiddenException);
    } finally {
      await prisma.organization.update({
        where: { id: orgId },
        data: { posPricingEnabled: false, priceLevelOverrideRequiresAdmin: false },
      });
    }
  });

  it('blocks deleting a vehicle with work orders, but not one with only reminders', async () => {
    const vehicles = module.get(VehiclesService);
    const booked = await prisma.vehicle.create({
      data: { organizationId: orgId, customerId, plateNumber: 'B 8 Z', plateNormalized: 'B8Z', vehicleModel: 'Brio' },
    });
    await workOrders.create(orgId, userId, { vehicleId: booked.id });
    await expect(vehicles.remove(orgId, booked.id)).rejects.toThrow('work order');

    const spare = await prisma.vehicle.create({
      data: { organizationId: orgId, customerId, plateNumber: 'B 9 Z', plateNormalized: 'B9Z', vehicleModel: 'Jazz' },
    });
    await prisma.vehicleReminder.create({
      data: { organizationId: orgId, vehicleId: spare.id, note: 'Service', dueDate: new Date() },
    });
    await vehicles.remove(orgId, spare.id);
    expect(await prisma.vehicle.findUnique({ where: { id: spare.id } })).toBeNull();
  });

  it('holds its parts: other sales can’t take them, its own invoice can, cancelling frees them', async () => {
    const categoryId = (await prisma.category.create({ data: { name: `Brakes ${randomUUID()}`, organizationId: orgId } })).id;
    const pads = (
      await prisma.product.create({
        data: { name: 'Brake pads', sku: `PAD-${randomUUID().slice(0, 8)}`, categoryId, organizationId: orgId, sellingPrice: 80_000 },
      })
    ).id;
    await prisma.stock.create({ data: { productId: pads, locationId: rackId, organizationId: orgId, quantity: 3 } });
    const onHand = async () =>
      Number((await prisma.stock.findUniqueOrThrow({ where: { productId_locationId: { productId: pads, locationId: rackId } } })).quantity);
    const sell = async (quantity: number) => {
      const draft = await invoices.createDraft(orgId, userId, {
        format: 'A4',
        customerName: 'Walk-in',
        items: [{ productId: pads, locationId: rackId, quantity }],
      } as never);
      await invoices.issue(orgId, draft.id, userId, 'ADMIN');
      const item = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: draft.id } });
      return Number(item.fulfilledQuantity);
    };

    // A job holds 2 of the 3: a walk-in sale gets only the free one (BLOCK).
    const job = await workOrders.create(orgId, userId, {
      vehicleId,
      items: [{ productId: pads, locationId: rackId, quantity: 2 }],
    });
    expect(await sell(3)).toBe(1);
    expect(await onHand()).toBe(2);

    // The job's own invoice takes what it held; the hold ends once issued.
    const { invoiceId } = await workOrders.createInvoice(orgId, userId, job.id);
    await invoices.issue(orgId, invoiceId, userId, 'ADMIN');
    expect(await onHand()).toBe(0);

    // Cancelling a job releases its hold.
    await prisma.stock.update({
      where: { productId_locationId: { productId: pads, locationId: rackId } },
      data: { quantity: 1 },
    });
    const other = await workOrders.create(orgId, userId, {
      vehicleId,
      items: [{ productId: pads, locationId: rackId, quantity: 1 }],
    });
    expect(await sell(1)).toBe(0);
    await workOrders.setStatus(orgId, other.id, WorkOrderStatus.CANCELLED);
    expect(await sell(1)).toBe(1);
  });

  it('waits as an estimate until approved: no hold, no invoice, no work', async () => {
    const est = await workOrders.create(orgId, userId, {
      vehicleId,
      asEstimate: true,
      items: [{ productId, locationId: rackId, quantity: 1 }],
    });
    expect(est.status).toBe(WorkOrderStatus.ESTIMATE);
    expect(est.approvedAt).toBeNull();
    const held = await prisma.workOrderItem.count({ where: { ...heldWorkOrderItemsWhere(orgId), workOrderId: est.id } });
    expect(held).toBe(0);
    await expect(workOrders.setStatus(orgId, est.id, WorkOrderStatus.IN_PROGRESS)).rejects.toThrow('approval');
    await expect(workOrders.createInvoice(orgId, userId, est.id)).rejects.toThrow('approval');

    // The printed estimate carries today's prices.
    const print = await workOrders.printView(orgId, est.id);
    expect(print.pricing?.lines[0].unitPrice).toBe(PRICE);
    expect(print.pricing?.total).toBe(PRICE);

    // Declined, then reopened: still an estimate.
    await workOrders.setStatus(orgId, est.id, WorkOrderStatus.CANCELLED);
    expect((await workOrders.setStatus(orgId, est.id, WorkOrderStatus.QUEUED)).status).toBe(WorkOrderStatus.ESTIMATE);

    const approved = await workOrders.approve(orgId, userId, est.id, 'Signed SPK');
    expect(approved.status).toBe(WorkOrderStatus.QUEUED);
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.approvalNote).toBe('Signed SPK');
    await expect(workOrders.approve(orgId, userId, est.id)).rejects.toThrow('Only an estimate');
    await expect(workOrders.setStatus(orgId, est.id, WorkOrderStatus.ESTIMATE)).rejects.toThrow();
  });

  it('lets the customer approve an estimate through the link', async () => {
    const est = await workOrders.create(orgId, userId, {
      vehicleId,
      asEstimate: true,
      notes: 'internal: customer haggles',
      items: [{ productId, locationId: rackId, quantity: 2 }],
    });
    const link = await workOrders.approvalLink(orgId, est.id);
    expect(link.token.length).toBeGreaterThanOrEqual(32);
    // Copying again gives the same link, so one already sent keeps working.
    expect((await workOrders.approvalLink(orgId, est.id)).token).toBe(link.token);

    const view = await workOrders.publicEstimate(link.token);
    expect(view.total).toBe(2 * PRICE);
    expect(JSON.stringify(view)).not.toContain('haggles');

    // Changed after the customer opened it: their answer is refused.
    await workOrders.update(orgId, userId, est.id, { items: [{ productId, locationId: rackId, quantity: 3 }] });
    await expect(
      workOrders.respondToEstimate(link.token, true, { name: 'Budi', version: view.version }),
    ).rejects.toThrow(ConflictException);

    const fresh = await workOrders.publicEstimate(link.token);
    const answered = await workOrders.respondToEstimate(link.token, true, { name: 'Budi', version: fresh.version });
    expect(answered.status).toBe(WorkOrderStatus.QUEUED);
    const wo = await workOrders.getOne(orgId, est.id);
    expect(wo.approvalNote).toBe('Approved online by Budi');
    expect(wo.approvedById).toBeNull();
    const note = await prisma.notification.findFirst({ where: { userId, type: 'WORK_ORDER_APPROVED' } });
    expect(note?.link).toBe(`/workshop/work-orders/${est.id}`);

    // Answered once only.
    await expect(
      workOrders.respondToEstimate(link.token, false, { name: 'Budi', version: fresh.version }),
    ).rejects.toThrow(BadRequestException);
    await expect(workOrders.approvalLink(orgId, est.id)).rejects.toThrow('Only an estimate');
  });

  it('records a decline from the link, and refuses bad or expired links', async () => {
    const est = await workOrders.create(orgId, userId, { vehicleId, asEstimate: true });
    const { token } = await workOrders.approvalLink(orgId, est.id);
    const view = await workOrders.publicEstimate(token);
    await workOrders.respondToEstimate(token, false, { name: 'Budi', reason: 'Too expensive', version: view.version });
    const wo = await workOrders.getOne(orgId, est.id);
    expect(wo.status).toBe(WorkOrderStatus.CANCELLED);
    expect(wo.approvalNote).toBe('Declined online by Budi: Too expensive');

    await expect(workOrders.publicEstimate('nope')).rejects.toThrow(NotFoundException);
    await prisma.workOrder.update({ where: { id: est.id }, data: { approvalTokenExpiresAt: new Date(Date.now() - 1000) } });
    await expect(workOrders.publicEstimate(token)).rejects.toThrow(GoneException);
  });

  it('carries formal-estimate details to the invoice, and expires for the customer', async () => {
    const est = await workOrders.create(orgId, userId, {
      vehicleId,
      asEstimate: true,
      validUntil: '2020-01-31',
      customerPoNumber: 'PO-FLEET-77',
      paymentTerms: 'Net 30',
      items: [{ description: 'Labour: service', quantity: 1, unitPrice: 100_000 }],
    });
    expect(est.customerPoNumber).toBe('PO-FLEET-77');

    // Past its validity the customer can't approve through the link…
    const { token } = await workOrders.approvalLink(orgId, est.id);
    const view = await workOrders.publicEstimate(token);
    expect(view.customerPoNumber).toBe('PO-FLEET-77');
    await expect(
      workOrders.respondToEstimate(token, true, { name: 'Fleet manager', version: view.version }),
    ).rejects.toThrow('no longer valid');

    // …staff can extend it, or approve it themselves.
    await workOrders.update(orgId, userId, est.id, { validUntil: '2099-12-31' });
    const fresh = await workOrders.publicEstimate(token);
    await workOrders.respondToEstimate(token, true, { name: 'Fleet manager', version: fresh.version });

    const { invoiceId } = await workOrders.createInvoice(orgId, userId, est.id);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.customerPoNumber).toBe('PO-FLEET-77');
    expect(invoice.paymentTerms).toBe('Net 30');

    // Clearing a field with ''.
    const other = await workOrders.create(orgId, userId, { vehicleId, asEstimate: true, paymentTerms: 'COD' });
    expect((await workOrders.update(orgId, userId, other.id, { paymentTerms: '' })).paymentTerms).toBeNull();
  });

  it('leaves recommended work as a reminder that can start the next job', async () => {
    const wo = await newJob(62_000);
    const withRec = await workOrders.addRecommendation(orgId, wo.id, {
      note: 'Brake pads at 20% — replace',
      dueDate: '2027-01-15',
    });
    expect(withRec.recommendations).toHaveLength(1);
    const reminderId = withRec.recommendations[0].id;

    const next = await workOrders.create(orgId, userId, { vehicleId, fromReminderId: reminderId });
    expect(next.followedUp[0].sourceWorkOrder?.number).toBe(wo.number);
    const reminder = await prisma.vehicleReminder.findUniqueOrThrow({ where: { id: reminderId } });
    expect(reminder.status).toBe('COMPLETED');
    expect(reminder.followUpWorkOrderId).toBe(next.id);
    // A reminder starts one job only.
    await expect(workOrders.create(orgId, userId, { vehicleId, fromReminderId: reminderId })).rejects.toThrow('not pending');
  });

  it('is unavailable while the org has work orders turned off', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { workOrdersEnabled: false } });
    try {
      await expect(workOrders.list(orgId, {})).rejects.toThrow(ForbiddenException);
    } finally {
      await prisma.organization.update({ where: { id: orgId }, data: { workOrdersEnabled: true } });
    }
  });
});
