// src/delivery-order/delivery-proof.service.ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DeliveryOrderStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE,
  type FileStorage,
} from '../storage/file-storage.interface';
import { SignedFileUrlService } from '../storage/signed-file-url.service';
import { DeliveryOrderService } from './delivery-order.service';

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

// One encode at upload, then never touched again — proof keeps its
// quality (no gallery-style hard recompression).
const MAX_DIMENSION = 2000;
const QUALITY = 85;

// Target retention for proof photos. Automatic deletion is OFF unless
// DELIVERY_PROOF_AUTO_DELETE=true; until then the daily job only reports
// what it would delete.
const DEFAULT_RETENTION_DAYS = 730;

type Requester = { sub: string; role: string };

// Delivery proof photos: private files under "delivery-proofs/", separate
// from the media library. Only people allowed to act on the delivery
// order (staff of the org; a driver only for DOs on their own routes) can
// upload one or get a link to view it.
@Injectable()
export class DeliveryProofService {
  private readonly logger = new Logger(DeliveryProofService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
    private signer: SignedFileUrlService,
    private deliveryOrders: DeliveryOrderService,
  ) {}

  private async findOrder(
    organizationId: string,
    id: string,
    requester?: Requester,
  ) {
    const order = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        status: true,
        signedAt: true,
        proofPhotoKey: true,
        proofPhotoUrl: true,
      },
    });
    if (!order) throw new NotFoundException('Delivery order not found');
    await this.deliveryOrders.assertRequesterCanActOnDeliveryOrder(
      id,
      requester,
    );
    return order;
  }

  // Stores the photo and attaches it to the delivery order right away (so
  // there are no orphan uploads to track). Before the delivery is signed
  // for, a new photo replaces the previous one; afterwards the proof is
  // locked — a photo can still be added if there was none, never replaced.
  async uploadPhoto(
    organizationId: string,
    id: string,
    file: Express.Multer.File,
    requester?: Requester,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Photo must be PNG, JPEG or WebP');
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES)
      throw new BadRequestException('Photo exceeds 10MB');

    const order = await this.findOrder(organizationId, id, requester);
    if (order.status !== DeliveryOrderStatus.SHIPPED) {
      throw new BadRequestException(
        'A proof photo can only be added once the delivery order has shipped',
      );
    }
    if (order.signedAt && (order.proofPhotoKey || order.proofPhotoUrl)) {
      throw new ConflictException(
        'This delivery is already signed for — its proof photo can no longer be replaced',
      );
    }

    let data: Buffer;
    try {
      data = await sharp(file.buffer)
        .rotate() // apply the phone's EXIF orientation before it's stripped
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: QUALITY })
        .toBuffer();
    } catch {
      throw new BadRequestException('Uploaded file is not a valid image');
    }

    const key = `delivery-proofs/${organizationId}/${id}/${randomUUID()}.webp`;
    await this.storage.put(key, data, 'image/webp');

    // Conditional on the key we read, so two concurrent uploads can't both
    // think they replaced the same previous photo.
    const claim = await this.prisma.deliveryOrder.updateMany({
      where: { id, organizationId, proofPhotoKey: order.proofPhotoKey },
      data: { proofPhotoKey: key },
    });
    if (claim.count === 0) {
      await this.storage.delete(key);
      throw new ConflictException(
        'The proof photo was changed at the same time — try again',
      );
    }
    if (order.proofPhotoKey) {
      await this.storage
        .delete(order.proofPhotoKey)
        .catch((err: unknown) =>
          this.logger.warn(
            `Could not delete replaced proof photo ${order.proofPhotoKey}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }
    return { hasPhoto: true };
  }

  // A link for <img src>. Private photos get a signed link valid for a few
  // minutes; legacy proofs (media-library URLs) are returned as-is.
  async photoLink(organizationId: string, id: string, requester?: Requester) {
    const order = await this.findOrder(organizationId, id, requester);
    if (order.proofPhotoKey) {
      const { path, expiresAt } = this.signer.sign(order.proofPhotoKey);
      return { kind: 'signed' as const, path, expiresAt };
    }
    if (order.proofPhotoUrl) {
      return {
        kind: 'public' as const,
        path: order.proofPhotoUrl,
        expiresAt: null,
      };
    }
    throw new NotFoundException('This delivery order has no proof photo');
  }

  retentionDays(): number {
    const days = Number(process.env.DELIVERY_PROOF_RETENTION_DAYS);
    return Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
  }

  autoDeleteEnabled(): boolean {
    return process.env.DELIVERY_PROOF_AUTO_DELETE === 'true';
  }

  // Proof photos past the retention window (by delivery date, falling back
  // to creation date for unsigned ones). Deletes only when `apply` is set
  // — the scheduled job passes autoDeleteEnabled(), which is off by default.
  async enforceRetention(apply: boolean) {
    const cutoff = new Date(
      Date.now() - this.retentionDays() * 24 * 60 * 60 * 1000,
    );
    const expired = await this.prisma.deliveryOrder.findMany({
      where: {
        proofPhotoKey: { not: null },
        OR: [
          { signedAt: { lt: cutoff } },
          { signedAt: null, createdAt: { lt: cutoff } },
        ],
      },
      select: { id: true, proofPhotoKey: true },
    });
    if (!apply) return { expired: expired.length, deleted: 0 };

    let deleted = 0;
    for (const order of expired) {
      try {
        await this.storage.delete(order.proofPhotoKey!);
        await this.prisma.deliveryOrder.update({
          where: { id: order.id },
          data: { proofPhotoKey: null },
        });
        deleted++;
      } catch (err) {
        this.logger.warn(
          `Could not delete expired proof photo for ${order.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { expired: expired.length, deleted };
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async scheduledRetention() {
    const apply = this.autoDeleteEnabled();
    const { expired, deleted } = await this.enforceRetention(apply);
    if (expired === 0) return;
    if (apply) {
      this.logger.log(
        `Deleted ${deleted}/${expired} delivery proof photo(s) older than ${this.retentionDays()} days`,
      );
    } else {
      this.logger.log(
        `${expired} delivery proof photo(s) are older than ${this.retentionDays()} days — not deleted (DELIVERY_PROOF_AUTO_DELETE is off)`,
      );
    }
  }
}
