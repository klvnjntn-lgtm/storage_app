import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@Injectable()
export class SupplierService {
  constructor(private prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateSupplierDto) {
    return this.prisma.supplier.create({
      data: { organizationId, ...dto },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateSupplierDto) {
    await this.getOneOrThrow(organizationId, id);
    return this.prisma.supplier.update({
      where: { id },
      data: dto,
    });
  }

  async list(
    organizationId: string,
    filters: { search?: string; isActive?: boolean; page?: number; pageSize?: number },
  ) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 20;

    const searchTerm = filters.search?.trim();
    const where = {
      organizationId,
      isActive: filters.isActive,
      ...(searchTerm
        ? {
            OR: [
              { name: { contains: searchTerm, mode: 'insensitive' as const } },
              { phone: { contains: searchTerm, mode: 'insensitive' as const } },
              { email: { contains: searchTerm, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async getOne(organizationId: string, id: string) {
    return this.getOneOrThrow(organizationId, id);
  }

  // Suppliers with purchase history shouldn't be hard-deleted — same
  // reasoning as why invoices get voided rather than removed. Deactivate
  // instead so past POs still resolve their supplierId.
  async deactivate(organizationId: string, id: string) {
    await this.getOneOrThrow(organizationId, id);
    return this.prisma.supplier.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async delete(organizationId: string, id: string) {
    await this.getOneOrThrow(organizationId, id);
    const poCount = await this.prisma.purchaseOrder.count({
      where: { organizationId, supplierId: id },
    });
    if (poCount > 0) {
      throw new BadRequestException(
        'This supplier has purchase orders on record — deactivate instead of deleting',
      );
    }
    return this.prisma.supplier.delete({ where: { id } });
  }

  private async getOneOrThrow(organizationId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({ where: { id, organizationId } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }
}