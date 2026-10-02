// src/organization/storage/local-logo-storage.service.ts
import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { LogoStorage } from './logo-storage.interface';
import {
  FILE_STORAGE,
  type FileStorage,
} from '../../storage/file-storage.interface';

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// Logos print on invoices; 1000px is far more than any template needs.
const MAX_DIMENSION = 1000;

// SVG is no longer accepted. It is XML that can carry scripts and links,
// and the old regex blocklist could be bypassed (e.g. an entity-encoded
// "javascript:" href). Since logos are served from the app's own origin,
// that made any org admin able to plant stored XSS. Raster logos are
// re-encoded through sharp, so whatever is stored is a real PNG — never
// the uploaded bytes, and never something a browser could treat as HTML.
//
// Stores under the public "logos/" key prefix, served at
// /uploads/logos/<filename>. Where the bytes actually live is
// FileStorage's concern (local disk today).
@Injectable()
export class LocalLogoStorageService implements LogoStorage {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  async save(orgId: string, file: Express.Multer.File): Promise<string> {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo must be PNG, JPEG, or WebP');
    }

    let data: Buffer;
    try {
      // PNG keeps transparency, which most logos rely on.
      data = await sharp(file.buffer)
        .rotate()
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
    } catch {
      throw new BadRequestException('Uploaded file is not a valid image');
    }

    const filename = `${orgId}-${randomUUID()}.png`;
    await this.storage.put(`logos/${filename}`, data, 'image/png');

    return `/uploads/logos/${filename}`;
  }
}
