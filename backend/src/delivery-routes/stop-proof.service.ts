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
import { DeliveryRoutesService } from './delivery-routes.service';

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

    const data = await encodePrivatePhoto(file);
    const key = `stop-proofs/${organizationId}/${stopId}/${randomUUID()}.webp`;
    await this.storage.put(key, data, 'image/webp');

    const claim = await this.prisma.routeStop.updateMany({
      where: { id: stopId, proofPhotoKey: stop.proofPhotoKey },
      data: { proofPhotoKey: key },
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

  async photoLink(
    organizationId: string,
    routeId: string,
    stopId: string,
    requester: Requester,
  ) {
    const stop = await this.routes.findCustomerStopForAction(
      organizationId,
      routeId,
      stopId,
      requester,
    );
    if (!stop.proofPhotoKey) {
      throw new NotFoundException('This stop has no proof photo');
    }
    const { path, expiresAt } = this.signer.sign(stop.proofPhotoKey);
    return { kind: 'signed' as const, path, expiresAt };
  }
}
