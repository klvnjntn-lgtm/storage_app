import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { SetEmployeeComponentsDto } from './dto/salary-component.dto';

const MAX_STRING_LENGTH = 200;

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  async list(organizationId: string, includeArchived = false) {
    return this.prisma.employee.findMany({
      where: {
        organizationId,
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async get(organizationId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, organizationId },
      include: {
        salaryComponents: { include: { component: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async create(organizationId: string, dto: CreateEmployeeDto) {
    this.assertStringLength('name', dto.name);
    if (dto.position) this.assertStringLength('position', dto.position);

    return this.prisma.employee.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        position: dto.position?.trim(),
        nik: dto.nik?.trim(),
        bankName: dto.bankName?.trim(),
        bankAccountNumber: dto.bankAccountNumber?.trim(),
        baseSalary: dto.baseSalary,
      },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateEmployeeDto) {
    await this.get(organizationId, id);

    if (dto.name !== undefined) this.assertStringLength('name', dto.name);
    if (dto.position !== undefined) this.assertStringLength('position', dto.position);

    return this.prisma.employee.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.position !== undefined && { position: dto.position.trim() }),
        ...(dto.nik !== undefined && { nik: dto.nik.trim() }),
        ...(dto.bankName !== undefined && { bankName: dto.bankName.trim() }),
        ...(dto.bankAccountNumber !== undefined && {
          bankAccountNumber: dto.bankAccountNumber.trim(),
        }),
        ...(dto.baseSalary !== undefined && { baseSalary: dto.baseSalary }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async archive(organizationId: string, id: string) {
    await this.get(organizationId, id);
    return this.prisma.employee.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false },
    });
  }

  // Full replace of the employee's component assignments.
  async setComponents(organizationId: string, employeeId: string, dto: SetEmployeeComponentsDto) {
    await this.get(organizationId, employeeId);

    const componentIds = dto.components.map((c) => c.componentId);
    if (new Set(componentIds).size !== componentIds.length) {
      throw new BadRequestException('Duplicate componentId in components list');
    }

    if (componentIds.length > 0) {
      const found = await this.prisma.salaryComponentType.findMany({
        where: { id: { in: componentIds }, organizationId },
        select: { id: true },
      });
      if (found.length !== componentIds.length) {
        throw new BadRequestException('One or more componentId values are invalid for this organization');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.employeeSalaryComponent.deleteMany({ where: { employeeId } });
      if (dto.components.length === 0) return [];
      return Promise.all(
        dto.components.map((c) =>
          tx.employeeSalaryComponent.create({
            data: {
              employeeId,
              componentId: c.componentId,
              amount: c.amount,
              percentage: c.percentage,
            },
          }),
        ),
      );
    });
  }

  private assertStringLength(field: string, value: string) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${field} must be a non-empty string`);
    }
    if (value.length > MAX_STRING_LENGTH) {
      throw new BadRequestException(`${field} cannot exceed ${MAX_STRING_LENGTH} characters`);
    }
  }
}