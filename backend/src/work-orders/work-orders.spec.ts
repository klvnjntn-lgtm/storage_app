import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InvoiceStatus, WorkOrderStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { InvoiceService } from '../invoice/invoice.service';
import { WorkOrdersModule } from './work-orders.module';
import { WorkOrdersService } from './work-orders.service';

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
    module = await Test.createTestingModule({ imports: [PrismaModule, WorkOrdersModule] }).compile();
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

    expect((await workOrders.getOne(orgId, wo.id)).invoicedId).toBe(invoiceId);
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

  it('is unavailable while the org has work orders turned off', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { workOrdersEnabled: false } });
    try {
      await expect(workOrders.list(orgId, {})).rejects.toThrow(ForbiddenException);
    } finally {
      await prisma.organization.update({ where: { id: orgId }, data: { workOrdersEnabled: true } });
    }
  });
});
