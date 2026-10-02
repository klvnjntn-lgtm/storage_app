import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureDefaultPriceLevel } from './default-price-level';
import { CreatePriceLevelDto, UpdatePriceLevelDto } from './dto/price-level.dto';

const SELECT = { id: true, name: true, isDefault: true, sortOrder: true, archivedAt: true } as const;

@Injectable()
export class PriceLevelService {
  constructor(private prisma: PrismaService) {}

  // Default first, then the admin's order. Archived levels are included on
  // request so old documents can still show where a price came from.
  async list(organizationId: string, includeArchived = false) {
    await ensureDefaultPriceLevel(this.prisma, organizationId);
    return this.prisma.priceLevel.findMany({
      where: { organizationId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: SELECT,
    });
  }

  async create(organizationId: string, dto: CreatePriceLevelDto) {
    await ensureDefaultPriceLevel(this.prisma, organizationId);
    const name = dto.name.trim();
    // Re-adding an archived name brings that level (and its prices) back.
    const archived = await this.prisma.priceLevel.findFirst({
      where: { organizationId, name, archivedAt: { not: null } },
    });
    if (archived) {
      return this.prisma.priceLevel.update({ where: { id: archived.id }, data: { archivedAt: null }, select: SELECT });
    }
    const last = await this.prisma.priceLevel.aggregate({ where: { organizationId }, _max: { sortOrder: true } });
    try {
      return await this.prisma.priceLevel.create({
        data: { organizationId, name, sortOrder: (last._max.sortOrder ?? 0) + 1 },
        select: SELECT,
      });
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  async update(organizationId: string, id: string, dto: UpdatePriceLevelDto) {
    const level = await this.getOrThrow(organizationId, id);
    if (dto.archived === true && level.isDefault) {
      throw new BadRequestException('The default price level cannot be archived');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.archived === true) {
          // Customers on this level go back to the default level.
          await tx.customer.updateMany({ where: { organizationId, priceLevelId: id }, data: { priceLevelId: null } });
        }
        return tx.priceLevel.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name.trim() }),
            ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
            ...(dto.archived !== undefined && { archivedAt: dto.archived ? new Date() : null }),
          },
          select: SELECT,
        });
      });
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  private async getOrThrow(organizationId: string, id: string) {
    const level = await this.prisma.priceLevel.findFirst({ where: { id, organizationId } });
    if (!level) throw new NotFoundException('Price level not found');
    return level;
  }

  private mapUnique(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('A price level with this name already exists');
    }
    return e;
  }
}
