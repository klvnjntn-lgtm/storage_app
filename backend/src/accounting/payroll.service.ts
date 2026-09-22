import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { JournalService } from '../accounting/journal.service';
import { CreatePayrollDto, MarkPayrollPaidDto } from './dto/payroll.dto';
import { JournalSourceType, PayrollPayType, PayrollStatus, PaymentMethod, SalaryComponentKind } from '@prisma/client';

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private postingRules: PostingRulesService,
    private journal: JournalService,
  ) {}

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  async list(organizationId: string) {
    return this.prisma.payroll.findMany({
      where: { organizationId },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      include: { _count: { select: { items: true } } },
    });
  }

  async get(organizationId: string, id: string) {
    const payroll = await this.prisma.payroll.findFirst({
      where: { id, organizationId },
      include: {
        items: {
          include: { employee: true, components: true },
        },
      },
    });
    if (!payroll) throw new NotFoundException('Payroll run not found');
    return payroll;
  }

  // Flat, print-shaped read model for a single employee's payslip — same
  // pattern as SalesOrderService.getPrintView: pull the tenant-scoped row
  // plus its business letterhead fields in one query, then hand back
  // plain numbers instead of Decimal instances.
  async getPayslip(organizationId: string, itemId: string) {
    const item = await this.prisma.payrollItem.findFirst({
      where: { id: itemId, payroll: { organizationId } },
      include: {
        employee: true,
        components: true,
        payroll: { include: { organization: true } },
      },
    });
    if (!item) throw new NotFoundException('Payslip not found');

    const org = item.payroll.organization;
    return {
      id: item.id,

      businessName: org.name,
      businessLegalName: org.legalName,
      businessNpwp: org.npwp,
      businessLogoUrl: org.logoUrl,
      businessAddress: org.address,
      businessPhone: org.phone,

      periodMonth: item.payroll.periodMonth,
      periodYear: item.payroll.periodYear,
      payType: item.payroll.payType,
      documentDate: item.payroll.documentDate,
      status: item.payroll.status,
      paidAt: item.payroll.paidAt,
      paymentMethod: item.payroll.paymentMethod,

      employeeName: item.employee.name,
      employeePosition: item.employee.position,
      employeeNik: item.employee.nik,
      employeeBankName: item.employee.bankName,
      employeeBankAccountNumber: item.employee.bankAccountNumber,

      baseSalary: Number(item.baseSalary),
      grossPay: Number(item.grossPay),
      totalDeductions: Number(item.totalDeductions),
      netPay: Number(item.netPay),
      components: item.components.map((c) => ({
        name: c.name,
        type: c.type,
        amount: Number(c.amount),
      })),
    };
  }

  // Creates a payroll run and computes every employee's pay in one
  // transaction. Component amounts are snapshotted onto PayrollItemComponent
  // at creation time — editing a SalaryComponentType or an employee's
  // assignment afterwards must never rewrite an already-created payslip.
  async create(organizationId: string, dto: CreatePayrollDto) {
    const payType = dto.payType ?? PayrollPayType.MONTHLY;

    const duplicate = await this.prisma.payroll.findUnique({
      where: {
        organizationId_periodYear_periodMonth_payType: {
          organizationId,
          periodYear: dto.periodYear,
          periodMonth: dto.periodMonth,
          payType,
        },
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        `A ${payType} payroll for ${dto.periodMonth}/${dto.periodYear} already exists`,
      );
    }

    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId,
        isActive: true,
        archivedAt: null,
        ...(dto.employeeIds ? { id: { in: dto.employeeIds } } : {}),
      },
      include: { salaryComponents: { include: { component: true } } },
    });

    if (dto.employeeIds && employees.length !== dto.employeeIds.length) {
      throw new BadRequestException('One or more employeeIds are invalid, inactive, or archived');
    }
    if (employees.length === 0) {
      throw new BadRequestException('No active employees to run payroll for');
    }

    return this.prisma.$transaction(async (tx) => {
      const payroll = await tx.payroll.create({
        data: {
          organizationId,
          periodMonth: dto.periodMonth,
          periodYear: dto.periodYear,
          payType,
          documentDate: new Date(dto.documentDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          status: PayrollStatus.DRAFT,
        },
      });

      for (const employee of employees) {
        const baseSalary = Number(employee.baseSalary);
        const computed = employee.salaryComponents.map((assignment) => {
          const isFixed = assignment.component.isFixed;
          const amount = isFixed
            ? Number(assignment.amount ?? assignment.component.defaultAmount ?? 0)
            : (Number(assignment.percentage ?? assignment.component.defaultPercentage ?? 0) / 100) *
              baseSalary;

          return {
            componentId: assignment.componentId,
            name: assignment.component.name,
            type: assignment.component.type,
            amount: Math.round(amount * 100) / 100,
          };
        });

        const totalAllowances = this.round2(computed
          .filter((c) => c.type === SalaryComponentKind.ALLOWANCE)
          .reduce((sum, c) => sum + c.amount, 0));
        const totalDeductions = this.round2(computed
          .filter((c) => c.type === SalaryComponentKind.DEDUCTION)
          .reduce((sum, c) => sum + c.amount, 0));

        // FIX — wasn't run through round2 like every other money
        // computation in this codebase; relied on implicit DB-level
        // rounding into Decimal(12,2) instead of explicit JS rounding, so
        // float-sum drift (e.g. 0.1 + 0.2) could show a slightly
        // different number here than what actually gets persisted.
        const grossPay = this.round2(baseSalary + totalAllowances);
        const netPay = this.round2(grossPay - totalDeductions);

        await tx.payrollItem.create({
          data: {
            payrollId: payroll.id,
            employeeId: employee.id,
            baseSalary,
            grossPay,
            totalDeductions,
            netPay,
            components: {
              create: computed.map((c) => ({
                componentId: c.componentId,
                name: c.name,
                type: c.type,
                amount: c.amount,
              })),
            },
          },
        });
      }

      return tx.payroll.findUniqueOrThrow({
        where: { id: payroll.id },
        include: { items: { include: { employee: true, components: true } } },
      });
    });
  }

  // DRAFT -> POSTED, and the ledger posting happens in the SAME
  // transaction. A payroll run that's "POSTED" but has no journal entry
  // behind it (or vice versa) should be structurally impossible — if
  // postPayrollRun throws (e.g. Chart of Accounts not configured, or a
  // deduction's account is archived), the whole status flip rolls back too.
  async post(organizationId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.payroll.updateMany({
        where: { id, organizationId, status: PayrollStatus.DRAFT },
        data: { status: PayrollStatus.POSTED },
      });
      if (claim.count === 0) {
        const payroll = await tx.payroll.findFirst({ where: { id, organizationId } });
        if (!payroll) throw new NotFoundException('Payroll run not found');
        throw new BadRequestException(`Only DRAFT payrolls can be posted (current status: ${payroll.status})`);
      }

      await this.postingRules.postPayrollRun(organizationId, id, tx);

      return tx.payroll.findUniqueOrThrow({ where: { id } });
    });
  }

  // POSTED -> PAID, once salaries have actually been disbursed. Posts the
  // Payroll Payable -> Cash/Bank leg in the SAME transaction as the status
  // flip, same reasoning as post() above: PAID with no disbursement entry
  // behind it should be structurally impossible.
  async markPaid(organizationId: string, id: string, dto: MarkPayrollPaidDto) {
    if (dto.paymentMethod !== PaymentMethod.CASH) {
      if (!dto.bankAccountId) {
        throw new BadRequestException(`bankAccountId is required for payment method ${dto.paymentMethod}`);
      }
      const bankAccount = await this.prisma.organizationBankAccount.findFirst({
        where: { id: dto.bankAccountId, organizationId, archivedAt: null },
      });
      if (!bankAccount) {
        throw new BadRequestException('bankAccountId does not refer to an active bank account for this organization');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.payroll.updateMany({
        where: { id, organizationId, status: PayrollStatus.POSTED },
        data: {
          status: PayrollStatus.PAID,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          paymentMethod: dto.paymentMethod,
          bankAccountId: dto.paymentMethod === PaymentMethod.CASH ? null : dto.bankAccountId,
        },
      });
      if (claim.count === 0) {
        const payroll = await tx.payroll.findFirst({ where: { id, organizationId } });
        if (!payroll) throw new NotFoundException('Payroll run not found');
        throw new BadRequestException(`Only POSTED payrolls can be marked paid (current status: ${payroll.status})`);
      }

      await this.postingRules.postPayrollPaid(organizationId, id, tx);

      return tx.payroll.findUniqueOrThrow({ where: { id } });
    });
  }

  // Reverses a POSTED or PAID payroll run: voids whichever of its journal
  // entries actually exist (postPayrollRun's bare id, and postPayrollPaid's
  // `:paid` id if the run got that far — voidAllForSource no-ops on
  // whichever one wasn't posted) and flips status to VOID. Mirrors
  // InvoiceService.voidInvoice's pattern — reverse + status flip, never a
  // delete, since a POSTED/PAID run already has real ledger history.
  async void(organizationId: string, id: string, reason: string, userId: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to void a payroll run');
    }

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.payroll.updateMany({
        where: { id, organizationId, status: { in: [PayrollStatus.POSTED, PayrollStatus.PAID] } },
        data: { status: PayrollStatus.VOID },
      });
      if (claim.count === 0) {
        const payroll = await tx.payroll.findFirst({ where: { id, organizationId } });
        if (!payroll) throw new NotFoundException('Payroll run not found');
        throw new BadRequestException(
          `Only POSTED or PAID payrolls can be voided (current status: ${payroll.status})`,
        );
      }

      await this.journal.voidAllForSource(
        organizationId,
        JournalSourceType.PAYROLL,
        this.postingRules.payrollJournalSourceIds(id),
        userId,
        `Payroll voided: ${reason.trim()}`,
        tx,
      );

      return tx.payroll.findUniqueOrThrow({ where: { id } });
    });
  }

  async remove(organizationId: string, id: string) {
    const payroll = await this.get(organizationId, id);
    if (payroll.status !== PayrollStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT payrolls can be deleted');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.payrollItemComponent.deleteMany({ where: { payrollItem: { payrollId: id } } });
      await tx.payrollItem.deleteMany({ where: { payrollId: id } });
      return tx.payroll.delete({ where: { id } });
    });
  }
}