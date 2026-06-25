import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoryService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string) {
    const rows = await this.prisma.category.findMany({
      where: { organizationId: orgId },                    // 🔒
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });

    return rows.map(({ _count, ...rest }) => ({
      ...rest,
      usageCount: _count.products,
    }));
  }

  async create(orgId: string, name: string) {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('Category name is required');
    }

    const existing = await this.prisma.category.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' }, organizationId: orgId }, // 🔒
    });
    if (existing) {
      throw new BadRequestException('Category already exists');
    }

    return this.prisma.category.create({
      data: { name: trimmed, organizationId: orgId },      // 🔒
    });
  }

  async rename(orgId: string, id: string, name: string) {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('Category name is required');
    }

    const existing = await this.prisma.category.findFirst({
      where: { id, organizationId: orgId },                // 🔒
    });
    if (!existing) throw new NotFoundException('Category not found');

    const clash = await this.prisma.category.findFirst({
      where: {
        id: { not: id },
        name: { equals: trimmed, mode: 'insensitive' },
        organizationId: orgId,                             // 🔒
      },
    });
    if (clash) {
      throw new BadRequestException(
        'Another category already has that name — merge them instead of renaming.',
      );
    }

    return this.prisma.category.update({
      where: { id },
      data: { name: trimmed },
    });
  }

  async merge(orgId: string, sourceIds: string[], targetId: string) {
    const uniqueSourceIds = Array.from(new Set(sourceIds));

    if (uniqueSourceIds.includes(targetId)) {
      throw new BadRequestException('targetId cannot also be a sourceId');
    }
    if (uniqueSourceIds.length === 0) {
      throw new BadRequestException('sourceIds must contain at least one id');
    }

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.category.findFirst({
        where: { id: targetId, organizationId: orgId },    // 🔒
      });
      if (!target) throw new NotFoundException(`Category ${targetId} not found`);

      const sources = await tx.category.findMany({
        where: { id: { in: uniqueSourceIds }, organizationId: orgId }, // 🔒
      });
      if (sources.length !== uniqueSourceIds.length) {
        throw new NotFoundException('One or more source categories not found');
      }

      // Repoint products within this org only
      await tx.product.updateMany({
        where: {
          categoryId: { in: uniqueSourceIds },
          organizationId: orgId,                           // 🔒
        },
        data: { categoryId: targetId },
      });

      await tx.category.deleteMany({
        where: { id: { in: uniqueSourceIds }, organizationId: orgId }, // 🔒
      });

      return { mergedInto: targetId, removed: uniqueSourceIds };
    });
  }

  async delete(orgId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, organizationId: orgId },                // 🔒
    });
    if (!category) throw new BadRequestException('Category not found');

    const product = await this.prisma.product.findFirst({
      where: { categoryId: id, organizationId: orgId },    // 🔒
    });
    if (product) {
      throw new BadRequestException(
        'Cannot delete category with products — merge or reassign first',
      );
    }

    return this.prisma.category.delete({ where: { id } });
  }
}