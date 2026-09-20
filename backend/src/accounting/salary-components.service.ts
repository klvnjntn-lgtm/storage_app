import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalaryComponentTypeDto, UpdateSalaryComponentTypeDto } from './dto/salary-component.dto';

@Injectable()
export class SalaryComponentsService {
  constructor(private prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.salaryComponentType.findMany({
      where: { organizationId },
      include: { account: { select: { id: true, code: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async get(organizationId: string, id: string) {
    const component = await this.prisma.salaryComponentType.findFirst({
      where: { id, organizationId },
      include: { account: { select: { id: true, code: true, name: true } } },
    });
    if (!component) throw new NotFoundException('Salary component not found');
    return component;
  }

  async create(organizationId: string, dto: CreateSalaryComponentTypeDto) {
    this.assertConsistentDefaults(dto.isFixed, dto.defaultAmount, dto.defaultPercentage);
    if (dto.accountId) await this.assertAccountBelongsToOrg(organizationId, dto.accountId);

    const existing = await this.prisma.salaryComponentType.findUnique({
      where: { organizationId_name: { organizationId, name: dto.name.trim() } },
    });
    if (existing) {
      throw new BadRequestException(`A salary component named "${dto.name}" already exists`);
    }

    return this.prisma.salaryComponentType.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        type: dto.type,
        isTaxable: dto.isTaxable ?? false,
        isFixed: dto.isFixed,
        defaultAmount: dto.isFixed ? dto.defaultAmount : undefined,
        defaultPercentage: dto.isFixed ? undefined : dto.defaultPercentage,
        accountId: dto.accountId,
      },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateSalaryComponentTypeDto) {
    const current = await this.get(organizationId, id);
    const isFixed = dto.isFixed ?? current.isFixed;

    if (dto.defaultAmount !== undefined || dto.defaultPercentage !== undefined || dto.isFixed !== undefined) {
      this.assertConsistentDefaults(
        isFixed,
        dto.defaultAmount ?? (isFixed ? Number(current.defaultAmount ?? 0) : undefined),
        dto.defaultPercentage ?? (!isFixed ? Number(current.defaultPercentage ?? 0) : undefined),
      );
    }
    if (dto.accountId) await this.assertAccountBelongsToOrg(organizationId, dto.accountId);

    return this.prisma.salaryComponentType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.isTaxable !== undefined && { isTaxable: dto.isTaxable }),
        ...(dto.isFixed !== undefined && { isFixed: dto.isFixed }),
        ...(dto.defaultAmount !== undefined && { defaultAmount: dto.defaultAmount }),
        ...(dto.defaultPercentage !== undefined && { defaultPercentage: dto.defaultPercentage }),
        ...(dto.accountId !== undefined && { accountId: dto.accountId }),
      },
    });
  }

  private assertConsistentDefaults(isFixed: boolean, amount?: number, percentage?: number) {
    if (isFixed && (amount === undefined || amount === null)) {
      throw new BadRequestException('defaultAmount is required when isFixed is true');
    }
    if (!isFixed && (percentage === undefined || percentage === null)) {
      throw new BadRequestException('defaultPercentage is required when isFixed is false');
    }
  }

  private async assertAccountBelongsToOrg(organizationId: string, accountId: string) {
    const account = await this.prisma.chartOfAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) throw new BadRequestException('accountId does not refer to a valid account for this organization');
    if (account.type !== AccountType.LIABILITY) {
      throw new BadRequestException(
        `Account "${account.name}" is type ${account.type}, not LIABILITY — a deduction's payable account must be a liability`,
      );
    }
  }
}