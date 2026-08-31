import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  // Confirms the customer exists AND belongs to this org before touching
  // any vehicle under it — same 404-not-leak pattern as before.
  private async getCustomerOrThrow(organizationId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  // Vehicle now carries its own organizationId column (Tier 1 migration),
  // so ownership is checked directly instead of joining through customer.
  // Faster (uses the organizationId index directly) and matches the
  // composite FK now enforced at the DB level.
  private async getVehicleOrThrow(organizationId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, organizationId },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  async listByCustomer(organizationId: string, customerId: string) {
    await this.getCustomerOrThrow(organizationId, customerId);
    return this.prisma.vehicle.findMany({
      where: { customerId, organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(organizationId: string, customerId: string, dto: CreateVehicleDto) {
    await this.getCustomerOrThrow(organizationId, customerId);
    return this.prisma.vehicle.create({
      data: { ...dto, customerId, organizationId },
    });
  }

async getWithInvoices(organizationId: string, vehicleId: string) {
  const vehicle = await this.prisma.vehicle.findFirst({
    where: { id: vehicleId, organizationId },
    include: {
      customer: { select: { id: true, name: true, companyName: true, phone: true } },
      invoices: {
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          amountPaid: true,
          paymentStatus: true,
          issuedAt: true,
          createdAt: true,
          odometer: true, // NEW — per-visit snapshot for the history view
          items: {
            select: {
              id: true,
              quantity: true,
              description: true,
              product: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!vehicle) throw new NotFoundException('Vehicle not found');
  return vehicle;
}
  async update(organizationId: string, vehicleId: string, dto: UpdateVehicleDto) {
    await this.getVehicleOrThrow(organizationId, vehicleId);
    return this.prisma.vehicle.update({ where: { id: vehicleId }, data: dto });
  }

  async remove(organizationId: string, vehicleId: string) {
    await this.getVehicleOrThrow(organizationId, vehicleId);
    // Safe to filter by vehicleId alone here — getVehicleOrThrow above
    // already proved this vehicleId belongs to this org, so an invoice
    // count on it can't leak or miscount across tenants.
    const invoiceCount = await this.prisma.invoice.count({ where: { vehicleId } });
    if (invoiceCount > 0) {
      throw new ConflictException(
        `Cannot delete: ${invoiceCount} invoice(s) reference this vehicle`,
      );
    }
    await this.prisma.vehicle.delete({ where: { id: vehicleId } });
  }

  async listAll(organizationId: string, search?: string) {
    return this.prisma.vehicle.findMany({
      where: {
        organizationId,
        ...(search
          ? {
              OR: [
                { plateNumber: { contains: search, mode: 'insensitive' } },
                { vehicleModel: { contains: search, mode: 'insensitive' } },
                { vin: { contains: search, mode: 'insensitive' } },
                { customer: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { customer: { select: { id: true, name: true, companyName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}