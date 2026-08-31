// src/location/location.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MAX_NAME_LENGTH = 100;

@Injectable()
export class LocationService {
  constructor(private prisma: PrismaService) {}

  async findAll(organizationId: string) {
    const rows = await this.prisma.location.findMany({
      where: { organizationId, archivedAt: null }, // hide archived by default
      orderBy: { name: 'asc' },
      include: { _count: { select: { stocks: true } } },
    });

    return rows.map(({ _count, ...rest }) => ({
      ...rest,
      usageCount: _count.stocks,
    }));
  }

  async create(organizationId: string, name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('Location name is required');
    }

    const normalized = name.trim();

    if (normalized.length > MAX_NAME_LENGTH) {
      throw new BadRequestException(
        `Location name cannot exceed ${MAX_NAME_LENGTH} characters`,
      );
    }

    const id = `${organizationId}_${normalized.toLowerCase().replace(/\s+/g, '_')}`;

    // Unique per org, not globally — two orgs can both have "Warehouse A"
    const existingActive = await this.prisma.location.findFirst({
      where: { name: normalized, organizationId, archivedAt: null },
    });
    if (existingActive) {
      throw new BadRequestException('Location already exists');
    }

    // The id is deterministically derived from name — an archived location
    // with the same name would produce the same id even though it's hidden
    // from the active-name check above.
    const existingArchived = await this.prisma.location.findFirst({
      where: { id, organizationId, archivedAt: { not: null } },
    });
    if (existingArchived) {
      throw new BadRequestException(
        'An archived location already has this name. Restore it instead of creating a new one, or choose a different name.',
      );
    }

    return this.prisma.location.create({
      data: { id, name: normalized, organizationId },
    });
  }

  async rename(organizationId: string, id: string, name: string) {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('Location name is required');
    }

    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new BadRequestException(
        `Location name cannot exceed ${MAX_NAME_LENGTH} characters`,
      );
    }

    const existing = await this.prisma.location.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Location not found');

    // Check for name clash within this org only (ignore archived locations)
    const clash = await this.prisma.location.findFirst({
      where: { name: trimmed, organizationId, archivedAt: null },
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

  /**
   * Merge sourceIds into targetId.
   *
   * Audit philosophy: we do NOT rewrite event history. Historical MOVE
   * events keep pointing at the original source location IDs — a merge
   * is a present-day reorganization, not a retroactive claim that stock
   * always lived at the target. So event.fromLocationId / toLocationId
   * are left untouched here.
   *
   * Sources are archived (soft-deleted), not hard-deleted, so the FK on
   * old events stays valid and `findAll` just needs to filter them out.
   */
  async merge(organizationId: string, sourceIds: string[], targetId: string) {
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
        where: { id: targetId, organizationId },
      });
      if (!target) throw new NotFoundException(`Location ${targetId} not found`);

      const sources = await tx.location.findMany({
        where: {
          id: { in: uniqueSourceIds },
          organizationId,
        },
      });
      if (sources.length !== uniqueSourceIds.length) {
        throw new NotFoundException('One or more source locations not found');
      }

      // Stock has @@unique([productId, locationId]) — sum into target rows
      const sourceStocks = await tx.stock.findMany({
        where: {
          locationId: { in: uniqueSourceIds },
          organizationId,
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
            organizationId,
          },
        });
      }

      await tx.stock.deleteMany({
        where: {
          locationId: { in: uniqueSourceIds },
          organizationId,
        },
      });

      // NOTE: event.fromLocationId / toLocationId are deliberately left
      // pointing at the source locations. Rewriting them to targetId would
      // make a past "A → B" move read as "C → C" after A and B merge into
      // C, which never happened. History stays accurate; only current
      // stock moves.

      // Soft-delete the sources instead of hard-deleting, so old events'
      // FKs stay valid and the location record (name, id) is still
      // resolvable for anyone reading that history later.
      await tx.location.updateMany({
        where: {
          id: { in: uniqueSourceIds },
          organizationId,
        },
        data: { archivedAt: new Date() },
      });

      return { mergedInto: targetId, archived: uniqueSourceIds };
    });
  }

  /**
   * Delete only if the location is truly unused. Stock-only checks let a
   * location with zero stock but hundreds of historical events get
   * deleted, leaving a dangling/inconsistent FK depending on the
   * ON DELETE behavior. Anything with history should be archived via
   * merge instead — delete is reserved for locations that were never
   * really used.
   */
  async delete(organizationId: string, id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, organizationId },
    });
    if (!location) throw new BadRequestException('Location not found');

    // Session has no direct location reference — it only relates through
    // Event[], so the event check below already covers any location that
    // was touched as part of a session (e.g. a PICK/PACK/SHIP stage).
    const [stock, event] = await Promise.all([
      this.prisma.stock.findFirst({
        where: { locationId: id, organizationId },
      }),
      this.prisma.event.findFirst({
        where: {
          organizationId,
          OR: [{ fromLocationId: id }, { toLocationId: id }],
        },
      }),
    ]);

    if (stock || event) {
      throw new BadRequestException(
        'Location has stock or history and cannot be deleted — merge it into another location instead.',
      );
    }

    return this.prisma.location.delete({ where: { id } });
  }
}