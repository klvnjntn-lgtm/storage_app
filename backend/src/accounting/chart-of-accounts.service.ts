import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/accounting.dto';

@Injectable()
export class ChartOfAccountsService {
  constructor(private prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.chartOfAccount.findMany({
      where: { organizationId },
      orderBy: { code: 'asc' },
    });
  }

  async create(organizationId: string, dto: CreateAccountDto) {
    if (dto.parentId) {
      const parent = await this.prisma.chartOfAccount.findFirst({
        where: { id: dto.parentId, organizationId },
      });
      if (!parent) {
        throw new BadRequestException('parentId does not refer to a valid account for this organization');
      }
      // Not a hard accounting rule everywhere, but catches the most common
      // mistake (nesting a liability under an asset, etc.) — a parent/child
      // pair should normally share the same top-level type.
      if (parent.type !== dto.type) {
        throw new BadRequestException(
          `Parent account "${parent.name}" is type ${parent.type} — child account type must match`,
        );
      }
    }

    try {
      return await this.prisma.chartOfAccount.create({
        data: {
          organizationId,
          code: dto.code,
          name: dto.name,
          type: dto.type,
          normalBalance: dto.normalBalance,
          parentId: dto.parentId,
          // systemKey intentionally omitted — custom accounts are never
          // auto-targeted by posting rules, only reachable by explicit
          // assignment (e.g. ExpenseCategory.accountId).
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(`Account code "${dto.code}" is already in use for this organization`);
      }
      throw err;
    }
  }

  // Rename, re-code, or archive an account. Deactivating a systemKey
  // account is blocked outright — AccountResolverService would then throw
  // on every future post that needs it (invoices, payments, everything),
  // which is loud rather than silently wrong, but there's no legitimate
  // reason to ever want that, so it's simpler to refuse it here than to
  // let someone discover it by breaking invoicing.
  async update(organizationId: string, id: string, dto: UpdateAccountDto) {
    const account = await this.prisma.chartOfAccount.findFirst({ where: { id, organizationId } });
    if (!account) throw new NotFoundException('Account not found');

    if (dto.isActive === false && account.systemKey) {
      throw new BadRequestException(
        `"${account.name}" is a system account (${account.systemKey}) — deactivating it would break every ` +
          `document type that posts to it. Deactivation is only available for custom accounts.`,
      );
    }

    try {
      return await this.prisma.chartOfAccount.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.code !== undefined && { code: dto.code }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(`Account code "${dto.code}" is already in use for this organization`);
      }
      throw err;
    }
  }
}