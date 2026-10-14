import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

// Encrypts small secrets at rest (TOTP seeds, so a database dump alone
// can't mint someone's codes). AES-256-GCM with a key from
// SECRET_BOX_KEY, falling back to one derived from JWT_SECRET — a
// purpose label keeps it from being the JWT key itself. Output:
// "v1.<iv>.<tag>.<ciphertext>", base64url.

function key(): Buffer {
  const material = process.env.SECRET_BOX_KEY || process.env.JWT_SECRET;
  if (!material)
    throw new Error(
      'SECRET_BOX_KEY/JWT_SECRET is not set — cannot encrypt secrets',
    );
  return createHash('sha256')
    .update(`waresys-secret-box\n${material}`)
    .digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

export function open(sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data)
    throw new Error('Unrecognised sealed secret');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
