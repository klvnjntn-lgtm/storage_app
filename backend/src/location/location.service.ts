import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LocationService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string) {
    const rows = await this.prisma.location.findMany({
      where: { organizationId: orgId },                    // 🔒
      orderBy: { name: 'asc' },
      include: { _count: { select: { stocks: true } } },
    });

    return rows.map(({ _count, ...rest }) => ({
      ...rest,
      usageCount: _count.stocks,
    }));
  }

  async create(orgId: string, name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('Location name is required');
    }

    const normalized = name.trim();

    // Unique per org, not globally — two orgs can both have "Warehouse A"
    const existing = await this.prisma.location.findFirst({
      where: { name: normalized, organizationId: orgId },  // 🔒
    });

    if (existing) {
      throw new BadRequestException('Location already exists');
    }

    return this.prisma.location.create({
      data: {
        id: `${orgId}_${normalized.toLowerCase().replace(/\s+/g, '_')}`,
        name: normalized,
        organizationId: orgId,                             // 🔒
      },
    });
  }

  async rename(orgId: string, id: string, name: string) {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('Location name is required');
    }

    const existing = await this.prisma.location.findFirst({
      where: { id, organizationId: orgId },                // 🔒
    });
    if (!existing) throw new NotFoundException('Location not found');

    // Check for name clash within this org only
    const clash = await this.prisma.location.findFirst({
      where: { name: trimmed, organizationId: orgId },     // 🔒
    });
    if (clash && clash.id !== id) {
      throw new BadRequestException(
        'Another location already has that name — merge them instead of renaming.',
      );
    }

    return this.prisma.location.update({
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
      // All locations must belong to this org
      const target = await tx.location.findFirst({
        where: { id: targetId, organizationId: orgId },    // 🔒
      });
      if (!target) throw new NotFoundException(`Location ${targetId} not found`);

      const sources = await tx.location.findMany({
        where: {
          id: { in: uniqueSourceIds },
          organizationId: orgId,                           // 🔒
        },
      });
      if (sources.length !== uniqueSourceIds.length) {
        throw new NotFoundException('One or more source locations not found');
      }

      // Stock has @@unique([productId, locationId]) — sum into target rows
      const sourceStocks = await tx.stock.findMany({
        where: {
          locationId: { in: uniqueSourceIds },
          organizationId: orgId,                           // 🔒
        },
      });

      const qtyByProduct = new Map<string, number>();
      for (const s of sourceStocks) {
        qtyByProduct.set(s.productId, (qtyByProduct.get(s.productId) ?? 0) + s.quantity);
      }

      for (const [productId, qty] of qtyByProduct) {
        await tx.stock.upsert({
          where: {
            productId_locationId: { productId, locationId: targetId },
          },
          update: { quantity: { increment: qty } },
          create: {
            productId,
            locationId: targetId,
            quantity: qty,
            organizationId: orgId,                         // 🔒
          },
        });
      }

      await tx.stock.deleteMany({
        where: {
          locationId: { in: uniqueSourceIds },
          organizationId: orgId,                           // 🔒
        },
      });

      // Repoint event FKs — scoped to org so we don't touch other orgs' events
      await tx.event.updateMany({
        where: {
          fromLocationId: { in: uniqueSourceIds },
          organizationId: orgId,                           // 🔒
        },
        data: { fromLocationId: targetId },
      });
      await tx.event.updateMany({
        where: {
          toLocationId: { in: uniqueSourceIds },
          organizationId: orgId,                           // 🔒
        },
        data: { toLocationId: targetId },
      });

      await tx.location.deleteMany({
        where: {
          id: { in: uniqueSourceIds },
          organizationId: orgId,                           // 🔒
        },
      });

      return { mergedInto: targetId, removed: uniqueSourceIds };
    });
  }

  async delete(orgId: string, id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, organizationId: orgId },                // 🔒
    });
    if (!location) throw new BadRequestException('Location not found');

    const stock = await this.prisma.stock.findFirst({
      where: { locationId: id, organizationId: orgId },    // 🔒
    });
    if (stock) {
      throw new BadRequestException('Cannot delete location with stock');
    }

    return this.prisma.location.delete({ where: { id } });
  }
}