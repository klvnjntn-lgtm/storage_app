// Backups of the main PC's data: the database folder plus uploaded files.
// Only made when the customer exports one (File → Export Backup…), and
// only while PostgreSQL is stopped (the bundle has no pg_dump), so each
// one is consistent.
//
// Each backup is one .wsbak file, encrypted with a key derived from the
// business's license key: it only imports on an install with that same
// license, so a copied backup is useless to anyone else.
//
// File layout:
//   one JSON line   { format, version, createdAt, licenseId, salt, iv }
//   ciphertext      AES-256-GCM( gzip( archive ) )
//   16 bytes        GCM auth tag (detects tampering / the wrong key)
// The archive is a sequence of entries, each a JSON line
// { p: relative path, d: true } for a folder or { p, s: size } followed by
// s bytes of file content. The first entry is backup.json (metadata,
// including the database password).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable, Writable } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('./config');

const EXT = '.wsbak';
const FORMAT = 'waresys-backup';
const TAG_LEN = 16;

function defaultName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `WareSys-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${EXT}`;
}

// ---- keys ------------------------------------------------------------------

function licenseKey() {
  const key = config.load().licenseKey;
  if (!key) throw new Error('Enter the license key first: backups are tied to it.');
  return key;
}

// Lets a restore say "this backup is from a different license" before
// trying to decrypt. Not secret: anyone with the key can compute it.
const licenseId = (key) => crypto.createHash('sha256').update(`waresys-backup-id:${key}`).digest('hex').slice(0, 16);

const deriveKey = (key, salt) => crypto.scryptSync(key, salt, 32);

// ---- archive ---------------------------------------------------------------

function* walk(root, prefix) {
  yield { p: prefix, d: true };
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full, rel);
    else if (entry.isFile()) yield { p: rel, full };
  }
}

async function* archive(meta) {
  const metaBytes = Buffer.from(JSON.stringify(meta));
  yield Buffer.from(`${JSON.stringify({ p: 'backup.json', s: metaBytes.length })}\n`);
  yield metaBytes;
  const roots = [['pgdata', config.paths.pgdata()], ['uploads', config.paths.uploads()]];
  for (const [prefix, dir] of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const item of walk(dir, prefix)) {
      if (item.d) {
        yield Buffer.from(`${JSON.stringify({ p: item.p, d: true })}\n`);
        continue;
      }
      const size = fs.statSync(item.full).size;
      yield Buffer.from(`${JSON.stringify({ p: item.p, s: size })}\n`);
      let left = size;
      for await (const chunk of fs.createReadStream(item.full)) {
        left -= chunk.length;
        yield chunk;
      }
      if (left !== 0) throw new Error(`${item.full} changed while it was being backed up.`);
    }
  }
}

// Unpacks an archive stream into dest, refusing any path outside it.
function extractor(dest) {
  let buf = Buffer.alloc(0);
  let file = null; // { fd, left }
  const safe = (rel) => {
    const target = path.resolve(dest, rel);
    if (!target.startsWith(path.resolve(dest) + path.sep)) throw new Error(`Bad path in backup: ${rel}`);
    return target;
  };
  return new Writable({
    write(chunk, _enc, cb) {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        for (;;) {
          if (file) {
            const n = Math.min(file.left, buf.length);
            if (n) fs.writeSync(file.fd, buf, 0, n);
            file.left -= n;
            buf = buf.subarray(n);
            if (file.left > 0) break;
            fs.closeSync(file.fd);
            file = null;
          }
          const nl = buf.indexOf(10);
          if (nl === -1) break;
          const entry = JSON.parse(buf.subarray(0, nl).toString());
          buf = buf.subarray(nl + 1);
          const target = safe(entry.p);
          if (entry.d) {
            fs.mkdirSync(target, { recursive: true });
          } else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            file = { fd: fs.openSync(target, 'w'), left: entry.s };
          }
        }
        cb();
      } catch (err) {
        cb(err);
      }
    },
    final(cb) {
      cb(file || buf.length ? new Error('The backup file is incomplete.') : null);
    },
    destroy(err, cb) {
      if (file) fs.closeSync(file.fd);
      cb(err);
    },
  });
}

// ---- backup / restore --------------------------------------------------------

// Call only while PostgreSQL is stopped.
async function create(target) {
  if (!fs.existsSync(path.join(config.paths.pgdata(), 'PG_VERSION'))) {
    throw new Error('There is no data to back up yet.');
  }
  const key = licenseKey();
  // Written under a temp name first: a half-written file must never be
  // mistaken for a good backup (or replace one being overwritten).
  const tmp = `${target}.partial`;

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const header = {
    format: FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    licenseId: licenseId(key),
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
  };
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(key, salt), iv);
  const out = fs.createWriteStream(tmp);
  out.write(`${JSON.stringify(header)}\n`);
  try {
    // The database password goes with its data, so the backup also
    // restores on a new main PC (a new install generates a different one).
    const meta = { createdAt: header.createdAt, pgPassword: config.load().pgPassword };
    await pipeline(Readable.from(archive(meta)), zlib.createGzip(), cipher, out, { end: false });
    await new Promise((resolve, reject) => out.end(cipher.getAuthTag(), (err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  fs.renameSync(tmp, target);
  return target;
}

function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const nl = buf.subarray(0, n).indexOf(10);
    const header = nl > 0 ? JSON.parse(buf.subarray(0, nl).toString()) : null;
    if (header?.format !== FORMAT) throw new Error();
    return { header, offset: nl + 1, size: fs.fstatSync(fd).size };
  } catch {
    throw new Error('That file is not a WareSys backup.');
  } finally {
    fs.closeSync(fd);
  }
}

// Call only while PostgreSQL is stopped. Decrypts into a temp folder first,
// so a wrong or damaged file never touches the live data. The current data
// is kept beside it (pgdata-before-restore) until the next restore, in case
// the wrong backup was picked.
async function restore(file) {
  const { header, offset, size } = readHeader(file);
  const key = licenseKey();
  if (header.licenseId !== licenseId(key)) {
    throw new Error('This backup belongs to a different WareSys license, so it cannot be imported here.');
  }
  const fd = fs.openSync(file, 'r');
  const tag = Buffer.alloc(TAG_LEN);
  fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
  fs.closeSync(fd);

  const staging = path.join(path.dirname(config.paths.pgdata()), 'restore-staging');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey(key, Buffer.from(header.salt, 'hex')),
    Buffer.from(header.iv, 'hex'),
  );
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(file, { start: offset, end: size - TAG_LEN - 1 }),
      decipher,
      zlib.createGunzip(),
      extractor(staging),
    );
    if (!fs.existsSync(path.join(staging, 'pgdata', 'PG_VERSION'))) throw new Error('no database in backup');
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`This backup could not be read — it is damaged or was changed. (${err.message})`);
  }

  const meta = JSON.parse(fs.readFileSync(path.join(staging, 'backup.json'), 'utf-8'));
  const { pgdata, uploads } = config.paths;
  for (const live of [pgdata(), uploads()]) {
    const kept = `${live}-before-restore`;
    fs.rmSync(kept, { recursive: true, force: true });
    if (fs.existsSync(live)) fs.renameSync(live, kept);
  }
  fs.renameSync(path.join(staging, 'pgdata'), pgdata());
  // PostgreSQL refuses a data folder others can read (not checked on Windows).
  if (process.platform !== 'win32') fs.chmodSync(pgdata(), 0o700);
  if (fs.existsSync(path.join(staging, 'uploads'))) fs.renameSync(path.join(staging, 'uploads'), uploads());
  fs.rmSync(staging, { recursive: true, force: true });
  if (meta.pgPassword) config.update({ pgPassword: meta.pgPassword });
}

module.exports = { create, restore, defaultName };
