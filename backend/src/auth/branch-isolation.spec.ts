import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { BranchesModule } from '../branches/branches.module';
import { ExpensesModule } from '../accounting/expenses.module';
import { ExpensesService } from '../accounting/expenses.service';
import { BranchesService } from '../branches/branches.service';
import { BankAccountResolverService } from '../bank-accounts/bank-account-resolver.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlanLimitsService } from '../billing/plan-limits.service';
import { RolesGuard } from './guards/roles.guard';
import { ROLES_KEY } from './decorators/roles.decorator';
import { BRANCH_RECORD_KEY, BranchRecordGuard } from './guards/branch-record.guard';
import { bookingBranchId, effectiveBranchId } from './branch-scope';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// MASTER runs the whole business; an ADMIN or USER only sees and books
// their own branch. Against the isolated test DB.
describe('Branch isolation', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoiceService;
  let users: UsersService;

  let orgId: string;
  let masterId: string;
  let main: string;
  let east: string;
  let mainInvoiceId: string;

  const ctx = (user: object, params: object, meta?: object): ExecutionContext => {
    const handler = () => undefined;
    if (meta) Reflect.defineMetadata(BRANCH_RECORD_KEY, meta, handler);
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user, params, organizationId: orgId }) }),
    } as unknown as ExecutionContext;
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, InvoiceModule, BranchesModule, ExpensesModule] }).compile();
    prisma = module.get(PrismaService);
    invoices = module.get(InvoiceService);
    const notifications = { create: jest.fn(), createMany: jest.fn() } as unknown as NotificationsService;
    users = new UsersService(prisma, notifications, new PlanLimitsService(prisma));

    orgId = (await prisma.organization.create({ data: { name: `Iso ${randomUUID().slice(0, 6)}`, seatLimit: 20 } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.createMany({
      data: ['INVOICE_POS', 'WORKSHOP_RMS'].map((m) => ({ organizationId: orgId, module: m as never, enabled: true })),
    });
    const branches = module.get(BranchesService);
    main = (await branches.list(orgId))[0].id;
    east = (await branches.create(orgId, { name: 'Timur' })).id;
    masterId = (
      await prisma.user.create({
        data: { email: `m-${randomUUID()}@example.com`, password: 'x', role: 'MASTER', organizationId: orgId },
      })
    ).id;
    mainInvoiceId = (
      await invoices.createDraft(orgId, masterId, {
        format: 'A4',
        customerName: 'Walk-in',
        branchId: main,
        items: [{ description: 'Labour', quantity: 1, unitPrice: 50_000 }],
      } as never)
    ).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  it('lets MASTER through every admin gate, but not ADMIN through MASTER ones', () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);
    const gated = (roles: string[], role: string) => {
      const handler = () => undefined;
      Reflect.defineMetadata(ROLES_KEY, roles, handler);
      return guard.canActivate({
        getHandler: () => handler,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      } as unknown as ExecutionContext);
    };
    expect(gated(['ADMIN'], 'MASTER')).toBe(true);
    expect(gated(['ADMIN', 'USER'], 'MASTER')).toBe(true);
    expect(gated(['MASTER'], 'ADMIN')).toBe(false);
    expect(gated(['DRIVER'], 'MASTER')).toBe(false);
  });

  it('holds branch staff to their branch, falling back to the first', async () => {
    expect(await effectiveBranchId(prisma, { role: 'MASTER', organizationId: orgId, branchId: null })).toBeNull();
    expect(await effectiveBranchId(prisma, { role: 'USER', organizationId: orgId, branchId: null })).toBe(main);
    expect(
      await effectiveBranchId(prisma, { role: 'ADMIN', organizationId: orgId, branchId: east, branch: { archivedAt: null } }),
    ).toBe(east);
    expect(bookingBranchId({ branchId: east }, undefined)).toBe(east);
    expect(() => bookingBranchId({ branchId: east }, main)).toThrow('own branch');
    expect(bookingBranchId({ branchId: null }, main)).toBe(main);
  });

  it('hides another branch’s invoice by id', async () => {
    const guard = new BranchRecordGuard(new Reflector(), prisma);
    const meta = { model: 'invoice', param: 'id' };
    await expect(guard.canActivate(ctx({ branchId: east }, { id: mainInvoiceId }, meta))).rejects.toThrow(NotFoundException);
    await expect(guard.canActivate(ctx({ branchId: main }, { id: mainInvoiceId }, meta))).resolves.toBe(true);
    await expect(guard.canActivate(ctx({ branchId: null }, { id: mainInvoiceId }, meta))).resolves.toBe(true);
  });

  it('lists only the branch asked for', async () => {
    const eastList = await invoices.list(orgId, { branchId: east });
    expect(eastList.data.map((i) => i.id)).not.toContain(mainInvoiceId);
    const mainList = await invoices.list(orgId, { branchId: main });
    expect(mainList.data.map((i) => i.id)).toContain(mainInvoiceId);
  });

  it('keeps a branch ADMIN to their own branch’s members, below MASTER', async () => {
    const mk = (role: 'ADMIN' | 'USER', branchId: string) =>
      prisma.user.create({
        data: { email: `${role}-${randomUUID()}@example.com`, password: 'x', role, organizationId: orgId, branchId },
      });
    const eastAdmin = await mk('ADMIN', east);
    const eastUser = await mk('USER', east);
    const mainUser = await mk('USER', main);
    const actor = { sub: eastAdmin.id, role: 'ADMIN', branchId: east };

    const seen = (await users.listMembers(orgId, actor)).members.map((m) => m.id);
    expect(seen).toContain(eastUser.id);
    expect(seen).not.toContain(mainUser.id);
    expect(seen).not.toContain(masterId);

    await expect(users.setRole(orgId, actor, eastUser.id, 'MASTER')).rejects.toThrow('master');
    await expect(users.setActive(orgId, actor, mainUser.id, false)).rejects.toThrow('not found');
    await expect(users.removeMember(orgId, actor, masterId)).rejects.toThrow('master');
    // MASTER moves people between branches.
    const moved = await users.setBranch(orgId, mainUser.id, east);
    expect(moved.branchId).toBe(east);
    // The last MASTER stays.
    await expect(users.setRole(orgId, { sub: eastAdmin.id, role: 'MASTER' }, masterId, 'ADMIN')).rejects.toThrow(
      'last active master',
    );
  });

  it('only offers a branch the shared bank accounts and its own', async () => {
    const resolver = module.get(BankAccountResolverService);
    const mk = (bankName: string, branchId: string | null, isDefault = false) =>
      prisma.organizationBankAccount.create({
        data: { organizationId: orgId, bankName, accountNumber: randomUUID().slice(0, 8), accountName: 'Toko', branchId, isDefault },
      });
    const mainDefault = await mk('BCA', main, true);
    const eastOwn = await mk('BRI', east);
    expect((await resolver.resolve(orgId, undefined, prisma, main)).bankAccountId).toBe(mainDefault.id);
    // The org default belongs to main, so east falls back to its own.
    expect((await resolver.resolve(orgId, undefined, prisma, east)).bankAccountId).toBe(eastOwn.id);
    await expect(resolver.resolve(orgId, mainDefault.id, prisma, east)).rejects.toThrow('not found');
  });

  it('books each employee’s salary to their branch', async () => {
    const emp = (name: string, branchId: string | null) =>
      prisma.employee.create({ data: { organizationId: orgId, name, baseSalary: 1_000_000, branchId } });
    const [a, b, c] = await Promise.all([emp('A', main), emp('B', east), emp('C', null)]);
    const payroll = await prisma.payroll.create({
      data: {
        organizationId: orgId,
        periodMonth: 10,
        periodYear: 2026,
        documentDate: new Date('2026-10-28'),
        items: {
          create: [a, b, c].map((e, i) => ({
            employeeId: e.id,
            baseSalary: 1_000_000,
            grossPay: 1_000_000 * (i + 1),
            netPay: 1_000_000 * (i + 1),
          })),
        },
      },
    });
    const entry = await module.get(PostingRulesService, { strict: false }).postPayrollRun(orgId, payroll.id);
    const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: entry.id, debit: { gt: 0 } } });
    const byBranch = Object.fromEntries(lines.map((l) => [l.branchId ?? 'none', Number(l.debit)]));
    expect(byBranch).toEqual({ [main]: 1_000_000, [east]: 2_000_000, none: 3_000_000 });
  });

  it('pays a branch’s expense only from a shared account or its own', async () => {
    const expenses = module.get(ExpensesService);
    const categoryId = (await prisma.expenseCategory.create({ data: { organizationId: orgId, name: `Sewa ${randomUUID().slice(0, 4)}` } })).id;
    const expense = await expenses.create(orgId, {
      categoryId,
      description: 'Sewa ruko timur',
      amount: 1_000_000,
      expenseDate: '2026-10-01',
      branchId: east,
    } as never);
    const mainOnly = await prisma.organizationBankAccount.create({
      data: { organizationId: orgId, bankName: 'Mandiri', accountNumber: randomUUID().slice(0, 8), accountName: 'Toko', branchId: main },
    });
    await expect(
      expenses.recordPayment(orgId, expense.id, { amount: 100_000, method: 'TRANSFER', bankAccountId: mainOnly.id } as never),
    ).rejects.toThrow('active bank account');
  });
});
