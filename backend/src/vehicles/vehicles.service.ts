import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { normalizePlate } from '../lib/plate';

const SEARCH_RESULT_LIMIT = 8;
const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 50;

// 0 = plate starts with the query, 1 = plate contains it elsewhere,
// 2 = matched on model/VIN/customer name instead. Lower sorts first.
function rankSearchResult(v: { plateNumber: string }, normalizedPlate: string): number {
  if (normalizedPlate.length === 0) return 2;
  const platePlate = normalizePlate(v.plateNumber);
  if (platePlate.startsWith(normalizedPlate)) return 0;
  if (platePlate.includes(normalizedPlate)) return 1;
  return 2;
}

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

  // Turns a Prisma unique-constraint violation (P2002) into a message the
  // frontend can actually show, instead of an unhandled 500. Prisma's
  // error.meta.target lists which column(s) collided — use that to pick
  // the right wording rather than a generic "already exists".
  private mapUniqueConstraintError(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined) ?? [];
      if (target.includes('vin')) {
        return new ConflictException('This VIN is already registered to another vehicle.');
      }
      if (target.includes('plateNumber')) {
        return new ConflictException('This plate number is already registered for this customer.');
      }
      return new ConflictException('A vehicle with this information already exists.');
    }
    return err as Error;
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
    try {
      return await this.prisma.vehicle.create({
        data: {
          ...dto,
          customerId,
          organizationId,
          // Kept in sync with plateNumber here rather than trusted from the
          // DTO — never let a caller set this directly.
          plateNormalized: normalizePlate(dto.plateNumber),
        },
      });
    } catch (err) {
      throw this.mapUniqueConstraintError(err);
    }
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
            odometer: true, // per-visit snapshot for the history view
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
    try {
      return await this.prisma.vehicle.update({
        where: { id: vehicleId },
        data: {
          ...dto,
          // Only recompute if plateNumber is actually part of this update —
          // an UpdateVehicleDto that touches odometer/vin shouldn't force a
          // plateNormalized write off `undefined`.
          ...(dto.plateNumber ? { plateNormalized: normalizePlate(dto.plateNumber) } : {}),
        },
      });
    } catch (err) {
      throw this.mapUniqueConstraintError(err);
    }
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

  // ── Vehicle Lookup (/vehicles/search) ─────────────────────────────────

  // Lightweight, debounced-typeahead search. Selects only what the
  // dropdown needs — no invoices, no full customer object — since this
  // fires on every keystroke. Matches on the SAME fields as listAll()
  // (plate, model, VIN, customer name), except plate matching goes
  // through plateNormalized so "BP 1234", "bp1234", "BP-1234" all match
  // regardless of formatting — the other fields use plain
  // case-insensitive contains, same as listAll().
  async search(organizationId: string, rawQuery: string) {
    const trimmed = rawQuery.trim();
    if (trimmed.length === 0) return [];

    const normalizedPlate = normalizePlate(trimmed);

    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        organizationId,
        OR: [
          ...(normalizedPlate.length > 0 ? [{ plateNormalized: { contains: normalizedPlate } }] : []),
          { vehicleModel: { contains: trimmed, mode: 'insensitive' as const } },
          { vin: { contains: trimmed, mode: 'insensitive' as const } },
          { customer: { name: { contains: trimmed, mode: 'insensitive' as const } } },
        ],
      },
      select: {
        id: true,
        plateNumber: true,
        vehicleModel: true,
        customer: { select: { name: true } },
      },
      take: SEARCH_RESULT_LIMIT,
    });

    // Rank plate matches above model/VIN/customer-name matches, and among
    // plate matches, rank "starts with" above "contains" — so typing a
    // plate prefix surfaces that vehicle first even if its model or
    // customer name happens to also contain the query text.
    return vehicles
      .map((v) => ({
        id: v.id,
        plateNumber: v.plateNumber,
        vehicleModel: v.vehicleModel,
        customerName: v.customer.name,
      }))
      .sort((a, b) => rankSearchResult(a, normalizedPlate) - rankSearchResult(b, normalizedPlate));
  }

  // Exact-match lookup for Enter-to-confirm. Separate from search() so the
  // frontend can tell "here are candidates" apart from "this plate exists,
  // go straight to it." organizationId-scoped, so no cross-tenant leak.
  async findByExactPlate(organizationId: string, rawQuery: string) {
    const q = normalizePlate(rawQuery);
    if (q.length === 0) return null;

    return this.prisma.vehicle.findFirst({
      where: { organizationId, plateNormalized: q },
      select: { id: true, plateNumber: true },
    });
  }

  // Lightweight summary — same shape as getWithInvoices minus the
  // invoices array, so selecting a vehicle in the lookup doesn't pull its
  // whole history along with it.
  async getSummary(organizationId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, organizationId },
      select: {
        id: true,
        plateNumber: true,
        vehicleModel: true,
        vin: true,
        odometer: true,
        customer: { select: { id: true, name: true, companyName: true } },
      },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  // Paginated history, newest first, capped page size — keeps the lookup
  // fast for vehicles with hundreds/thousands of invoices by never
  // selecting the full invoices relation the way getWithInvoices does.
  async getHistory(organizationId: string, vehicleId: string, page = 1, limit = HISTORY_DEFAULT_LIMIT) {
    await this.getVehicleOrThrow(organizationId, vehicleId);

    const safeLimit = Math.min(Math.max(1, limit), HISTORY_MAX_LIMIT);
    const safePage = Math.max(1, page);

    const [total, invoices] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where: { vehicleId, organizationId } }),
      this.prisma.invoice.findMany({
        where: { vehicleId, organizationId },
        orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          issuedAt: true,
          createdAt: true,
          odometer: true,
          dueDate: true,       // NEW — needed to compute overdue, same as /vehicles/[id]
          paymentStatus: true, // NEW — same
          items: {
            select: {
              id: true,
              quantity: true,
              description: true,
              product: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    return {
      items: invoices,
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }
}