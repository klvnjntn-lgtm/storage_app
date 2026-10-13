import 'dotenv/config';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { configureApp } from '../configure-app';
import { OrgTransferModule } from './org-transfer.module';
import { OrgTransferService } from './org-transfer.service';

// The HTTP side of org-transfer.spec.ts: the export arrives as a file
// download, and the desktop import takes a multipart upload — with the
// same parsers and validation as production (configureApp).
describe('Organization export / import over HTTP', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let orgId: string;
  const PASSWORD = 'correct horse battery';

  beforeAll(async () => {
    process.env.UPLOADS_DIR = await fs.mkdtemp(
      join(tmpdir(), 'waresys-transfer-http-'),
    );
    const module = await Test.createTestingModule({
      imports: [OrgTransferModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApp(app);
    // Stands in for JwtAuthGuard/OrgGuard, which aren't part of this module.
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { organizationId: orgId, role: 'ADMIN' };
      next();
    });
    await app.init();
    prisma = module.get(PrismaService);
    orgId = (
      await prisma.organization.create({
        data: { name: `Http ${randomUUID()}` },
      })
    ).id;
    await prisma.user.create({
      data: {
        email: `http-${randomUUID()}@example.com`,
        password: 'x',
        role: 'ADMIN',
        organizationId: orgId,
      },
    });
  });

  afterAll(async () => {
    delete process.env.SINGLE_ORGANIZATION;
    await app?.close();
  });

  it('downloads the export as an attachment that imports back', async () => {
    const res = await request(app.getHttpServer())
      .post('/org-transfer/export')
      .send({ password: PASSWORD })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename=".+\.wsexport"/,
    );

    const file = join(process.env.UPLOADS_DIR!, 'downloaded.wsexport');
    await fs.writeFile(file, res.body as Buffer);
    const transfer = app.get(OrgTransferService);
    // Same business is still here, so it must be refused as a duplicate —
    // which also proves the file decrypted and parsed.
    await expect(transfer.import(file, PASSWORD)).rejects.toThrow(
      'already exists',
    );
  });

  it('rejects a short export password', async () => {
    await request(app.getHttpServer())
      .post('/org-transfer/export')
      .send({ password: 'short' })
      .expect(400);
  });

  it('only imports on the desktop app, and only before its business exists', async () => {
    const upload = () =>
      request(app.getHttpServer())
        .post('/org-transfer/import')
        .field('password', PASSWORD)
        .attach('file', Buffer.from('not really'), 'business.wsexport');

    delete process.env.SINGLE_ORGANIZATION;
    await upload().expect(403);

    process.env.SINGLE_ORGANIZATION = 'true';
    // The test database already has businesses.
    const res = await upload().expect(409);
    expect((res.body as { message: string }).message).toMatch(
      /already has a business/,
    );
  });

  it('only accepts .wsexport files', async () => {
    await request(app.getHttpServer())
      .post('/org-transfer/import')
      .field('password', PASSWORD)
      .attach('file', Buffer.from('x'), 'business.zip')
      .expect(400);
  });
});
