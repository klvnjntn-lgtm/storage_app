// src/storage/local-file-storage.ts
import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import {
  FileNotFoundError,
  FileStorage,
  assertValidKey,
} from './file-storage.interface';

// Root of the uploads volume (docker-compose mounts backend_uploads at
// /app/uploads). UPLOADS_DIR overrides it — tests point it at a temp dir.
export function uploadsRoot(): string {
  return process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads');
}

// Local-disk FileStorage: key "media/x.webp" ↔ <uploadsRoot>/media/x.webp.
// Same layout the app has always used, so existing files and the
// /uploads/... URLs stored in the database keep working unchanged.
@Injectable()
export class LocalFileStorage implements FileStorage {
  private readonly root = uploadsRoot();

  private pathFor(key: string): string {
    assertValidKey(key);
    return join(this.root, ...key.split('/'));
  }

  // contentType isn't needed on disk (it's inferred from the extension
  // when serving); an object-storage implementation would store it.
  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await fs.mkdir(dirname(path), { recursive: true });
    // Write-then-rename so a reader (or a crash) never sees a half-written file.
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, path);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        throw new FileNotFoundError(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}
