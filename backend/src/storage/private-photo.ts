// src/storage/private-photo.ts
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;

// One encode at upload, then never touched again — private photos (proofs,
// customer location photos) keep their quality; no gallery-style hard
// recompression.
const MAX_DIMENSION = 2000;
const QUALITY = 85;

// Validates an uploaded phone photo and re-encodes it to WebP, applying
// EXIF orientation before the metadata is stripped.
export async function encodePrivatePhoto(
  file: Express.Multer.File | undefined,
): Promise<Buffer> {
  if (!file) throw new BadRequestException('No file uploaded');
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new BadRequestException('Photo must be PNG, JPEG or WebP');
  }
  if (file.size > MAX_PHOTO_UPLOAD_BYTES)
    throw new BadRequestException('Photo exceeds 10MB');
  try {
    return await sharp(file.buffer)
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: QUALITY })
      .toBuffer();
  } catch {
    throw new BadRequestException('Uploaded file is not a valid image');
  }
}
