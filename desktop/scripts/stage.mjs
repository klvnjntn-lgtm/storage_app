// Builds everything the desktop app runs into desktop/app/, for one target
// OS (default win32 — the .exe; pass --target=linux to run from source on
// Linux/WSL):
//   app/frontend   Next.js standalone server (desktop build, see next.config.ts)
//   app/backend    NestJS dist + production node_modules for the target OS
//   app/postgres   PostgreSQL 16 binaries for the target OS
//   app/build-config.json   values baked in at build time
//
// Env: KEYGEN_ACCOUNT_ID (defaults to the one in the repo's .env).
// Run from desktop/:  node scripts/stage.mjs [--target=win32|linux]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const out = path.join(desktop, 'app');
const target = (process.argv.find((a) => a.startsWith('--target=')) ?? '--target=win32').split('=')[1];
if (!['win32', 'linux'].includes(target)) throw new Error(`Unknown target ${target}`);

const BACKEND_PORT = 47330; // must match src/services.js
const POSTGRES_PKG = `@embedded-postgres/${target === 'win32' ? 'windows' : 'linux'}-x64@16.14.0-beta.17`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function sh(cmd, args, cwd, env = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}   (${path.relative(root, cwd) || '.'})`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
}
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);

// ---- frontend --------------------------------------------------------------
const fe = path.join(root, 'frontend');
sh(npm, ['run', 'build'], fe, { DESKTOP_BUILD: '1', BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}` });
const feOut = path.join(out, 'frontend');
copy(path.join(fe, '.next-desktop', 'standalone'), feOut);
copy(path.join(fe, 'public'), path.join(feOut, 'public'));
copy(path.join(fe, '.next-desktop', 'static'), path.join(feOut, '.next-desktop', 'static'));
// sharp is only for image optimization, which the desktop build turns off;
// its native binary is for the build machine's OS anyway.
for (const dir of ['@img', 'sharp']) fs.rmSync(path.join(feOut, 'node_modules', dir), { recursive: true, force: true });

// ---- backend ---------------------------------------------------------------
const be = path.join(root, 'backend');
sh(npm, ['run', 'build'], be);
const beOut = path.join(out, 'backend');
fs.mkdirSync(path.join(beOut, 'prisma'), { recursive: true });
copy(path.join(be, 'dist'), path.join(beOut, 'dist'));
copy(path.join(be, 'prisma', 'migrations'), path.join(beOut, 'prisma', 'migrations'));
for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(be, f), path.join(beOut, f));
// Prisma's query engine for the target OS only.
const schema = fs
  .readFileSync(path.join(be, 'prisma', 'schema.prisma'), 'utf-8')
  .replace(
    /provider\s*=\s*"prisma-client-js"/,
    `$&\n  binaryTargets = ["${target === 'win32' ? 'windows' : 'native'}"]`,
  );
fs.writeFileSync(path.join(beOut, 'prisma', 'schema.prisma'), schema);
// --os/--cpu pick the target's prebuilt native packages (sharp, bcrypt's
// prebuilds are all bundled). No install scripts: Puppeteer would download
// a Chrome (Edge is used instead) and Prisma generates just below.
sh(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${target}`, '--cpu=x64'], beOut);
sh(process.execPath, [path.join('node_modules', 'prisma', 'build', 'index.js'), 'generate', '--schema', path.join('prisma', 'schema.prisma')], beOut);
// Trim what only generating needs, or other databases would: the Prisma
// CLI (with its dependencies), TypeScript (an optional peer of the client),
// the client's runtimes for other databases and source maps.
sh(npm, ['uninstall', 'prisma', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${target}`, '--cpu=x64'], beOut);
const nm = path.join(beOut, 'node_modules');
fs.rmSync(path.join(nm, 'typescript'), { recursive: true, force: true });
for (const dir of [path.join(nm, '@prisma', 'client', 'runtime'), path.join(nm, '.prisma', 'client')]) {
  for (const f of fs.readdirSync(dir)) {
    if (/\.map$|mysql|sqlite|sqlserver|cockroachdb|\.wasm$|wasm-base64/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  }
}

// npm's .bin shims are symlinks (some now dangling after the trim above)
// that break the Windows installer's archive, and nothing runs them.
for (const dir of [beOut, feOut]) fs.rmSync(path.join(dir, 'node_modules', '.bin'), { recursive: true, force: true });

// ---- postgres --------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waresys-pg-'));
sh(npm, ['pack', POSTGRES_PKG, '--pack-destination', tmp], tmp);
const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
sh('tar', ['-xzf', tgz], tmp);
const pkg = path.join(tmp, 'package');
if (target === 'linux') sh(process.execPath, [path.join('scripts', 'hydrate-symlinks.js')], pkg);
copy(path.join(pkg, 'native'), path.join(out, 'postgres'));
fs.rmSync(tmp, { recursive: true, force: true });

// ---- build config ------------------------------------------------------------
// The same Keygen account as the server install: from the environment, else
// the repo's .env.
function envFileValue(name) {
  try {
    const line = fs.readFileSync(path.join(root, '.env'), 'utf-8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}
const keygenAccountId = process.env.KEYGEN_ACCOUNT_ID || envFileValue('KEYGEN_ACCOUNT_ID');
if (!keygenAccountId) {
  console.warn('\nWARNING: KEYGEN_ACCOUNT_ID is not set (env or ../.env) — this build cannot activate licenses.');
}
fs.writeFileSync(path.join(out, 'build-config.json'), JSON.stringify({ target, keygenAccountId }, null, 2));
console.log(`\nStaged for ${target} in ${out}`);
