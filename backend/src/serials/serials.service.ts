import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SerialStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeSerials } from './serial-moves';
import { escapeLike } from '../common/text/escape-like';

@Injectable()
export class SerialsService {
  constructor(private prisma: PrismaService) {}

  async setTracking(
    organizationId: string,
    productId: string,
    trackSerials: boolean,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.product.update({
      where: { id: productId },
      data: { trackSerials },
      select: { id: true, trackSerials: true },
    });
  }

  // Units of a product that can be sold/returned/moved from a location.
  available(organizationId: string, productId: string, locationId: string) {
    return this.prisma.productSerial.findMany({
      where: {
        organizationId,
        productId,
        locationId,
        status: SerialStatus.IN_STOCK,
      },
      select: { id: true, serialNumber: true, createdAt: true },
      orderBy: { serialNumber: 'asc' },
      take: 1000,
    });
  }

  // Search by (part of) a serial number, or list one product's units.
  async search(
    organizationId: string,
    opts: { q?: string; productId?: string; status?: SerialStatus },
  ) {
    const q = opts.q?.trim();
    if (!q && !opts.productId) return [];
    return this.prisma.productSerial.findMany({
      where: {
        organizationId,
        ...(q && {
          serialNumber: { contains: escapeLike(q), mode: 'insensitive' },
        }),
        ...(opts.productId && { productId: opts.productId }),
        ...(opts.status && { status: opts.status }),
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        location: { select: { name: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    });
  }

  // One unit's story: received on, sold on (and to whom), returned on,
  // moved by — for warranty and service questions.
  async history(organizationId: string, id: string) {
    const serial = await this.prisma.productSerial.findFirst({
      where: { id, organizationId },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        location: { select: { name: true } },
      },
    });
    if (!serial) throw new NotFoundException('Serial number not found');
    const [receipt, invoice, ret, transfer] = await Promise.all([
      serial.goodsReceiptId
        ? this.prisma.goodsReceipt.findFirst({
            where: { id: serial.goodsReceiptId, organizationId },
            select: {
              id: true,
              receiptNumber: true,
              createdAt: true,
              purchaseOrder: {
                select: {
                  id: true,
                  poNumber: true,
                  supplier: { select: { name: true } },
                },
              },
            },
          })
        : null,
      serial.invoiceId
        ? this.prisma.invoice.findFirst({
            where: { id: serial.invoiceId, organizationId },
            select: {
              id: true,
              invoiceNumber: true,
              issuedAt: true,
              customerName: true,
              customerPhone: true,
            },
          })
        : null,
      serial.purchaseReturnId
        ? this.prisma.purchaseReturn.findFirst({
            where: { id: serial.purchaseReturnId, organizationId },
            select: { id: true, returnNumber: true, createdAt: true },
          })
        : null,
      serial.stockTransferId
        ? this.prisma.stockTransfer.findFirst({
            where: { id: serial.stockTransferId, organizationId },
            select: { id: true, transferNumber: true, status: true },
          })
        : null,
    ]);
    return { ...serial, receipt, invoice, purchaseReturn: ret, transfer };
  }

  // For stock that was on the shelf before tracking started.
  async register(
    organizationId: string,
    productId: string,
    locationId: string,
    raw: string[],
  ) {
    const serials = normalizeSerials(raw);
    if (serials.length === 0)
      throw new BadRequestException('Enter at least one serial number');
    const [product, location] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, organizationId },
        select: { id: true },
      }),
      this.prisma.location.findFirst({
        where: { id: locationId, organizationId },
        select: { id: true },
      }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!location) throw new NotFoundException('Location not found');
    const taken = await this.prisma.productSerial.findMany({
      where: { productId, serialNumber: { in: serials } },
      select: { serialNumber: true },
    });
    if (taken.length)
      throw new ConflictException(
        `Already registered: ${taken.map((t) => t.serialNumber).join(', ')}`,
      );
    await this.prisma.productSerial.createMany({
      data: serials.map((serialNumber) => ({
        organizationId,
        productId,
        serialNumber,
        locationId,
        note: 'Registered by hand',
      })),
    });
    return { created: serials.length };
  }

  // Admin correction — customer returns, count differences. Stock levels
  // are corrected separately (stock adjustment or returns session); this
  // only fixes where the unit is recorded.
  async correct(
    organizationId: string,
    id: string,
    dto: { status: SerialStatus; locationId?: string; note: string },
  ) {
    const serial = await this.prisma.productSerial.findFirst({
      where: { id, organizationId },
    });
    if (!serial) throw new NotFoundException('Serial number not found');
    if (dto.status === SerialStatus.IN_STOCK) {
      if (!dto.locationId)
        throw new BadRequestException('Say which location the unit is in');
      const loc = await this.prisma.location.findFirst({
        where: { id: dto.locationId, organizationId },
        select: { id: true },
      });
      if (!loc) throw new NotFoundException('Location not found');
    }
    return this.prisma.productSerial.update({
      where: { id },
      data: {
        status: dto.status,
        locationId:
          dto.status === SerialStatus.IN_STOCK
            ? dto.locationId
            : serial.locationId,
        note: dto.note.trim(),
      },
    });
  }
}
