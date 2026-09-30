// src/organization/storage/local-logo-storage.service.ts
import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LogoStorage } from './logo-storage.interface';
import {
  FILE_STORAGE,
  type FileStorage,
} from '../../storage/file-storage.interface';

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/svg+xml',
]);

// SVG is XML — it can embed <script>, event-handler attributes
// (onload=, onclick=, ...), and external references, all of which
// execute if anyone opens the uploaded file's URL directly in a browser
// tab (any org admin could otherwise use their own logo upload for
// stored XSS against whoever opens that link). A real sanitizer library
// would be more thorough, but a logo is a simple vector graphic — it has
// no legitimate reason to contain any of these, so rejecting outright is
// simpler and safer than trying to strip-and-repair untrusted markup.
const DANGEROUS_SVG_PATTERN =
  /<\s*script\b|<\s*iframe\b|<\s*embed\b|<\s*object\b|<\s*foreignobject\b|\bon[a-z]+\s*=|javascript\s*:|<\s*!entity\b/i;

function assertSafeSvg(buffer: Buffer) {
  const text = buffer.toString('utf-8');
  if (DANGEROUS_SVG_PATTERN.test(text)) {
    throw new BadRequestException(
      'This SVG contains scripts or embedded content that are not allowed in a logo',
    );
  }
}

// Validates a logo upload and stores it under the public "logos/" key
// prefix, served at /uploads/logos/<filename>. Where the bytes actually
// live is FileStorage's concern (local disk today).
@Injectable()
export class LocalLogoStorageService implements LogoStorage {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  async save(orgId: string, file: Express.Multer.File): Promise<string> {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo must be PNG, JPEG, or SVG');
    }

    if (file.mimetype === 'image/svg+xml') {
      assertSafeSvg(file.buffer);
    }

    const ext = extensionFor(file.mimetype);
    // Unique filename per upload (not just per org) so browsers/CDNs
    // don't serve a stale cached logo after the org replaces it.
    const filename = `${orgId}-${randomUUID()}${ext}`;
    await this.storage.put(`logos/${filename}`, file.buffer, file.mimetype);

    // Served by app.useStaticAssets(...) in main.ts, mounted at /uploads/logos.
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
