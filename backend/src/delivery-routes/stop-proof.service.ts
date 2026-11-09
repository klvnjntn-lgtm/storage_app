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
import { assertDriverCatchUpWindow, photoCaptureData } from './driver-proof';
import { landmarkFromProof } from '../customers/landmark-from-proof';
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
    // The same photo without the date/GPS stamp, for a customer with no
    // landmark photo yet (landmarkFromProof).
    landmark?: Express.Multer.File,
  ) {
    const stop = await this.routes.findCustomerStopForAction(
      organizationId,
      routeId,
      stopId,
      requester,
    );
    assertDriverCatchUpWindow(stop.route, requester.role);
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
    await landmarkFromProof(
      { prisma: this.prisma, storage: this.storage, logger: this.logger },
      {
        organizationId,
        customerId: stop.customerId,
        source: stopId,
        file: landmark,
        meta: {
          takenAt: capture.proofPhotoTakenAt,
          latitude: capture.proofPhotoLatitude,
          longitude: capture.proofPhotoLongitude,
          accuracy: capture.proofPhotoAccuracy,
        },
      },
    );
    return { hasPhoto: true };
  }

  // See DeliveryRoutesService.resetStopResult: the delivery's own photos are
  // kept (the history points at them). The customer's location photo copied
  // from this proof goes, though — it may show the wrong place, and it's only
  // a copy.
  async resetStop(
    organizationId: string,
    routeId: string,
    stopId: string,
    requester: Requester,
  ) {
    const { landmarkSource } = await this.routes.resetStopResult(
      organizationId,
      routeId,
      stopId,
      requester,
    );
    await this.dropLandmarks(organizationId, [landmarkSource], stopId);
    return this.routes.getRoute(organizationId, routeId, requester);
  }

  // Moves what was recorded on one customer stop to another on the same route
  // (the driver marked the wrong one); swaps when the other has a result too.
  // See DeliveryRoutesService.moveStopResult.
  async moveResult(
    organizationId: string,
    routeId: string,
    fromStopId: string,
    toStopId: string,
    requester: Requester,
  ) {
    const { deleteKeys } = await this.routes.moveStopResult(
      organizationId,
      routeId,
      fromStopId,
      toStopId,
      requester,
    );
    for (const key of deleteKeys) {
      await this.storage
        .delete(key)
        .catch((err: unknown) =>
          this.logger.warn(`Could not delete location photo ${key}: ${err instanceof Error ? err.message : String(err)}`),
        );
    }
    return this.routes.getRoute(organizationId, routeId, requester);
  }

  // A file that won't delete only logs.
  private async dropLandmarks(organizationId: string, sources: string[], stopId: string) {
    try {
      const landmarks = await this.prisma.customerLocationPhoto.findMany({
        where: { organizationId, fromProofOf: { in: sources } },
        select: { id: true, storageKey: true },
      });
      await this.prisma.customerLocationPhoto.deleteMany({
        where: { id: { in: landmarks.map((l) => l.id) } },
      });
      for (const l of landmarks) {
        await this.storage
          .delete(l.storageKey)
          .catch((err: unknown) =>
            this.logger.warn(`Could not delete location photo ${l.storageKey}: ${err instanceof Error ? err.message : String(err)}`),
          );
      }
    } catch (err) {
      this.logger.warn(`Could not remove landmark from reset stop ${stopId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // A photo kept in the route history from a reset or moved result.
  async historyPhotoLink(
    organizationId: string,
    routeId: string,
    eventId: string,
    kind: 'proof' | 'failure',
  ) {
    const key = await this.routes.getHistoryPhotoKey(organizationId, routeId, eventId, kind);
    const { path, expiresAt } = this.signer.sign(key);
    return { kind: 'signed' as const, path, expiresAt };
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
    assertDriverCatchUpWindow(stop.route, requester.role);
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
