// src/organization/storage/local-logo-storage.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { LogoStorage } from './logo-storage.interface';

// Where logo files land on disk. Mount this as a persistent volume in
// docker-compose (or your deploy config) so uploads survive container
// restarts/redeploys — this is the main thing to remember with local
// disk storage, and the main reason it needs to change once this is
// running on the cloud (ephemeral/multi-instance filesystems).
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'logos');

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);

@Injectable()
export class LocalLogoStorageService implements LogoStorage {
  async save(orgId: string, file: Express.Multer.File): Promise<string> {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo must be PNG, JPEG, or SVG');
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    const ext = extensionFor(file.mimetype);
    // Unique filename per upload (not just per org) so browsers/CDNs
    // don't serve a stale cached logo after the org replaces it.
    const filename = `${orgId}-${randomUUID()}${ext}`;
    const destination = join(UPLOAD_DIR, filename);

    await fs.writeFile(destination, file.buffer);

    // Served by app.useStaticAssets(...) in main.ts, mounted at /uploads.
    return `/uploads/logos/${filename}`;
  }
}

function extensionFor(mimetype: string): string {
  switch (mimetype) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '';
  }
}