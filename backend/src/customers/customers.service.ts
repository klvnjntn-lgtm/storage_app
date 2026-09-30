// src/customers/customers.service.ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerLocationService } from './customer-location.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from './dto/customer-address.dto';

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private locations: CustomerLocationService,
  ) {}

  async list(organizationId: string, search?: string) {
    return this.prisma.customer.findMany({
      where: {
        organizationId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async get(organizationId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async getWithInvoices(organizationId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId },
      include: {
        addresses: { orderBy: { label: 'asc' } },
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
          },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

// src/customers/customers.service.ts — only create() and update() changed from last version
async create(organizationId: string, dto: CreateCustomerDto) {
  return this.prisma.customer.create({ data: { ...dto, organizationId } });
}

async update(organizationId: string, id: string, dto: UpdateCustomerDto) {
  await this.get(organizationId, id);
  return this.prisma.customer.update({
    where: { id, organizationId },
    data: dto,
  });
}

async remove(organizationId: string, id: string) {
  await this.get(organizationId, id);

  const [invoiceCount, quotationCount, orderCount, deliveryCount, vehicleCount] = await Promise.all([
    this.prisma.invoice.count({ where: { customerId: id, organizationId } }),
    this.prisma.salesQuotation.count({ where: { customerId: id, organizationId } }),
    this.prisma.salesOrder.count({ where: { customerId: id, organizationId } }),
    this.prisma.deliveryOrder.count({ where: { customerId: id, organizationId } }),
    this.prisma.vehicle.count({ where: { customerId: id, organizationId } }),
  ]);

  const blockers: string[] = [];
  if (invoiceCount > 0) blockers.push(`${invoiceCount} invoice(s)`);
  if (quotationCount > 0) blockers.push(`${quotationCount} quotation(s)`);
  if (orderCount > 0) blockers.push(`${orderCount} sales order(s)`);
  if (deliveryCount > 0) blockers.push(`${deliveryCount} delivery order(s)`);
  if (vehicleCount > 0) blockers.push(`${vehicleCount} vehicle(s)`);

  if (blockers.length > 0) {
    throw new ConflictException(`Cannot delete: ${blockers.join(', ')} reference this customer`);
  }

  const photoKeys = await this.locations.storageKeys(organizationId, id);
  await this.prisma.customer.delete({ where: { id, organizationId } });
  for (const key of photoKeys) await this.locations.deleteFile(key);
}

  // ─── Saved delivery addresses ───────────────────────────────────────

  async listAddresses(organizationId: string, customerId: string) {
    await this.get(organizationId, customerId);
    return this.prisma.customerAddress.findMany({
      where: { organizationId, customerId },
      orderBy: { label: 'asc' },
    });
  }

  async createAddress(
    organizationId: string,
    customerId: string,
    dto: CreateCustomerAddressDto,
  ) {
    await this.get(organizationId, customerId);
    return this.prisma.customerAddress.create({
      data: {
        organizationId,
        customerId,
        label: dto.label.trim(),
        address: dto.address?.trim() || null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
      },
    });
  }

  async updateAddress(
    organizationId: string,
    customerId: string,
    addressId: string,
    dto: UpdateCustomerAddressDto,
  ) {
    await this.getAddress(organizationId, customerId, addressId);
    return this.prisma.customerAddress.update({
      where: { id: addressId },
      data: {
        label: dto.label?.trim(),
        address: dto.address !== undefined ? dto.address.trim() || null : undefined,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });
  }

  async removeAddress(
    organizationId: string,
    customerId: string,
    addressId: string,
  ) {
    await this.getAddress(organizationId, customerId, addressId);
    // Existing DeliveryOrders keep their own address/pin snapshot, so
    // deleting a saved address never changes a shipment already made.
    await this.prisma.customerAddress.delete({ where: { id: addressId } });
  }

  private async getAddress(
    organizationId: string,
    customerId: string,
    addressId: string,
  ) {
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId, organizationId },
    });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }
}