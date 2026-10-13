// electron-builder never copies node_modules folders through
// extraResources, and the bundled backend and frontend need theirs. So the
// staged stack (desktop/app, from scripts/stage.mjs) is copied in here,
// after packing and before the installer is built.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack({ appOutDir }) {
  const from = path.join(__dirname, '..', 'app');
  const to = path.join(appOutDir, 'resources');
  for (const name of ['frontend', 'backend', 'postgres', 'build-config.json']) {
    fs.rmSync(path.join(to, name), { recursive: true, force: true });
    fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true, verbatimSymlinks: true });
  }
};
