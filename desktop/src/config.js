// Everything this install keeps on disk, under the per-user app data folder
// (%APPDATA%\WareSys on Windows): settings and generated secrets, the
// database, uploaded files and logs.
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dataDir = () => app.getPath('userData');

const paths = {
  config: () => path.join(dataDir(), 'config.json'),
  pgdata: () => path.join(dataDir(), 'pgdata'),
  uploads: () => path.join(dataDir(), 'uploads'),
  licenseState: () => path.join(dataDir(), 'license-state.json'),
  logs: () => path.join(dataDir(), 'logs'),
  // Bundled backend, frontend and Postgres: next to the exe once packaged,
  // desktop/app/ (filled by scripts/stage.mjs) when run from source.
  resources: () => (app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'app')),
};

const secret = () => crypto.randomBytes(32).toString('hex');

function load() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(paths.config(), 'utf-8'));
  } catch {
    // First run (or an unreadable file): start fresh. Losing the secrets
    // only logs everyone out; the database password is fixed at initdb
    // time, so it is the one value never regenerated once pgdata exists.
  }
  let changed = false;
  // superadminSecret: per install, as release/install.ps1 generates it —
  // for the admin-key routes (seat limit, modules) on this main PC.
  for (const key of ['pgPassword', 'jwtSecret', 'printTokenSecret', 'fileUrlSecret', 'superadminSecret']) {
    if (!cfg[key]) {
      if (key === 'pgPassword' && fs.existsSync(paths.pgdata())) {
        throw new Error(`The database password is missing from ${paths.config()}.`);
      }
      cfg[key] = secret();
      changed = true;
    }
  }
  if (changed) save(cfg);
  return cfg;
}

function save(cfg) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${paths.config()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, paths.config());
}

function update(patch) {
  const cfg = { ...load(), ...patch };
  save(cfg);
  return cfg;
}

// The same machine ID release/install.ps1 uses for the license
// fingerprint, so a key activates the same way on either install.
function machineId() {
  if (process.platform === 'win32') {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf-8', windowsHide: true },
    );
    const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
    if (!match) throw new Error('Could not read this PC\'s MachineGuid.');
    return match[1];
  }
  return fs.readFileSync('/etc/machine-id', 'utf-8').trim();
}

// Values baked in by scripts/stage.mjs (e.g. the Keygen account).
function buildConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(paths.resources(), 'build-config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

module.exports = { paths, load, update, machineId, buildConfig };
