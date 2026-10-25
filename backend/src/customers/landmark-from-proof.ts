// src/customers/landmark-from-proof.ts
import type { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import type { FileStorage } from '../storage/file-storage.interface';
import { encodePrivatePhoto } from '../storage/private-photo';

// A customer with no landmark photo gets one from the driver's proof photo
// — a clean copy the phone sends alongside it, without the date/GPS stamp
// burned into the proof. When and where it was taken are kept as data on
// the row, like a "Take photo" landmark. Only while the customer has none
// of their own: a retake for the same delivery replaces the one it filled
// in, but a photo the office added is never touched.
//
// Best-effort: callers run it after the proof is saved and a failure here
// only logs — the delivery photo is what matters.
export async function landmarkFromProof(
  deps: { prisma: PrismaService; storage: FileStorage; logger: Logger },
  args: {
    organizationId: string;
    customerId: string | null;
    // The stop's id (customer stop) or the delivery order's id.
    source: string;
    file?: Express.Multer.File;
    meta: { takenAt?: Date | null; latitude?: number | null; longitude?: number | null; accuracy?: number | null };
  },
) {
  const { prisma, storage, logger } = deps;
  const { organizationId, customerId, source, file, meta } = args;
  if (!file || !customerId) return;
  try {
    const existing = await prisma.customerLocationPhoto.findMany({
      where: { organizationId, customerId },
      select: { id: true, storageKey: true, fromProofOf: true },
    });
    // Ours to replace only if every photo there came from this delivery —
    // and it's swapped for just one, so the landmark limit
    // (MAX_LOCATION_PHOTOS) always holds.
    if (existing.some((p) => p.fromProofOf !== source)) return;

    const data = await encodePrivatePhoto(file);
    const key = `customer-locations/${organizationId}/${customerId}/${randomUUID()}.webp`;
    await storage.put(key, data, 'image/webp');
    const hasFix = meta.latitude != null && meta.longitude != null;
    await prisma.$transaction([
      prisma.customerLocationPhoto.deleteMany({
        where: { id: { in: existing.map((p) => p.id) } },
      }),
      prisma.customerLocationPhoto.create({
        data: {
          organizationId,
          customerId,
          storageKey: key,
          takenAt: meta.takenAt ?? null,
          latitude: hasFix ? meta.latitude : null,
          longitude: hasFix ? meta.longitude : null,
          accuracy: hasFix ? (meta.accuracy ?? null) : null,
          fromProofOf: source,
        },
      }),
    ]);
    for (const old of existing) {
      await storage.delete(old.storageKey).catch(() => undefined);
    }
  } catch (err) {
    logger.warn(
      `Could not fill in a landmark photo for customer ${customerId} from ${source}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
