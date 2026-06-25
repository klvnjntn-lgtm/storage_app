import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BrandService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string) {
    const rows = await this.prisma.brand.findMany({
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
    const normalized = name?.trim();
    if (!normalized) {
      throw new BadRequestException('Brand name is required');
    }

    // Unique per org — two orgs can both have "Toyota"
    const existing = await this.prisma.brand.findFirst({
      where: { name: { equals: normalized, mode: 'insensitive' }, organizationId: orgId }, // 🔒
    });
    if (existing) {
      throw new BadRequestException('Brand already exists');
    }

    const id = `${orgId}_${normalized.toLowerCase().replace(/\s+/g, '_')}`;

    return this.prisma.brand.create({
      data: { id, name: normalized, organizationId: orgId }, // 🔒
    });
  }

  async rename(orgId: string, id: string, name: string) {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('Brand name is required');
    }

    const existing = await this.prisma.brand.findFirst({
      where: { id, organizationId: orgId },                // 🔒
    });
    if (!existing) throw new NotFoundException('Brand not found');

    const clash = await this.prisma.brand.findFirst({
      where: {
        id: { not: id },
        name: { equals: trimmed, mode: 'insensitive' },
        organizationId: orgId,                             // 🔒
      },
    });
    if (clash) {
      throw new BadRequestException(
        'Another brand already has that name — merge them instead of renaming.',
      );
    }

    return this.prisma.brand.update({
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
      const target = await tx.brand.findFirst({
        where: { id: targetId, organizationId: orgId },    // 🔒
      });
      if (!target) throw new NotFoundException(`Brand ${targetId} not found`);

      const sources = await tx.brand.findMany({
        where: { id: { in: uniqueSourceIds }, organizationId: orgId }, // 🔒
      });
      if (sources.length !== uniqueSourceIds.length) {
        throw new NotFoundException('One or more source brands not found');
      }

      await tx.product.updateMany({
        where: { brandId: { in: uniqueSourceIds }, organizationId: orgId }, // 🔒
        data: { brandId: targetId },
      });

      await tx.brand.deleteMany({
        where: { id: { in: uniqueSourceIds }, organizationId: orgId }, // 🔒
      });

      return { mergedInto: targetId, removed: uniqueSourceIds };
    });
  }

  async delete(orgId: string, id: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { id, organizationId: orgId },                // 🔒
    });
    if (!brand) throw new BadRequestException('Brand not found');

    const product = await this.prisma.product.findFirst({
      where: { brandId: id, organizationId: orgId },       // 🔒
    });
    if (product) {
      throw new BadRequestException(
        'Cannot delete brand with products — merge or reassign first',
      );
    }

    return this.prisma.brand.delete({ where: { id } });
  }
}