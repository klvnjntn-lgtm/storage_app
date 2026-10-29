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
import { SalesQuotationService } from '../sales-quotation/sales-quotation.service';
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
  let quotations: SalesQuotationService;

  let orgId: string;
  let userId: string;
  let rackId: string;
  let productId: string;
  let vehicleId: string;
  let customerId: string;
  let mechanicId: string;
  // The quotation tests' own car, so their odometer readings don't race the job tests'.
  let quotedCarId: string;

  const PRICE = 150_000;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, WorkOrdersModule, VehiclesModule] }).compile();
    prisma = module.get(PrismaService);
    workOrders = module.get(WorkOrdersService);
    invoices = module.get(InvoiceService);
    quotations = module.get(SalesQuotationService);

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
    mechanicId = (
      await prisma.employee.create({ data: { organizationId: orgId, name: 'Andi', baseSalary: 0, isMechanic: true } })
    ).id;
    quotedCarId = (
      await prisma.vehicle.create({
        data: { organizationId: orgId, customerId, plateNumber: 'B 777 QQ', plateNormalized: 'B777QQ', vehicleModel: 'Xenia' },
      })
    ).id;
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

  // A workshop quotation for the test car: 2 × oil and one labour line.
  function newQuotation(extra: Partial<Parameters<SalesQuotationService['create']>[2]> = {}) {
    return quotations.create(orgId, userId, {
      format: 'A4',
      customerId,
      vehicleId: quotedCarId,
      odometer: 51_000,
      complaint: 'Service and brake check',
      locationId: rackId,
      items: [
        { productId, locationId: rackId, quantity: 2 },
        { description: 'Labour: service', quantity: 1, unitPrice: 100_000 },
      ],
      ...extra,
    } as never);
  }

  it('shares a quotation by link: the customer answers, then it becomes a job', async () => {
    const q = await newQuotation({ notes: 'internal: customer haggles' } as never);
    const link = await quotations.approvalLink(orgId, q.id, userId);
    expect(link.token.length).toBeGreaterThanOrEqual(32);
    // Copying the link sent the draft, so it has its number; copying again gives the same link.
    expect((await quotations.getOne(orgId, q.id)).quotationNumber).toBeTruthy();
    expect((await quotations.approvalLink(orgId, q.id, userId)).token).toBe(link.token);

    const view = await quotations.publicView(link.token);
    expect(view.total).toBe(2 * PRICE + 100_000);
    expect(view.vehicle?.plateNumber).toBe('B 777 QQ');
    expect(JSON.stringify(view)).not.toContain('haggles');

    // Changed after the customer opened it: their answer is refused until it's sent again.
    await quotations.update(orgId, q.id, userId, {
      items: [{ productId, locationId: rackId, quantity: 3 }, { description: 'Labour: service', quantity: 1, unitPrice: 100_000 }],
    } as never);
    await expect(quotations.respond(link.token, true, { name: 'Budi', version: view.version })).rejects.toThrow(ConflictException);
    await quotations.approvalLink(orgId, q.id, userId);
    const fresh = await quotations.publicView(link.token);
    expect((await quotations.respond(link.token, true, { name: 'Budi', version: fresh.version })).status).toBe('ACCEPTED');
    await expect(quotations.respond(link.token, false, { name: 'Budi', version: fresh.version })).rejects.toThrow(
      BadRequestException,
    );
    const note = await prisma.notification.findFirst({ where: { userId, type: 'QUOTATION_APPROVED' } });
    expect(note?.link).toBe(`/sales/quotations/${q.id}`);

    const wo = await workOrders.createFromQuotation(orgId, userId, q.id, { mechanicId });
    expect(wo.status).toBe(WorkOrderStatus.QUEUED);
    expect(wo.mechanic?.id).toBe(mechanicId);
    expect(wo.complaint).toBe('Service and brake check');
    expect(wo.odometer).toBe(51_000);
    expect(wo.items.map((i) => Number(i.quantity))).toEqual([3, 1]);
    expect(Number(wo.items[1].unitPrice)).toBe(100_000);
    expect(wo.approvalNote).toContain('Approved online by Budi');
    const converted = await quotations.getOne(orgId, q.id);
    expect(converted.status).toBe('CONVERTED');
    expect(converted.workOrder?.id).toBe(wo.id);
    // A quotation makes one job only.
    await expect(workOrders.createFromQuotation(orgId, userId, q.id)).rejects.toThrow('already a work order');
  });

  it('converts without waiting for the customer, and an additional quotation joins the same job', async () => {
    const q = await newQuotation();
    // Extra parts can only be quoted once the job exists.
    await expect(quotations.createAddition(orgId, q.id, userId)).rejects.toThrow('Convert the quotation');
    const wo = await workOrders.createFromQuotation(orgId, userId, q.id);
    expect(wo.items).toHaveLength(2);

    const addition = await quotations.createAddition(orgId, q.id, userId);
    expect(addition.parentQuotationId).toBe(q.id);
    expect(addition.vehicleId).toBe(quotedCarId);
    await quotations.update(orgId, addition.id, userId, {
      items: [{ description: 'Brake pads fitting', quantity: 1, unitPrice: 75_000 }],
    } as never);

    const same = await workOrders.createFromQuotation(orgId, userId, addition.id);
    expect(same.id).toBe(wo.id);
    expect(same.items.map((i) => i.description ?? i.productId)).toEqual([productId, 'Labour: service', 'Brake pads fitting']);
    expect((await quotations.getOne(orgId, q.id)).additions.map((a) => a.id)).toEqual([addition.id]);
    expect((await quotations.getOne(orgId, addition.id)).workOrder?.id).toBe(wo.id);
  });

  // A car of the test's own, so its odometer doesn't race the other tests'.
  async function newCar(odometer: number) {
    const tag = randomUUID().slice(0, 6).toUpperCase();
    return (
      await prisma.vehicle.create({
        data: { organizationId: orgId, customerId, plateNumber: `B ${tag}`, plateNormalized: `B${tag}`, vehicleModel: 'Brio', odometer },
      })
    ).id;
  }

  it('starts the job with no odometer, and says why, when the car has since been read higher', async () => {
    const car = await newCar(40_000);
    const q = await newQuotation({ vehicleId: car, odometer: 41_000 });
    await prisma.vehicle.update({ where: { id: car }, data: { odometer: 45_000 } });

    const wo = await workOrders.createFromQuotation(orgId, userId, q.id);
    expect(wo.odometer).toBeNull();
    expect(wo.approvalNote).toContain('41.000 km');
    expect(wo.approvalNote).toContain("enter today's reading");
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: car } })).odometer).toBe(45_000);
  });

  it('carries the quoted car and its reading onto an invoice made straight from the quotation', async () => {
    const car = await newCar(30_000);
    const q = await newQuotation({ vehicleId: car, odometer: 30_500 });
    await quotations.send(orgId, q.id, userId);

    const invoice = await invoices.createDraftFromQuotation(orgId, userId, q.id);
    expect(invoice.vehicleId).toBe(car);
    expect(invoice.odometer).toBe(30_500);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: car } })).odometer).toBe(30_500);
  });

  it('records a decline from the link, and refuses bad or expired links', async () => {
    const q = await newQuotation();
    const { token } = await quotations.approvalLink(orgId, q.id, userId);
    const view = await quotations.publicView(token);
    await quotations.respond(token, false, { name: 'Budi', reason: 'Too expensive', version: view.version });
    const declined = await quotations.getOne(orgId, q.id);
    expect(declined.status).toBe('REJECTED');
    expect(declined.responseNote).toBe('Declined online by Budi: Too expensive');
    await expect(workOrders.createFromQuotation(orgId, userId, q.id)).rejects.toThrow('declined');

    await expect(quotations.publicView('nope')).rejects.toThrow(NotFoundException);
    await prisma.salesQuotation.update({ where: { id: q.id }, data: { approvalTokenExpiresAt: new Date(Date.now() - 1000) } });
    await expect(quotations.publicView(token)).rejects.toThrow(GoneException);
  });

  it('refuses a quotation past its validity on the link, and one without a vehicle', async () => {
    const q = await newQuotation({ validUntil: '2020-01-31' } as never);
    const { token } = await quotations.approvalLink(orgId, q.id, userId);
    const view = await quotations.publicView(token);
    await expect(quotations.respond(token, true, { name: 'Fleet manager', version: view.version })).rejects.toThrow(
      'no longer valid',
    );
    const noCar = await newQuotation({ vehicleId: undefined } as never);
    await expect(workOrders.createFromQuotation(orgId, userId, noCar.id)).rejects.toThrow('vehicle');
  });

  it('shows the floor on the mechanic board: active jobs, no prices', async () => {
    const job = await workOrders.create(orgId, userId, {
      vehicleId,
      mechanicId,
      items: [{ productId, locationId: rackId, quantity: 4 }],
    });
    const board = await workOrders.board(orgId);
    const shown = board.jobs.find((j) => j.id === job.id);
    expect(shown?.plateNumber).toBe('B 1234 XY');
    expect(shown?.mechanic).toBe('Andi');
    expect(shown?.lines[0]).toEqual({ name: 'Engine oil 1L', isPart: true, quantity: 4 });
    expect(JSON.stringify(board)).not.toMatch(/unitPrice|lineTotal|phone/);

    await workOrders.setStatus(orgId, job.id, WorkOrderStatus.DONE);
    expect((await workOrders.board(orgId)).jobs.some((j) => j.id === job.id)).toBe(false);
  });

  it('offers only the mechanic account’s names, made from what was written there', async () => {
    const budi = await workOrders.addMechanic(orgId, '  Budi ');
    expect(budi.name).toBe('Budi');
    const asEmployee = await prisma.employee.findUniqueOrThrow({ where: { id: budi.id } });
    expect(asEmployee).toMatchObject({ isMechanic: true, position: 'Mechanic' });
    await expect(workOrders.addMechanic(orgId, 'budi')).rejects.toThrow('already a mechanic');

    // A cashier on Payroll is no mechanic: not offered, and refused on a job.
    const cashier = await prisma.employee.create({ data: { organizationId: orgId, name: 'Citra', baseSalary: 0 } });
    const offered = (await workOrders.mechanics(orgId)).map((m) => m.name);
    expect(offered).toEqual(expect.arrayContaining(['Andi', 'Budi']));
    expect(offered).not.toContain('Citra');
    await expect(workOrders.create(orgId, userId, { vehicleId, mechanicId: cashier.id })).rejects.toThrow('Mechanic not found');

    // Removed: off the picker, back when written again.
    await workOrders.removeMechanic(orgId, budi.id);
    expect((await workOrders.mechanics(orgId)).map((m) => m.name)).not.toContain('Budi');
    expect((await workOrders.addMechanic(orgId, 'Budi')).id).toBe(budi.id);
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

  it('adds a part from the catalogue, at the location holding it, keeping the other lines', async () => {
    const wo = await newJob(62_000);
    const updated = await workOrders.addLine(orgId, userId, wo.id, { productId, quantity: 1 });
    expect(updated.items).toHaveLength(3);
    expect(updated.items[2]).toMatchObject({ productId, locationId: rackId });
    const labour = await workOrders.addLine(orgId, userId, wo.id, {
      description: 'Tie rod end 45046-09511 (not stocked)',
      quantity: 2,
      unitPrice: 85_000,
    });
    expect(labour.items.map((i) => i.description ?? i.productId)).toEqual([
      productId,
      'Labour: oil change',
      productId,
      'Tie rod end 45046-09511 (not stocked)',
    ]);
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { odometer: 52_000 } });
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
