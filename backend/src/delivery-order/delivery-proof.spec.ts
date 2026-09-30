import 'dotenv/config';

// DeliveryOrderModule transitively imports the PDF renderer (puppeteer, ESM
// only — jest can't load it). Nothing here renders PDFs.
jest.mock('puppeteer', () => ({}));
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DeliveryOrderStatus } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageModule } from '../storage/storage.module';
import { LocalFileStorage } from '../storage/local-file-storage';
import { DeliveryOrderModule } from './delivery-order.module';
import { DeliveryProofService } from './delivery-proof.service';
import { MediaModule } from '../media/media.module';
import { MediaService } from '../media/media.service';

// Delivery proof photos: private storage, separate from the media library,
// against the real database and a temp uploads folder.
describe('Delivery proof photos', () => {
  let prisma: PrismaService;
  let proofs: DeliveryProofService;
  let media: MediaService;
  let root: string;
  let orgId: string;
  let adminId: string;
  let driverId: string;
  let otherDriverId: string;
  let photo: Express.Multer.File;

  const admin = () => ({ sub: adminId, role: 'ADMIN' });
  const driver = () => ({ sub: driverId, role: 'DRIVER' });

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'waresys-proof-'));
    process.env.UPLOADS_DIR = root;
    process.env.PRINT_TOKEN_SECRET ??= 'test-print-secret';
    process.env.FILE_URL_SECRET = 'test-file-secret';

    const module = await Test.createTestingModule({
      imports: [StorageModule, DeliveryOrderModule, MediaModule],
    }).compile();
    prisma = module.get(PrismaService);
    proofs = module.get(DeliveryProofService);
    media = module.get(MediaService);

    orgId = (
      await prisma.organization.create({
        data: { name: `Proof Org ${randomUUID()}` },
      })
    ).id;
    // Each driver in their own team — routes belong to teams.
    const mkUser = async (role: 'ADMIN' | 'DRIVER') =>
      prisma.user.create({
        data: {
          ...(role === 'DRIVER'
            ? {
                teamId: (
                  await prisma.team.create({
                    data: { organizationId: orgId, name: randomUUID() },
                  })
                ).id,
              }
            : {}),
          email: `${role}-${randomUUID()}@example.com`,
          password: 'x',
          role,
          organizationId: orgId,
        },
      });
    adminId = (await mkUser('ADMIN')).id;
    driverId = (await mkUser('DRIVER')).id;
    otherDriverId = (await mkUser('DRIVER')).id;

    const jpeg = await sharp({
      create: {
        width: 3000,
        height: 1500,
        channels: 3,
        background: { r: 200, g: 50, b: 50 },
      },
    })
      .jpeg()
      .toBuffer();
    photo = {
      buffer: jpeg,
      mimetype: 'image/jpeg',
      size: jpeg.length,
      originalname: 'p.jpg',
    } as Express.Multer.File;
  });

  afterAll(async () => {
    await prisma.routeStop.deleteMany({
      where: { route: { organizationId: orgId } },
    });
    await prisma.route.deleteMany({ where: { organizationId: orgId } });
    await prisma.mediaAsset.deleteMany({ where: { organizationId: orgId } });
    await prisma.deliveryOrder.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.team.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    rmSync(root, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  const shippedDo = async (onRouteOf?: string) => {
    const order = await prisma.deliveryOrder.create({
      data: {
        organizationId: orgId,
        status: DeliveryOrderStatus.SHIPPED,
        customerName: 'C',
      },
    });
    if (onRouteOf) {
      const { teamId } = await prisma.user.findUniqueOrThrow({
        where: { id: onRouteOf },
        select: { teamId: true },
      });
      const route = await prisma.route.create({
        data: {
          organizationId: orgId,
          teamId: teamId!,
          routeDate: new Date('2030-02-01T00:00:00Z'),
        },
      });
      await prisma.routeStop.create({
        data: {
          routeId: route.id,
          deliveryOrderId: order.id,
          activeDeliveryOrderId: order.id,
          sequence: 1,
        },
      });
    }
    return order;
  };

  it('stores the photo privately, outside the media library, resized once', async () => {
    const order = await shippedDo(driverId);
    await proofs.uploadPhoto(orgId, order.id, photo, driver());

    const saved = await prisma.deliveryOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(saved.proofPhotoKey).toMatch(
      new RegExp(`^delivery-proofs/${orgId}/${order.id}/[0-9a-f-]+\\.webp$`),
    );
    expect(saved.proofPhotoUrl).toBeNull();
    expect(
      await prisma.mediaAsset.count({ where: { organizationId: orgId } }),
    ).toBe(0);

    const stored = await new LocalFileStorage().get(saved.proofPhotoKey!);
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width, meta.height)).toBe(2000);

    // Not under a publicly served folder.
    expect(saved.proofPhotoKey!.startsWith('media/')).toBe(false);
    expect(existsSync(join(root, 'media'))).toBe(false);
  });

  it('gives a short-lived signed link only to people allowed to see the delivery', async () => {
    const order = await shippedDo(driverId);
    await proofs.uploadPhoto(orgId, order.id, photo, admin());

    const link = await proofs.photoLink(orgId, order.id, admin());
    expect(link.kind).toBe('signed');
    expect(link.path).toMatch(
      /^\/files\/signed\?key=delivery-proofs%2F.+&exp=\d+&sig=/,
    );
    expect(link.expiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(
      15 * 60 * 1000,
    );

    await expect(
      proofs.photoLink(orgId, order.id, driver()),
    ).resolves.toMatchObject({ kind: 'signed' });
    await expect(
      proofs.photoLink(orgId, order.id, { sub: otherDriverId, role: 'DRIVER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      proofs.uploadPhoto(orgId, order.id, photo, {
        sub: otherDriverId,
        role: 'DRIVER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('replaces the photo before sign-off (deleting the old file), locks it after', async () => {
    const order = await shippedDo(driverId);
    await proofs.uploadPhoto(orgId, order.id, photo, driver());
    const first = (
      await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: order.id } })
    ).proofPhotoKey!;

    await proofs.uploadPhoto(orgId, order.id, photo, driver());
    const second = (
      await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: order.id } })
    ).proofPhotoKey!;
    expect(second).not.toBe(first);
    const storage = new LocalFileStorage();
    expect(await storage.exists(first)).toBe(false);
    expect(await storage.exists(second)).toBe(true);

    await prisma.deliveryOrder.update({
      where: { id: order.id },
      data: { signedAt: new Date() },
    });
    await expect(
      proofs.uploadPhoto(orgId, order.id, photo, driver()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await storage.exists(second)).toBe(true);
  });

  it('keeps legacy media-library proofs: not deletable or recompressed from the gallery', async () => {
    const asset = await media.upload(orgId, adminId, photo);
    const order = await prisma.deliveryOrder.create({
      data: {
        organizationId: orgId,
        status: DeliveryOrderStatus.SHIPPED,
        proofPhotoUrl: asset.url,
        signedAt: new Date(),
      },
    });

    await expect(media.remove(orgId, asset.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await new LocalFileStorage().exists(`media/${asset.filename}`)).toBe(
      true,
    );

    // Age it past the hard-recompression cutoff: skipped because it's a proof.
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { createdAt: new Date('2020-01-01') },
    });
    const ordinary = await media.upload(orgId, adminId, photo);
    await prisma.mediaAsset.update({
      where: { id: ordinary.id },
      data: { createdAt: new Date('2020-01-01') },
    });
    await media.recompressStaleAssets();
    const after = await prisma.mediaAsset.findMany({
      where: { id: { in: [asset.id, ordinary.id] } },
    });
    expect(after.find((a) => a.id === asset.id)!.compressedAt).toBeNull();
    expect(
      after.find((a) => a.id === ordinary.id)!.compressedAt,
    ).not.toBeNull();

    // An ordinary gallery image still deletes normally.
    await expect(media.remove(orgId, ordinary.id)).resolves.toEqual({
      success: true,
    });

    await expect(proofs.photoLink(orgId, order.id, admin())).resolves.toEqual({
      kind: 'public',
      path: asset.url,
      expiresAt: null,
    });
  });

  it('retention: reports expired photos but deletes nothing unless enabled', async () => {
    const order = await shippedDo();
    await proofs.uploadPhoto(orgId, order.id, photo, admin());
    await prisma.deliveryOrder.update({
      where: { id: order.id },
      data: { signedAt: new Date(Date.now() - 800 * 24 * 60 * 60 * 1000) },
    });
    const key = (
      await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: order.id } })
    ).proofPhotoKey!;

    expect(proofs.autoDeleteEnabled()).toBe(false);
    expect(proofs.retentionDays()).toBe(730);
    const dry = await proofs.enforceRetention(false);
    expect(dry.expired).toBeGreaterThanOrEqual(1);
    expect(dry.deleted).toBe(0);
    expect(await new LocalFileStorage().exists(key)).toBe(true);

    // The scheduled job with the default (off) setting also leaves it.
    await proofs.scheduledRetention();
    expect(await new LocalFileStorage().exists(key)).toBe(true);

    const applied = await proofs.enforceRetention(true);
    expect(applied.deleted).toBeGreaterThanOrEqual(1);
    expect(await new LocalFileStorage().exists(key)).toBe(false);
    expect(
      (
        await prisma.deliveryOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).proofPhotoKey,
    ).toBeNull();
  });

  it('retention also covers customer-stop proofs', async () => {
    const { teamId } = await prisma.user.findUniqueOrThrow({
      where: { id: driverId },
      select: { teamId: true },
    });
    const route = await prisma.route.create({
      data: { organizationId: orgId, teamId: teamId!, routeDate: new Date('2030-02-02T00:00:00Z') },
    });
    const key = `stop-proofs/${orgId}/old/${randomUUID()}.webp`;
    await new LocalFileStorage().put(key, Buffer.from('x'), 'image/webp');
    const stop = await prisma.routeStop.create({
      data: {
        routeId: route.id,
        sequence: 1,
        customerName: 'Old visit',
        receivedBy: 'X',
        proofPhotoKey: key,
        signedAt: new Date(Date.now() - 800 * 24 * 60 * 60 * 1000),
      },
    });

    await proofs.enforceRetention(true);
    expect(await new LocalFileStorage().exists(key)).toBe(false);
    expect(
      (await prisma.routeStop.findUniqueOrThrow({ where: { id: stop.id } })).proofPhotoKey,
    ).toBeNull();
  });
});

