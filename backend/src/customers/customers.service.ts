// src/customers/customers.service.ts
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerLocationService } from './customer-location.service';
import { manualPinData } from './customer-pin-backfill';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ImportCustomerRowDto } from './dto/import-customers.dto';
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
  await this.assertPriceLevel(organizationId, dto.priceLevelId);
  return this.prisma.customer.create({
    data: { ...dto, organizationId, ...manualPinData(dto.latitude, dto.longitude) },
  });
}

// Bulk create from a spreadsheet. Never updates an existing customer: a
// row that matches one (same NPWP, or same name + phone + address) is
// skipped and reported, as is a repeat of an earlier row in the file.
// A batch's accepted rows are written in one transaction. Because matches
// are skipped, re-running a file after a failed batch is safe: rows that
// already went in come back as DUPLICATE_EXISTING. `row` in skipped is
// the index into `rows`.
async importMany(organizationId: string, rows: ImportCustomerRowDto[]) {
  const clean = (s?: string) => s?.trim().replace(/\s+/g, ' ') || undefined;
  const npwpKey = (s?: string) => s?.replace(/\D/g, '') || null;
  const identityKey = (c: { name: string; phone?: string | null; address?: string | null }) =>
    [c.name.trim().toLowerCase(), c.phone?.replace(/\D/g, '') ?? '', c.address?.trim().replace(/\s+/g, ' ').toLowerCase() ?? ''].join('|');

  const [existing, levels] = await Promise.all([
    this.prisma.customer.findMany({
      where: { organizationId },
      select: { name: true, phone: true, address: true, npwp: true },
    }),
    this.prisma.priceLevel.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, name: true },
    }),
  ]);
  const seenNpwp = new Set(existing.map((c) => npwpKey(c.npwp ?? undefined)).filter(Boolean));
  const seenIdentity = new Set(existing.map(identityKey));
  const fileNpwp = new Set<string>();
  const fileIdentity = new Set<string>();
  const levelByName = new Map(levels.map((l) => [l.name.trim().toLowerCase(), l.id]));

  type Reason = 'DUPLICATE_NPWP' | 'DUPLICATE_EXISTING' | 'DUPLICATE_IN_FILE' | 'UNKNOWN_PRICE_LEVEL' | 'INCOMPLETE_LOCATION';
  const skipped: { row: number; name: string; reason: Reason }[] = [];
  const data: Prisma.CustomerCreateManyInput[] = [];

  rows.forEach((r, row) => {
    const name = clean(r.name)!;
    const phone = clean(r.phone);
    const address = clean(r.address);
    const npwp = clean(r.npwp);
    const skip = (reason: Reason) => skipped.push({ row, name, reason });

    const nKey = npwpKey(npwp);
    const iKey = identityKey({ name, phone, address });
    if (nKey && fileNpwp.has(nKey)) return skip('DUPLICATE_IN_FILE');
    if (fileIdentity.has(iKey)) return skip('DUPLICATE_IN_FILE');
    if (nKey && seenNpwp.has(nKey)) return skip('DUPLICATE_NPWP');
    if (seenIdentity.has(iKey)) return skip('DUPLICATE_EXISTING');
    if ((r.latitude == null) !== (r.longitude == null)) return skip('INCOMPLETE_LOCATION');

    let priceLevelId: string | undefined;
    const levelName = clean(r.priceLevel);
    if (levelName) {
      priceLevelId = levelByName.get(levelName.toLowerCase());
      if (!priceLevelId) return skip('UNKNOWN_PRICE_LEVEL');
    }

    if (nKey) fileNpwp.add(nKey);
    fileIdentity.add(iKey);
    data.push({
      organizationId,
      name,
      companyName: clean(r.companyName),
      phone,
      address,
      npwp,
      ...manualPinData(r.latitude, r.longitude),
      deliveryNotes: r.deliveryNotes?.trim() || undefined,
      priceLevelId,
    });
  });

  if (data.length > 0) {
    try {
      await this.prisma.$transaction([this.prisma.customer.createMany({ data })]);
    } catch (err) {
      // Someone saved a customer with one of these NPWPs mid-import.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A customer with one of these NPWPs was just added — run the import again');
      }
      throw err;
    }
  }

  return { created: data.length, skipped };
}

async update(organizationId: string, id: string, dto: UpdateCustomerDto) {
  await this.get(organizationId, id);
  await this.assertPriceLevel(organizationId, dto.priceLevelId);
  return this.prisma.customer.update({
    where: { id, organizationId },
    data: { ...dto, ...manualPinData(dto.latitude, dto.longitude) },
  });
}

// The FK alone would accept another org's level id.
private async assertPriceLevel(organizationId: string, priceLevelId?: string | null) {
  if (!priceLevelId) return;
  const level = await this.prisma.priceLevel.findFirst({
    where: { id: priceLevelId, organizationId, archivedAt: null },
    select: { id: true },
  });
  if (!level) throw new BadRequestException('Price level not found');
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
        ...manualPinData(dto.latitude ?? null, dto.longitude ?? null),
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
        ...manualPinData(dto.latitude, dto.longitude),
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