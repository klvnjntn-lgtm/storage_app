// src/customers/customer-location.service.ts
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE,
  type FileStorage,
} from '../storage/file-storage.interface';
import { SignedFileUrlService } from '../storage/signed-file-url.service';
import { encodePrivatePhoto } from '../storage/private-photo';

export const MAX_LOCATION_PHOTOS = 2;

// DELIVERY_DMS — photos of a customer's building/entrance for drivers
// (see CustomerLocationPhoto). Private files; shown via signed links.
@Injectable()
export class CustomerLocationService {
  private readonly logger = new Logger(CustomerLocationService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
    private signer: SignedFileUrlService,
  ) {}

  private async assertCustomer(organizationId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
  }

  async list(organizationId: string, customerId: string) {
    await this.assertCustomer(organizationId, customerId);
    const photos = await this.prisma.customerLocationPhoto.findMany({
      where: { organizationId, customerId },
      orderBy: { createdAt: 'asc' },
    });
    return photos.map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      ...this.signer.sign(p.storageKey),
    }));
  }

  async upload(
    organizationId: string,
    customerId: string,
    file: Express.Multer.File,
  ) {
    await this.assertCustomer(organizationId, customerId);
    const count = await this.prisma.customerLocationPhoto.count({
      where: { organizationId, customerId },
    });
    if (count >= MAX_LOCATION_PHOTOS) {
      throw new BadRequestException(
        `A customer can have at most ${MAX_LOCATION_PHOTOS} location photos — delete one first`,
      );
    }
    const data = await encodePrivatePhoto(file);
    const key = `customer-locations/${organizationId}/${customerId}/${randomUUID()}.webp`;
    await this.storage.put(key, data, 'image/webp');
    await this.prisma.customerLocationPhoto.create({
      data: { organizationId, customerId, storageKey: key },
    });
    return this.list(organizationId, customerId);
  }

  async remove(organizationId: string, customerId: string, photoId: string) {
    const photo = await this.prisma.customerLocationPhoto.findFirst({
      where: { id: photoId, customerId, organizationId },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.prisma.customerLocationPhoto.delete({ where: { id: photoId } });
    await this.deleteFile(photo.storageKey);
    return this.list(organizationId, customerId);
  }

  // For CustomersService.remove(): the rows cascade with the customer, the
  // files don't — read the keys first, delete the files after the row.
  async storageKeys(organizationId: string, customerId: string) {
    const photos = await this.prisma.customerLocationPhoto.findMany({
      where: { organizationId, customerId },
      select: { storageKey: true },
    });
    return photos.map((p) => p.storageKey);
  }

  async deleteFile(key: string) {
    await this.storage
      .delete(key)
      .catch((err: unknown) =>
        this.logger.warn(
          `Could not delete customer location photo ${key}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }
}
