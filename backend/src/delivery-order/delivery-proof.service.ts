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
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE,
  type FileStorage,
} from '../storage/file-storage.interface';
import { SignedFileUrlService } from '../storage/signed-file-url.service';
import { encodePrivatePhoto } from '../storage/private-photo';
import { DeliveryOrderService } from './delivery-order.service';

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

    const data = await encodePrivatePhoto(file);

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
  // to creation date for unsigned ones) — delivery orders' and customer
  // stops' ("stop-proofs/") alike. Deletes only when `apply` is set — the
  // scheduled job passes autoDeleteEnabled(), which is off by default.
  async enforceRetention(apply: boolean) {
    const cutoff = new Date(
      Date.now() - this.retentionDays() * 24 * 60 * 60 * 1000,
    );
    const olderThanCutoff = {
      proofPhotoKey: { not: null },
      OR: [
        { signedAt: { lt: cutoff } },
        { signedAt: null, createdAt: { lt: cutoff } },
      ],
    };
    const [orders, stops] = await Promise.all([
      this.prisma.deliveryOrder.findMany({
        where: olderThanCutoff,
        select: { id: true, proofPhotoKey: true },
      }),
      this.prisma.routeStop.findMany({
        where: olderThanCutoff,
        select: { id: true, proofPhotoKey: true },
      }),
    ]);
    const expired = [
      ...orders.map((o) => ({ ...o, kind: 'deliveryOrder' as const })),
      ...stops.map((o) => ({ ...o, kind: 'routeStop' as const })),
    ];
    if (!apply) return { expired: expired.length, deleted: 0 };

    let deleted = 0;
    for (const row of expired) {
      try {
        await this.storage.delete(row.proofPhotoKey!);
        if (row.kind === 'deliveryOrder') {
          await this.prisma.deliveryOrder.update({
            where: { id: row.id },
            data: { proofPhotoKey: null },
          });
        } else {
          await this.prisma.routeStop.update({
            where: { id: row.id },
            data: { proofPhotoKey: null },
          });
        }
        deleted++;
      } catch (err) {
        this.logger.warn(
          `Could not delete expired proof photo for ${row.kind} ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
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
