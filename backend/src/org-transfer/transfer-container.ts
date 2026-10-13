// The .wsexport file: one organization's data (see org-transfer.service.ts)
// in a password-encrypted container, so it can move between WareSys
// installs — web to desktop and back.
//
//   one JSON line   ExportHeader (readable without the password)
//   ciphertext      AES-256-GCM( gzip( entries ) ), key = scrypt(password)
//   16 bytes        GCM auth tag (wrong password or a changed file)
//
// Entries follow each other: a JSON line { name, size } then `size` bytes.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip, createGzip } from 'zlib';

export const EXPORT_FORMAT = 'waresys-export';
export const EXPORT_VERSION = 1;
const TAG_LEN = 16;
export const MIN_PASSWORD_LENGTH = 8;

export type ExportHeader = {
  format: typeof EXPORT_FORMAT;
  version: number;
  createdAt: string;
  organizationName: string;
  // The last database migration of the install that made it: an import
  // needs the same one, i.e. the same WareSys version on both sides.
  migration: string;
  salt: string;
  iv: string;
};

export type Entry = {
  name: string;
  data: Buffer | (() => AsyncIterable<Buffer>);
  size: number;
};

const deriveKey = (password: string, salt: Buffer) =>
  scryptSync(password, salt, 32);

export async function writeContainer(
  file: string,
  meta: Omit<ExportHeader, 'format' | 'version' | 'salt' | 'iv'>,
  password: string,
  entries: Iterable<Entry> | AsyncIterable<Entry>,
): Promise<void> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header: ExportHeader = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    ...meta,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
  };
  const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const out = createWriteStream(file);
  out.write(`${JSON.stringify(header)}\n`);

  async function* body() {
    for await (const entry of entries) {
      yield Buffer.from(
        `${JSON.stringify({ name: entry.name, size: entry.size })}\n`,
      );
      if (Buffer.isBuffer(entry.data)) {
        yield entry.data;
        continue;
      }
      let written = 0;
      for await (const chunk of entry.data()) {
        written += chunk.length;
        yield chunk;
      }
      if (written !== entry.size)
        throw new Error(`${entry.name} changed while it was being exported`);
    }
  }

  await pipeline(Readable.from(body()), createGzip(), cipher, out, {
    end: false,
  });
  await new Promise<void>((resolve, reject) =>
    out.end(cipher.getAuthTag(), () =>
      out.errored ? reject(out.errored) : resolve(),
    ),
  );
}

export async function readHeader(
  file: string,
): Promise<{ header: ExportHeader; offset: number; size: number }> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const buf = Buffer.alloc(2048);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const nl = buf.subarray(0, bytesRead).indexOf(10);
    let header: ExportHeader | null = null;
    try {
      header =
        nl > 0
          ? (JSON.parse(buf.subarray(0, nl).toString()) as ExportHeader)
          : null;
    } catch {
      header = null;
    }
    if (header?.format !== EXPORT_FORMAT || size < nl + 1 + TAG_LEN) {
      throw new ContainerError('This file is not a WareSys export.');
    }
    if (header.version !== EXPORT_VERSION) {
      throw new ContainerError(
        'This export was made by a different WareSys version. Update both installs to the same version.',
      );
    }
    return { header, offset: nl + 1, size };
  } finally {
    await handle.close();
  }
}

export class ContainerError extends Error {}

// Calls onEntry for each entry in order. Entries are only trustworthy once
// this resolves: the auth tag (password / integrity) is checked at the very
// end, so callers must stage what they get and commit nothing before then.
export async function readContainer(
  file: string,
  password: string,
  onEntry: (name: string, data: Buffer) => Promise<void>,
): Promise<ExportHeader> {
  const { header, offset, size } = await readHeader(file);
  const handle = await fs.open(file, 'r');
  const tag = Buffer.alloc(TAG_LEN);
  try {
    await handle.read(tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    await handle.close();
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(password, Buffer.from(header.salt, 'hex')),
    Buffer.from(header.iv, 'hex'),
  );
  decipher.setAuthTag(tag);

  let buf: Buffer = Buffer.alloc(0);
  let current: { name: string; size: number } | null = null;
  const parser = new Writable({
    write(chunk: Buffer, _enc, cb) {
      (async () => {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        for (;;) {
          if (!current) {
            const nl = buf.indexOf(10);
            if (nl === -1) return;
            current = JSON.parse(buf.subarray(0, nl).toString()) as {
              name: string;
              size: number;
            };
            buf = buf.subarray(nl + 1);
          }
          if (buf.length < current.size) return;
          const data = buf.subarray(0, current.size);
          buf = buf.subarray(current.size);
          const { name } = current;
          current = null;
          await onEntry(name, Buffer.from(data));
        }
      })().then(() => cb(), cb);
    },
    final(cb) {
      cb(
        current || buf.length
          ? new ContainerError('The export file is incomplete.')
          : null,
      );
    },
  });

  try {
    await pipeline(
      createReadStream(file, { start: offset, end: size - TAG_LEN - 1 }),
      decipher,
      createGunzip(),
      parser,
    );
  } catch (err) {
    if (err instanceof ContainerError) throw err;
    throw new ContainerError('Wrong password, or the export file is damaged.');
  }
  return header;
}
