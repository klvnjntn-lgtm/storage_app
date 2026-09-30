// src/storage/file-storage.interface.ts

export const FILE_STORAGE = Symbol('FILE_STORAGE');

// Where uploaded files live, addressed by a storage key — a relative,
// forward-slash path such as "media/<uuid>.webp" or
// "delivery-proofs/<orgId>/<uuid>.webp". The key is what the app stores
// and passes around; which backend holds the bytes (local disk today, an
// S3-compatible bucket later) is this interface's business only.
//
// Key prefixes carry visibility, not the storage backend:
// - media/, logos/        public, served at /uploads/<key>
// - delivery-proofs/      private, only via a signed URL (SignedFileUrlService)
export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  // Throws FileNotFoundError when the key doesn't exist.
  get(key: string): Promise<Buffer>;
  // No-op when the key doesn't exist.
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class FileNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`File not found: ${key}`);
  }
}

// Rejects anything that isn't a plain relative path, so a key can never
// escape the storage root (on disk) or the bucket prefix (in S3).
export function assertValidKey(key: string): void {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
}

export function contentTypeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'webp':
      return 'image/webp';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
