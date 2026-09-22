// src/media/media.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

// Where uploaded library files land on disk — mount as a persistent volume
// in deploy config, same reasoning as uploads/logos (see
// local-logo-storage.service.ts).
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'media');

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5MB, enforced again here in case a caller bypasses the controller's multer limit

// Normal-quality encode applied to every upload immediately.
const STANDARD_MAX_DIMENSION = 2000;
const STANDARD_QUALITY = 82;

// Much harder encode applied by the scheduled job below, once an asset has
// been sitting in the library long enough that it's unlikely to still need
// full resolution — trades quality for disk usage on older uploads.
const HARD_MAX_DIMENSION = 800;
const HARD_QUALITY = 40;
const HARD_COMPRESS_AFTER_DAYS = 30;

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private prisma: PrismaService) {}

  async upload(orgId: string, userId: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Image must be PNG, JPEG, or WebP');
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      throw new BadRequestException('Image exceeds 5MB');
    }

    const filename = `${randomUUID()}.webp`;
    const destination = join(UPLOAD_DIR, filename);

    // file.mimetype is just the client-supplied Content-Type — not
    // verified against the actual bytes. sharp is what actually parses
    // the file, so a corrupt upload or a spoofed mimetype surfaces here
    // as a decode failure rather than at the check above; without this
    // try/catch that failure would bubble up as an unhandled 500 instead
    // of a normal validation error.
    let data: Buffer;
    let info: sharp.OutputInfo;
    try {
      ({ data, info } = await sharp(file.buffer)
        .resize({
          width: STANDARD_MAX_DIMENSION,
          height: STANDARD_MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: STANDARD_QUALITY })
        .toBuffer({ resolveWithObject: true }));
    } catch {
      throw new BadRequestException('Uploaded file is not a valid image');
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(destination, data);

    return this.prisma.mediaAsset.create({
      data: {
        organizationId: orgId,
        uploadedById: userId,
        filename,
        originalName: file.originalname || null,
        mimeType: 'image/webp',
        sizeBytes: info.size,
        width: info.width,
        height: info.height,
        url: `/uploads/media/${filename}`,
      },
    });
  }

  async list(
    orgId: string,
    params: { q?: string; mimeType?: string; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 24));

    const where = {
      organizationId: orgId,
      ...(params.q?.trim()
        ? { originalName: { contains: params.q.trim(), mode: 'insensitive' as const } }
        : {}),
      ...(params.mimeType ? { mimeType: params.mimeType } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);

    return { items, totalItems, page, pageSize };
  }

  async remove(orgId: string, id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!asset) throw new BadRequestException('Media asset not found');

    try {
      await fs.unlink(join(UPLOAD_DIR, asset.filename));
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn(`Failed to delete file for media asset ${id}: ${err?.message ?? err}`);
      }
    }

    await this.prisma.mediaAsset.delete({ where: { id } });
    return { success: true };
  }

  // Recompresses any asset that's aged past HARD_COMPRESS_AFTER_DAYS and
  // hasn't been hard-compressed yet. Sequential on purpose — this can run
  // over many assets and we'd rather it take longer than spike CPU with a
  // pile of concurrent sharp() calls. filename/url never change, so
  // whatever Product.image/User.avatarUrl already points at keeps resolving.
  async recompressStaleAssets() {
    const cutoff = new Date(Date.now() - HARD_COMPRESS_AFTER_DAYS * 24 * 60 * 60 * 1000);

    const stale = await this.prisma.mediaAsset.findMany({
      where: { compressedAt: null, createdAt: { lt: cutoff } },
    });

    for (const asset of stale) {
      const path = join(UPLOAD_DIR, asset.filename);
      try {
        const original = await fs.readFile(path);
        const { data, info } = await sharp(original)
          .resize({
            width: HARD_MAX_DIMENSION,
            height: HARD_MAX_DIMENSION,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: HARD_QUALITY })
          .toBuffer({ resolveWithObject: true });

        await fs.writeFile(path, data);

        await this.prisma.mediaAsset.update({
          where: { id: asset.id },
          data: {
            sizeBytes: info.size,
            width: info.width,
            height: info.height,
            compressedAt: new Date(),
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to hard-compress media asset ${asset.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { processed: stale.length };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledRecompress() {
    const { processed } = await this.recompressStaleAssets();
    if (processed > 0) {
      this.logger.log(`Hard-recompressed ${processed} media asset(s) older than ${HARD_COMPRESS_AFTER_DAYS} days`);
    }
  }
}
