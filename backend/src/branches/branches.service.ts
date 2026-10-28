import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ensureDefaultBranch } from './resolve-branch';

// Branches of the business — what accounting splits by. See the Branch model.
@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  async list(organizationId: string, includeArchived = false) {
    await ensureDefaultBranch(this.prisma, organizationId);
    return this.prisma.branch.findMany({
      where: { organizationId, ...(!includeArchived && { archivedAt: null }) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(organizationId: string, dto: { name: string; address?: string | null; phone?: string | null }) {
    await ensureDefaultBranch(this.prisma, organizationId);
    return this.prisma.branch.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        address: dto.address?.trim() || null,
        phone: dto.phone?.trim() || null,
      },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: { name?: string; address?: string | null; phone?: string | null },
  ) {
    await this.getOrThrow(organizationId, id);
    return this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.address !== undefined && { address: dto.address?.trim() || null }),
        ...(dto.phone !== undefined && { phone: dto.phone?.trim() || null }),
      },
    });
  }

  // Archived, never deleted: history stays booked to it. The last active
  // branch can't go — every org keeps one.
  async archive(organizationId: string, id: string) {
    const branch = await this.getOrThrow(organizationId, id);
    if (branch.archivedAt) return branch;
    const active = await this.prisma.branch.count({ where: { organizationId, archivedAt: null } });
    if (active <= 1) throw new BadRequestException('The only branch can’t be archived');
    // Its staff would silently land in the first branch; move them first.
    const staff = await this.prisma.user.count({
      where: { organizationId, branchId: id, removedAt: null, role: { in: ['ADMIN', 'USER'] } },
    });
    if (staff > 0) throw new BadRequestException('Move this branch’s members to another branch first');
    return this.prisma.branch.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  async restore(organizationId: string, id: string) {
    await this.getOrThrow(organizationId, id);
    return this.prisma.branch.update({ where: { id }, data: { archivedAt: null } });
  }

  private async getOrThrow(organizationId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, organizationId } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }
}
