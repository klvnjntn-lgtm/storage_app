import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LocalFileStorage } from './local-file-storage';
import {
  FileNotFoundError,
  assertValidKey,
  type FileStorage,
} from './file-storage.interface';
import { SignedFileUrlService } from './signed-file-url.service';
import { StorageModule } from './storage.module';
import { FilesController } from './files.controller';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';

describe('LocalFileStorage', () => {
  let root: string;
  let storage: FileStorage;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'waresys-storage-'));
    process.env.UPLOADS_DIR = root;
    storage = new LocalFileStorage();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  it('puts, gets, checks and deletes by key, in the same layout as before', async () => {
    await storage.put('media/a.webp', Buffer.from('hello'), 'image/webp');
    expect(existsSync(join(root, 'media', 'a.webp'))).toBe(true);
    expect((await storage.get('media/a.webp')).toString()).toBe('hello');
    expect(await storage.exists('media/a.webp')).toBe(true);

    await storage.delete('media/a.webp');
    expect(await storage.exists('media/a.webp')).toBe(false);
    await expect(storage.get('media/a.webp')).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
    await expect(storage.delete('media/a.webp')).resolves.toBeUndefined(); // no-op
  });

  it('rejects keys that could escape the uploads root', async () => {
    for (const key of [
      '../etc/passwd',
      'media/../../x',
      '/abs/path',
      'a//b',
      'a\\b',
      '',
      'media/./x',
    ]) {
      expect(() => assertValidKey(key)).toThrow();
      await expect(
        storage.put(key, Buffer.from('x'), 'text/plain'),
      ).rejects.toThrow();
    }
  });
});

describe('SignedFileUrlService', () => {
  const signer = new SignedFileUrlService();
  beforeAll(() => {
    process.env.FILE_URL_SECRET = 'test-file-secret';
  });

  const parse = (path: string) =>
    Object.fromEntries(new URL(path, 'http://x').searchParams);

  it('verifies its own link and rejects any tampering', () => {
    const { path } = signer.sign('delivery-proofs/org/do/p.webp', 60);
    const q = parse(path);
    expect(signer.verify(q.key, q.exp, q.sig)).toBeGreaterThan(0);

    expect(
      signer.verify('delivery-proofs/org/do/other.webp', q.exp, q.sig),
    ).toBeNull();
    expect(
      signer.verify(q.key, String(Number(q.exp) + 3600), q.sig),
    ).toBeNull();
    expect(signer.verify(q.key, q.exp, q.sig.slice(0, -2) + 'AA')).toBeNull();
    expect(signer.verify(q.key, q.exp, '')).toBeNull();
  });

  it('rejects an expired link', () => {
    const { path } = signer.sign('delivery-proofs/org/do/p.webp', -1);
    const q = parse(path);
    expect(signer.verify(q.key, q.exp, q.sig)).toBeNull();
  });
});

describe('GET /files/signed', () => {
  let app: INestApplication;
  let root: string;
  let signer: SignedFileUrlService;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'waresys-files-'));
    process.env.UPLOADS_DIR = root;
    process.env.FILE_URL_SECRET = 'test-file-secret';
    const module = await Test.createTestingModule({
      imports: [StorageModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    signer = module.get(SignedFileUrlService);
    const storage: FileStorage = new LocalFileStorage();
    await storage.put(
      'delivery-proofs/org1/do1/p.webp',
      Buffer.from('PROOF'),
      'image/webp',
    );
    await storage.put('media/pub.webp', Buffer.from('PUBLIC'), 'image/webp');
  });
  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  it('serves a private file with a valid link, privately cached', async () => {
    const res: request.Response = await request(app.getHttpServer())
      .get(signer.sign('delivery-proofs/org1/do1/p.webp').path)
      .expect(200);
    expect(res.headers['content-type']).toContain('image/webp');
    expect(res.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
    expect(Buffer.from(res.body).toString()).toBe('PROOF');
  });

  it('refuses without a signature, with a forged one, or for a non-private key', async () => {
    await request(app.getHttpServer())
      .get('/files/signed?key=delivery-proofs/org1/do1/p.webp')
      .expect(403);
    const q = new URL(
      signer.sign('delivery-proofs/org1/do1/p.webp').path,
      'http://x',
    ).searchParams;
    q.set('key', 'delivery-proofs/org2/do9/p.webp');
    await request(app.getHttpServer()).get(`/files/signed?${q}`).expect(403);
    // Only private prefixes are ever served here — even a correctly signed
    // public key is refused.
    await request(app.getHttpServer())
      .get(signer.sign('media/pub.webp').path)
      .expect(403);
  });

  it('404s a validly signed link to a missing file', async () => {
    await request(app.getHttpServer())
      .get(signer.sign('delivery-proofs/org1/do1/gone.webp').path)
      .expect(404);
  });
});

// <img src> can't send the Bearer token, so the signed-link route must opt
// out of the app's global JWT guard — the signature is its credential.
it('FilesController is exempt from the global JWT guard', () => {
  expect(Reflect.getMetadata(IS_PUBLIC_KEY, FilesController)).toBe(true);
});
