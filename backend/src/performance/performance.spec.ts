import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkOrderStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { InvoiceService } from '../invoice/invoice.service';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { VehicleRemindersModule } from '../vehicles/vehicle-reminders.module';
import { VehicleRemindersService } from '../vehicles/vehicle-reminders.service';
import { PerformanceModule } from './performance.module';
import { PerformanceService } from './performance.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// The staff performance report, comebacks and km reminders, against the isolated test DB.
describe('Staff performance', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let workOrders: WorkOrdersService;
  let invoices: InvoiceService;
  let orgId: string;
  let userId: string;
  let vehicleId: string;
  let otherVehicleId: string;
  let andi: string;
  let budi: string;
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, WorkOrdersModule, PerformanceModule, VehicleRemindersModule],
    }).compile();
    prisma = module.get(PrismaService);
    workOrders = module.get(WorkOrdersService);
    invoices = module.get(InvoiceService);
    orgId = (await prisma.organization.create({ data: { name: `Perf ${randomUUID()}`, workOrdersEnabled: true } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    for (const m of ['INVOICE_POS', 'WORKSHOP_RMS'] as const) {
      await prisma.organizationModule.create({ data: { organizationId: orgId, module: m, enabled: true } });
    }
    userId = (
      await prisma.user.create({
        data: { email: `p-${randomUUID()}@example.com`, password: 'x', role: 'MASTER', organizationId: orgId },
      })
    ).id;
    const customerId = (await prisma.customer.create({ data: { name: 'Pak Joko', organizationId: orgId } })).id;
    const car = (plate: string) =>
      prisma.vehicle.create({
        data: { organizationId: orgId, customerId, plateNumber: plate, plateNormalized: plate.replace(/ /g, ''), vehicleModel: 'Avanza', odometer: 40_000 },
      });
    vehicleId = (await car('B 1 AA')).id;
    otherVehicleId = (await car('B 2 BB')).id;
    andi = (await prisma.employee.create({ data: { organizationId: orgId, name: 'Andi', baseSalary: 0 } })).id;
    budi = (await prisma.employee.create({ data: { organizationId: orgId, name: 'Budi', baseSalary: 0 } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  it('reports what each mechanic finished, how long it took and what came back', async () => {
    const job = await workOrders.create(orgId, userId, {
      vehicleId,
      mechanicId: andi,
      items: [{ description: 'Ganti kampas rem', quantity: 1, unitPrice: 200_000 }],
    });
    await workOrders.setStatus(orgId, job.id, WorkOrderStatus.IN_PROGRESS);
    await workOrders.setStatus(orgId, job.id, WorkOrderStatus.DONE);
    // Two and a half hours on the lift.
    const done = await prisma.workOrder.findUniqueOrThrow({ where: { id: job.id } });
    await prisma.workOrder.update({
      where: { id: job.id },
      data: { startedAt: new Date(done.completedAt!.getTime() - 2.5 * 3600_000) },
    });
    const { invoiceId } = await workOrders.createInvoice(orgId, userId, job.id);
    await invoices.issue(orgId, invoiceId, userId, 'MASTER');

    // The car is back with the same squeal: Budi redoes Andi's job.
    await expect(
      workOrders.create(orgId, userId, { vehicleId: otherVehicleId, comebackOfId: job.id, items: [] }),
    ).rejects.toThrow('earlier job on this vehicle');
    const comeback = await workOrders.create(orgId, userId, {
      vehicleId,
      mechanicId: budi,
      comebackOfId: job.id,
      comebackReason: 'Rem masih bunyi',
      items: [],
    });
    expect((await workOrders.getOne(orgId, job.id)).comebacks.map((c) => c.id)).toEqual([comeback.id]);

    const report = await module.get(PerformanceService).report(orgId, { from: today, to: today });
    const a = report.mechanics!.find((m) => m.employeeId === andi)!;
    expect(a).toMatchObject({ jobs: 1, invoicedJobs: 1, services: 200_000, parts: 0, timedJobs: 1, avgHours: 2.5, comebacks: 1, comebackRate: 100 });
    expect(report.mechanics!.find((m) => m.employeeId === budi)).toBeUndefined();
    expect(report.comebacks).toEqual([
      expect.objectContaining({ number: comeback.number, reason: 'Rem masih bunyi', original: expect.objectContaining({ mechanic: 'Andi' }) }),
    ]);
    // The job's invoice carries its mechanic as the salesperson.
    expect(report.salespeople).toEqual([expect.objectContaining({ employeeId: andi, invoices: 1, total: 200_000 })]);
  });

  it('makes a reminder due once the car reaches its km, before its date', async () => {
    const reminders = module.get(VehicleRemindersService);
    const far = new Date(Date.now() + 180 * 86_400_000).toISOString();
    const r = await reminders.createForVehicle(orgId, vehicleId, { note: 'Ganti oli', dueDate: far, dueOdometer: 45_000 });
    let row = (await reminders.listForOrg(orgId)).find((x) => x.id === r.id)!;
    expect(row).toMatchObject({ dueByKm: false, kmToGo: 5_000 });
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { odometer: 45_200 } });
    row = (await reminders.listForOrg(orgId)).find((x) => x.id === r.id)!;
    expect(row).toMatchObject({ dueByKm: true, kmToGo: -200 });
  });
});
