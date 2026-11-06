import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ensureDefaultBranch } from './resolve-branch';

type TaxIdentity = { legalName?: string | null; npwp?: string | null; nitku?: string | null };

// Digits only, so "01.234.567.8-901.000" and its plain form compare equal.
// undefined = not being changed; empty = cleared.
function taxNumber(value: string | null | undefined, lengths: number[], message: string) {
  if (value === undefined) return undefined;
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (!lengths.includes(digits.length)) throw new BadRequestException(message);
  return digits;
}

function taxFields(dto: TaxIdentity) {
  const npwp = taxNumber(dto.npwp, [15, 16], 'NPWP must be 15 or 16 digits');
  const nitku = taxNumber(dto.nitku, [22], 'NITKU must be 22 digits');
  return {
    ...(dto.legalName !== undefined && { legalName: dto.legalName?.trim() || null }),
    ...(npwp !== undefined && { npwp }),
    ...(nitku !== undefined && { nitku }),
  };
}

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

  async create(organizationId: string, dto: { name: string; address?: string | null; phone?: string | null } & TaxIdentity) {
    const tax = taxFields(dto);
    await ensureDefaultBranch(this.prisma, organizationId);
    return this.prisma.branch.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        address: dto.address?.trim() || null,
        phone: dto.phone?.trim() || null,
        ...tax,
      },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: { name?: string; address?: string | null; phone?: string | null } & TaxIdentity,
  ) {
    const tax = taxFields(dto);
    await this.getOrThrow(organizationId, id);
    return this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.address !== undefined && { address: dto.address?.trim() || null }),
        ...(dto.phone !== undefined && { phone: dto.phone?.trim() || null }),
        ...tax,
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
