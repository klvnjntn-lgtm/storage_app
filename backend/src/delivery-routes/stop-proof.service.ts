// src/delivery-routes/stop-proof.service.ts
import {
  BadRequestException,
  ConflictException,
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
import {
  DeliveryRoutesService,
  routeDayStart,
} from './delivery-routes.service';
import { photoCaptureData } from './driver-proof';
import type { ProofPhotoMetaDto } from './dto/proof-photo-meta.dto';

type Requester = { sub: string; role: string };

// Proof photos for customer stops (stops without a delivery order) —
// the counterpart of DeliveryProofService, stored privately under
// "stop-proofs/". Same rules: replaceable until the stop is signed for,
// then locked.
@Injectable()
export class StopProofService {
  private readonly logger = new Logger(StopProofService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
    private signer: SignedFileUrlService,
    private routes: DeliveryRoutesService,
  ) {}

  async uploadPhoto(
    organizationId: string,
    routeId: string,
    stopId: string,
    file: Express.Multer.File,
    requester: Requester,
    meta: ProofPhotoMetaDto = {},
  ) {
    const stop = await this.routes.findCustomerStopForAction(
      organizationId,
      routeId,
      stopId,
      requester,
    );
    if (stop.failedAt) {
      throw new BadRequestException('This stop was marked as failed');
    }
    if (stop.signedAt && stop.proofPhotoKey) {
      throw new ConflictException(
        'This stop is already signed for — its proof photo can no longer be replaced',
      );
    }

    // Before storing anything: a driver's photo without GPS is refused.
    const capture = photoCaptureData(
      meta,
      requester.role === 'DRIVER',
      routeDayStart(stop.route),
    );
    const data = await encodePrivatePhoto(file);
    const key = `stop-proofs/${organizationId}/${stopId}/${randomUUID()}.webp`;
    await this.storage.put(key, data, 'image/webp');

    const claim = await this.prisma.routeStop.updateMany({
      where: { id: stopId, proofPhotoKey: stop.proofPhotoKey },
      data: { proofPhotoKey: key, ...capture },
    });
    if (claim.count === 0) {
      await this.storage.delete(key);
      throw new ConflictException(
        'The proof photo was changed at the same time — try again',
      );
    }
    if (stop.proofPhotoKey) {
      await this.storage
        .delete(stop.proofPhotoKey)
        .catch((err: unknown) =>
          this.logger.warn(
            `Could not delete replaced stop proof ${stop.proofPhotoKey}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }
    return { hasPhoto: true };
  }

  // The receiver name as the driver types it, so the office sees it even
  // if Done is never tapped. Only while the stop is open.
  async saveDraft(
    organizationId: string,
    routeId: string,
    stopId: string,
    receivedBy: string | undefined,
    requester: Requester,
  ) {
    const stop = await this.routes.findCustomerStopForAction(
      organizationId,
      routeId,
      stopId,
      requester,
    );
    if (stop.signedAt || stop.failedAt) {
      throw new BadRequestException('This stop is already resolved');
    }
    await this.prisma.routeStop.update({
      where: { id: stopId },
      data: { pendingReceivedBy: receivedBy?.trim() || null },
    });
    return { saved: true };
  }

  // kind 'failure': the photo from a failed attempt.
  async photoLink(
    organizationId: string,
    routeId: string,
    stopId: string,
    requester: Requester,
    kind: 'proof' | 'failure' = 'proof',
  ) {
    const stop = await this.routes.findCustomerStopForAction(
      organizationId,
      routeId,
      stopId,
      requester,
    );
    const key = kind === 'failure' ? stop.failurePhotoKey : stop.proofPhotoKey;
    if (!key) {
      throw new NotFoundException('This stop has no such photo');
    }
    const { path, expiresAt } = this.signer.sign(key);
    return { kind: 'signed' as const, path, expiresAt };
  }
}
