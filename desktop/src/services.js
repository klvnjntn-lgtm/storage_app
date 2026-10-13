// Runs the WareSys stack on the main PC: the bundled PostgreSQL, then the
// NestJS backend and the Next.js frontend as child processes of Electron's
// own Node (ELECTRON_RUN_AS_NODE). Only the frontend listens on the office
// network, for the other PCs; it proxies /api to the backend, and the
// backend and database stay on 127.0.0.1.
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Client } = require('pg');
const config = require('./config');

const PG_PORT = 47432;
// Fixed: the frontend's /api rewrite to the backend is baked in at build
// time (scripts/stage.mjs builds it with BACKEND_URL on this port).
const BACKEND_PORT = 47330;
const FRONTEND_PORT = 47331;
const DB_NAME = 'waresys';
const PG_USER = 'postgres';

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
const pgBin = (name) => path.join(config.paths.resources(), 'postgres', 'bin', exe(name));
const backendDir = () => path.join(config.paths.resources(), 'backend');
const frontendDir = () => path.join(config.paths.resources(), 'frontend');

// ---- logs ----------------------------------------------------------------

function logFile(name) {
  const dir = config.paths.logs();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.log`);
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, `${file}.old`);
  } catch {
    // No log yet.
  }
  return file;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.message = `${path.basename(cmd)} failed: ${stderr || stdout || err.message}`;
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

function portInUse(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => srv.close(() => resolve(false)));
    srv.listen(port, '127.0.0.1');
  });
}

// ---- PostgreSQL ----------------------------------------------------------

async function initDatabaseCluster(password) {
  const pwfile = path.join(config.paths.logs(), `pw-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(config.paths.logs(), { recursive: true });
  fs.writeFileSync(pwfile, `${password}\n`, { mode: 0o600 });
  // Built in a temp folder and renamed at the end, so a failed initdb never
  // leaves a half-made pgdata that would be mistaken for a real one.
  const tmp = `${config.paths.pgdata()}.init`;
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    await run(pgBin('initdb'), [
      '-D', tmp,
      '-U', PG_USER,
      '--auth=scram-sha-256',
      `--pwfile=${pwfile}`,
      '--encoding=UTF8',
      // C locale: Windows locale names vary by language edition and initdb
      // rejects many of them; C works everywhere.
      '--locale=C',
    ]);
  } finally {
    fs.rmSync(pwfile, { force: true });
  }
  fs.renameSync(tmp, config.paths.pgdata());
}

async function postgresRunning() {
  try {
    await run(pgBin('pg_ctl'), ['status', '-D', config.paths.pgdata()]);
    return true;
  } catch {
    return false;
  }
}

async function startPostgres(cfg) {
  if (!fs.existsSync(path.join(config.paths.pgdata(), 'PG_VERSION'))) {
    await initDatabaseCluster(cfg.pgPassword);
  }
  // Left running by a crashed session: reuse it rather than fail.
  if (await postgresRunning()) return;
  if (await portInUse(PG_PORT)) {
    throw new Error(`Port ${PG_PORT} is already used by another program, so the WareSys database cannot start.`);
  }
  await runDetached(pgBin('pg_ctl'), [
    'start',
    '-D', config.paths.pgdata(),
    '-w', '-t', '120',
    '-l', logFile('postgres'),
    '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1`,
  ]);
}

// pg_ctl start leaves the server running with pg_ctl's stdout/stderr
// handles on Windows, so execFile (which waits for the pipes to close)
// would never return; this waits for pg_ctl's own exit with output
// ignored — the server logs to its -l file anyway.
function runDetached(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} exited with code ${code}. See ${path.join(config.paths.logs(), 'postgres.log')}.`));
    });
  });
}

async function stopPostgres() {
  if (!fs.existsSync(config.paths.pgdata()) || !(await postgresRunning())) return;
  // Fast shutdown: clean, so a backup copied afterwards needs no recovery.
  await run(pgBin('pg_ctl'), ['stop', '-D', config.paths.pgdata(), '-m', 'fast', '-w', '-t', '120']);
}

function pgClient(cfg, database) {
  return new Client({ host: '127.0.0.1', port: PG_PORT, user: PG_USER, password: cfg.pgPassword, database });
}

async function ensureDatabase(cfg) {
  const client = pgClient(cfg, 'postgres');
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (!rowCount) await client.query(`CREATE DATABASE ${DB_NAME}`);
  } finally {
    await client.end();
  }
}

// Same bookkeeping as `prisma migrate deploy` (the _prisma_migrations
// table, sha256 checksums), so the database stays a normal Prisma database
// — without shipping the Prisma CLI and its schema engine. Each file runs
// as one multi-statement query, i.e. one implicit transaction, as with
// Prisma.
async function migrate(cfg, onProgress) {
  const dir = path.join(backendDir(), 'prisma', 'migrations');
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort();

  const client = pgClient(cfg, DB_NAME);
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const { rows } = await client.query(
      'SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL',
    );
    const failed = rows.find((r) => !r.finished_at);
    if (failed) {
      throw new Error(`Database update "${failed.migration_name}" failed earlier. Restore a backup or contact support.`);
    }
    const applied = new Set(rows.map((r) => r.migration_name));
    const pending = names.filter((n) => !applied.has(n));

    for (const [i, name] of pending.entries()) {
      onProgress?.(`Updating database (${i + 1}/${pending.length})…`);
      const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf-8');
      const id = crypto.randomUUID();
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      await client.query(
        'INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ($1, $2, $3)',
        [id, checksum, name],
      );
      try {
        await client.query(sql);
      } catch (err) {
        await client.query('UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1', [id, String(err.stack || err)]);
        throw new Error(`Database update "${name}" failed: ${err.message}`);
      }
      await client.query(
        'UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1',
        [id],
      );
    }
  } finally {
    await client.end();
  }
}

// ---- backend & frontend ----------------------------------------------------

// Puppeteer renders PDFs with an installed Chromium browser instead of
// downloading its own: Edge ships with every Windows 10/11 PC.
function findBrowser() {
  const candidates =
    process.platform === 'win32'
      ? [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
          .filter(Boolean)
          .flatMap((base) => [
            path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          ])
      : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  return candidates.find((p) => fs.existsSync(p));
}

function spawnNode(name, script, cwd, env) {
  const out = fs.openSync(logFile(name), 'a');
  const child = spawn(process.execPath, [script], {
    cwd,
    env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production' },
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  fs.closeSync(out);
  return child;
}

async function waitForHttp(url, child, label, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  child.once('exit', () => (exited = true));
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The ${label} stopped while starting. See ${config.paths.logs()}.`);
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`The ${label} did not start within ${timeoutMs / 1000}s. See ${config.paths.logs()}.`);
}

// The backend and frontend PIDs, so a session that died without stopping
// them (a crash, Task Manager) doesn't leave them holding the ports.
const pidFile = () => path.join(config.paths.logs(), 'running.json');

function isOurProcess(pid) {
  try {
    if (process.platform === 'win32') {
      const out = require('child_process').execFileSync(
        'tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { encoding: 'utf-8', windowsHide: true },
      );
      return out.toLowerCase().includes(`"${path.basename(process.execPath).toLowerCase()}"`);
    }
    return fs.readlinkSync(`/proc/${pid}/exe`) === process.execPath;
  } catch {
    return false;
  }
}

async function killLeftovers() {
  let pids = [];
  try {
    pids = JSON.parse(fs.readFileSync(pidFile(), 'utf-8'));
  } catch {
    return;
  }
  let killed = false;
  for (const pid of pids) {
    // A PID can be reused by an unrelated program: only kill it if it is
    // still this app's executable.
    if (pid !== process.pid && isOurProcess(pid)) {
      try {
        process.kill(pid);
        killed = true;
      } catch {
        // Already gone.
      }
    }
  }
  fs.rmSync(pidFile(), { force: true });
  if (killed) await new Promise((r) => setTimeout(r, 1500)); // let the ports free up
}

const frontendUrl = `http://127.0.0.1:${FRONTEND_PORT}`;
let children = [];

async function start(cfg, { onStatus, onCrash }) {
  onStatus('Starting database…');
  await startPostgres(cfg);
  await ensureDatabase(cfg);
  await migrate(cfg, onStatus);

  await killLeftovers();
  for (const port of [BACKEND_PORT, FRONTEND_PORT]) {
    if (await portInUse(port)) {
      throw new Error(`Port ${port} is already used by another program. Close it (or restart the PC) and open WareSys again.`);
    }
  }

  onStatus('Starting WareSys…');
  const build = config.buildConfig();
  const browser = findBrowser();
  fs.mkdirSync(config.paths.uploads(), { recursive: true });
  const backend = spawnNode('backend', path.join('dist', 'src', 'main.js'), backendDir(), {
    HOST: '127.0.0.1',
    PORT: String(BACKEND_PORT),
    DATABASE_URL: `postgresql://${PG_USER}:${encodeURIComponent(cfg.pgPassword)}@127.0.0.1:${PG_PORT}/${DB_NAME}?schema=public`,
    JWT_SECRET: cfg.jwtSecret,
    SUPERADMIN_SECRET: cfg.superadminSecret,
    PRINT_TOKEN_SECRET: cfg.printTokenSecret,
    FILE_URL_SECRET: cfg.fileUrlSecret,
    FRONTEND_URL: frontendUrl,
    APP_URL: frontendUrl,
    ALLOWED_ORIGINS: frontendUrl,
    UPLOADS_DIR: config.paths.uploads(),
    // One business per install: it gets the INVOICE_POS module at sign-up
    // (see auth.service.ts) since there is no platform owner to grant it.
    AUTO_ENABLE_MODULES: 'INVOICE_POS',
    SINGLE_ORGANIZATION: 'true',
    WARESYS_EDITION: 'desktop',
    LICENSE_KEY: cfg.licenseKey || '',
    LICENSE_FINGERPRINT: cfg.machineId,
    HOST_MACHINE_GUID: cfg.machineId,
    LICENSE_STATE_FILE: config.paths.licenseState(),
    KEYGEN_ACCOUNT_ID: build.keygenAccountId || '',
    PUPPETEER_SKIP_DOWNLOAD: 'true',
    ...(browser && { PUPPETEER_EXECUTABLE_PATH: browser }),
  });
  const frontend = spawnNode('frontend', 'server.js', frontendDir(), {
    HOSTNAME: '0.0.0.0',
    PORT: String(FRONTEND_PORT),
    // For the route handlers that stream uploads (lib/stream-proxy.ts).
    INTERNAL_API_URL: `http://127.0.0.1:${BACKEND_PORT}`,
  });
  children = [backend, frontend];
  fs.writeFileSync(pidFile(), JSON.stringify(children.map((c) => c.pid)));

  await Promise.all([
    waitForHttp(`http://127.0.0.1:${BACKEND_PORT}/health`, backend, 'WareSys server'),
    waitForHttp(`${frontendUrl}/login`, frontend, 'WareSys app'),
  ]);

  for (const [child, label] of [[backend, 'server'], [frontend, 'app']]) {
    child.once('exit', (code) => {
      if (children.includes(child)) onCrash(`The WareSys ${label} stopped unexpectedly (code ${code}). See ${config.paths.logs()}.`);
    });
  }
  return frontendUrl;
}

async function stop() {
  const running = children;
  children = [];
  fs.rmSync(pidFile(), { force: true });
  await Promise.all(
    running.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once('exit', resolve);
          child.kill();
          setTimeout(resolve, 10000);
        }),
    ),
  );
  await stopPostgres();
}

// Whether the business has been registered yet (the first launch opens
// the sign-up page instead of login).
async function hasOrganization(cfg) {
  const client = pgClient(cfg, DB_NAME);
  await client.connect();
  try {
    const { rows } = await client.query('SELECT EXISTS (SELECT 1 FROM "Organization") AS found');
    return rows[0].found;
  } finally {
    await client.end();
  }
}

async function licenseStatus() {
  const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/license/status`);
  return res.json();
}

module.exports = { start, stop, licenseStatus, hasOrganization, frontendUrl, FRONTEND_PORT };
