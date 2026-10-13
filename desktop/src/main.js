// WareSys desktop: Sales / Purchasing / Accounting for an office of PCs
// sharing one database. Each PC is set up once as either:
//   main   — holds the data: runs the stack (services.js), takes backups,
//            holds the license and answers discovery (discovery.js);
//   client — runs nothing locally and opens the main PC's WareSys.
// The window shows the startup screen (ui/status.html) until the WareSys
// frontend is ready, then the frontend itself.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const services = require('./services');
const backups = require('./backups');
const discovery = require('./discovery');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let cfg = null;
let busy = false; // a start/stop/restore is in progress
let quitting = false;
let stackRunning = false; // main PC: services are up
let appOrigin = null; // the WareSys origin the window may show
let uiReady = null;

// ---- startup screen -------------------------------------------------------

// The window is destroyed as soon as it's closed, before quitting finishes.
const windowAlive = () => !!win && !win.isDestroyed();

function showUi(state) {
  if (!windowAlive()) return;
  const send = () => windowAlive() && win.webContents.send('ui:state', state);
  if (win.webContents.getURL().startsWith('file:')) {
    uiReady.then(send);
    return;
  }
  uiReady = new Promise((resolve) => ipcMain.once('ui:ready', resolve));
  win.loadFile(path.join(__dirname, 'ui', 'status.html'));
  uiReady.then(send);
}

function showError(message) {
  const actions = cfg?.role === 'client' ? ['retry', 'connect'] : ['retry', 'restore', 'logs'];
  showUi({ view: 'error', message, actions });
}

// Resolves with the first of `channels` the startup screen sends.
function waitForUi(...channels) {
  return new Promise((resolve) => {
    const handlers = channels.map((channel) => {
      const handler = (_e, value) => {
        channels.forEach((c, i) => ipcMain.removeListener(c, handlers[i]));
        resolve({ channel, value });
      };
      ipcMain.on(channel, handler);
      return handler;
    });
  });
}

async function chooseRole() {
  showUi({ view: 'role' });
  const { value } = await waitForUi('ui:role');
  cfg = { ...cfg, ...config.update({ role: value === 'main' ? 'main' : 'client' }) };
  buildMenu();
}

async function waitForLicense(message) {
  showUi({ view: 'license', message, licenseKey: cfg.licenseKey });
  const { value } = await waitForUi('ui:license');
  cfg = { ...cfg, ...config.update({ licenseKey: String(value).trim() }) };
}

// "192.168.1.10", "kasir-1:47331" or a full URL → http://host:port
function normalizeAddress(input) {
  let s = String(input).trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const url = new URL(s);
  if (!url.port && url.protocol === 'http:') url.port = String(services.FRONTEND_PORT);
  return url.origin;
}

// The first of `addresses` where WareSys answers, or null.
async function firstReachable(addresses) {
  for (const address of addresses) if (await reachable(address)) return address;
  return null;
}

async function reachable(address) {
  try {
    const res = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Client setup: pick a main PC found on the network, or type its address.
async function chooseMainPc() {
  const searchAndShow = async (message) => {
    showUi({ view: 'connect', searching: true, message });
    showUi({ view: 'connect', found: await discovery.search(), message });
  };
  await searchAndShow();
  for (;;) {
    const { channel, value } = await waitForUi('ui:connect', 'ui:search', 'ui:back');
    if (channel === 'ui:back') return false;
    if (channel === 'ui:search') {
      await searchAndShow();
      continue;
    }
    let addresses;
    try {
      addresses = value.addresses || [normalizeAddress(value.address)];
    } catch {
      await searchAndShow(`"${value.address}" is not a valid address.`);
      continue;
    }
    showUi({ view: 'loading', message: `Connecting to ${value.name || addresses[0]}…` });
    const address = await firstReachable(addresses);
    if (address) {
      cfg = { ...cfg, ...config.update({ mainAddress: address, mainName: value.name || '' }) };
      return true;
    }
    await searchAndShow(`WareSys is not answering at ${addresses.join(', ')}. Check that the main PC is on and WareSys is open on it.`);
  }
}

// ---- lifecycle -------------------------------------------------------------

async function boot() {
  if (busy) return;
  busy = true;
  try {
    cfg = { ...config.load(), machineId: config.machineId() };
    for (;;) {
      if (!cfg.role) await chooseRole();
      if (cfg.role === 'main') {
        await bootMain();
        break;
      }
      if (await bootClient()) break;
      // Went back from "connect" to the role choice.
      cfg = { ...cfg, ...config.update({ role: null }) };
    }
  } catch (err) {
    if (cfg?.role === 'main') await stopStack();
    showError(err.message || String(err));
  } finally {
    busy = false;
  }
}

async function bootMain() {
  if (!cfg.licenseKey) await waitForLicense();
  for (;;) {
    showUi({ view: 'loading', message: 'Starting…' });
    const url = await services.start(cfg, {
      onStatus: (message) => showUi({ view: 'loading', message }),
      onCrash,
    });
    stackRunning = true;

    const license = await services.licenseStatus();
    if (license.valid) {
      discovery.startResponder({ port: services.FRONTEND_PORT });
      appOrigin = url;
      const registered = await services.hasOrganization(cfg);
      await win.loadURL(`${url}${registered ? '/sales' : '/register'}`);
      return;
    }
    await stopStack();
    await waitForLicense(
      `This license could not be activated (${license.status}). Check the key and that this PC is online, then try again.`,
    );
  }
}

// Returns false if the user went back to the role choice.
async function bootClient() {
  if (!cfg.mainAddress && !(await chooseMainPc())) return false;
  showUi({ view: 'loading', message: `Connecting to ${cfg.mainName || cfg.mainAddress}…` });
  if (!(await reachable(cfg.mainAddress))) {
    // The main PC may have a new IP address since last time: look for it
    // by name.
    const moved = cfg.mainName && (await discovery.search()).find((pc) => pc.name === cfg.mainName);
    const address = moved && (await firstReachable(moved.addresses));
    if (!address) {
      throw new Error(
        `Cannot reach the main PC (${cfg.mainName || cfg.mainAddress}). Check that it is on, WareSys is open on it, and this PC is on the same network.`,
      );
    }
    cfg = { ...cfg, ...config.update({ mainAddress: address }) };
  }
  appOrigin = cfg.mainAddress;
  await win.loadURL(`${cfg.mainAddress}/sales`);
  return true;
}

async function stopStack() {
  discovery.stopResponder();
  stackRunning = false;
  await services.stop().catch((err) => console.error('Stop failed:', err));
}

function onCrash(message) {
  if (quitting || busy) return;
  stopStack();
  showError(message);
}

// Main PC: stops the stack, runs fn with the database stopped, then starts
// again.
async function withStackStopped(message, fn) {
  if (busy) return;
  busy = true;
  try {
    showUi({ view: 'loading', message });
    await stopStack();
    await fn();
  } catch (err) {
    busy = false;
    showError(err.message || String(err));
    return;
  }
  busy = false;
  await boot();
}

// Backups only happen when the customer exports one, to wherever they
// choose (a USB drive, a cloud-synced folder…).
async function exportBackup() {
  if (busy) return;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export WareSys backup',
    defaultPath: path.join(app.getPath('documents'), backups.defaultName()),
    filters: [{ name: 'WareSys backup', extensions: ['wsbak'] }],
  });
  if (canceled || !filePath) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Export', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Export a backup now?',
    detail: 'WareSys stops for a moment while the backup is made, so the other PCs briefly lose their connection.',
  });
  if (response !== 0) return;
  let saved = false;
  await withStackStopped('Exporting backup…', async () => {
    await backups.create(filePath);
    saved = true;
  });
  if (saved) dialog.showMessageBox(win, { type: 'info', message: 'Backup exported', detail: filePath });
}

async function restoreBackup() {
  if (busy) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import WareSys backup',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'WareSys backup', extensions: ['wsbak'] }],
  });
  if (canceled || !filePaths[0]) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Import', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Replace all current data with this backup?',
    detail: `${filePaths[0]}\n\nEverything entered after this backup was made will be replaced, for every PC. The current data is kept in ${config.paths.pgdata()}-before-restore until the next import.`,
  });
  if (response !== 0) return;
  await withStackStopped('Importing backup…', () => backups.restore(filePaths[0]));
}

async function changeLicense() {
  await withStackStopped('Stopping…', () => waitForLicense());
}

async function connectToOtherMainPc() {
  if (busy) return;
  cfg = { ...cfg, ...config.update({ mainAddress: null, mainName: null }) };
  await boot();
}

async function changeRole() {
  if (busy) return;
  const isMain = cfg.role === 'main';
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Change', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: isMain ? 'Stop using this PC as the main PC?' : 'Change how this PC connects?',
    detail: isMain
      ? 'The other PCs will not be able to use WareSys until another main PC is set up. The data stays on this PC (and in its backups) and is used again if you make this the main PC later.'
      : 'You can make this PC the main PC (which holds the data) or connect it to a different main PC.',
  });
  if (response !== 0) return;
  if (isMain) {
    busy = true;
    showUi({ view: 'loading', message: 'Stopping…' });
    await stopStack();
    busy = false;
  }
  cfg = { ...cfg, ...config.update({ role: null, mainAddress: null, mainName: null }) };
  appOrigin = null;
  buildMenu();
  await boot();
}

function showAddress() {
  const addresses = discovery.lanAddresses().map((ip) => `http://${ip}:${services.FRONTEND_PORT}`);
  dialog.showMessageBox(win, {
    type: 'info',
    message: 'This is the main PC',
    detail: `Other PCs find it automatically when they choose "Connect to the main PC". If they can't, type one of these addresses there:\n\n${addresses.join('\n') || '(not connected to a network)'}`,
  });
}

// ---- window & menu --------------------------------------------------------

function sameOrigin(url) {
  try {
    return !!appOrigin && new URL(url).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (/^https?:/i.test(url)) shell.openExternal(url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'WareSys',
    backgroundColor: '#f8fafc',
    icon: path.join(__dirname, 'ui', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [`--waresys-version=${app.getVersion()}`],
    },
  });
  win.maximize();
  win.once('ready-to-show', () => win.show());

  // Only WareSys opens inside the window; links anywhere else go to the
  // default browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (sameOrigin(url) || url.startsWith('file:')) return;
    e.preventDefault();
    openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true } },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  // A client that loses the main PC mid-session gets the "cannot reach"
  // screen instead of Chromium's error page.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || url.startsWith('file:') || busy || quitting) return;
    showError(
      cfg?.role === 'client'
        ? `Lost the connection to the main PC (${cfg.mainName || cfg.mainAddress}). Check that it is on and WareSys is open on it.`
        : `WareSys did not load (${code}). See ${config.paths.logs()}.`,
    );
  });
}

function buildMenu() {
  const role = cfg?.role;
  const fileMenu =
    role === 'main'
      ? [
          { label: 'Export Backup…', click: exportBackup },
          { label: 'Import Backup…', click: restoreBackup },
          { type: 'separator' },
          { label: "This PC's Address…", click: showAddress },
          { label: 'Change License Key…', click: changeLicense },
          { label: 'Change PC Role…', click: changeRole },
        ]
      : role === 'client'
        ? [
            { label: 'Connect to a Different Main PC…', click: connectToOtherMainPc },
            { label: 'Change PC Role…', click: changeRole },
          ]
        : [];
  const template = [
    {
      label: 'File',
      submenu: [
        ...fileMenu,
        ...(fileMenu.length ? [{ type: 'separator' }] : []),
        { label: 'Open Logs Folder', click: () => openFolder(config.paths.logs()) },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About WareSys',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              message: `WareSys ${app.getVersion()}`,
              detail:
                role === 'client'
                  ? `Connected to the main PC: ${cfg.mainName || ''} ${cfg.mainAddress || ''}`
                  : `Data: ${app.getPath('userData')}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
}

ipcMain.on('ui:retry', () => {
  // The stack is fine (e.g. a reload failed): just reload.
  if (cfg?.role === 'main' && stackRunning) win.loadURL(`${appOrigin}/sales`);
  else boot();
});
ipcMain.on('ui:restore', () => restoreBackup());
ipcMain.on('ui:open-logs', () => openFolder(config.paths.logs()));
ipcMain.on('ui:choose-main', () => connectToOtherMainPc());

app.on('second-instance', () => {
  if (!windowAlive()) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  // Camera for barcode scanning and clipboard writes; nothing else (no
  // location, notifications or microphone).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (permission === 'media') return cb(!(details.mediaTypes || []).includes('audio'));
    cb(['clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
  cfg = config.load();
  buildMenu();
  createWindow();
  boot();
});

// Main PC: stop the stack before exiting, so the database always shuts
// down cleanly.
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  if (cfg?.role !== 'main') return;
  e.preventDefault();
  if (windowAlive()) win.hide();
  (async () => {
    try {
      await stopStack();
    } catch (err) {
      console.error('Shutdown failed:', err);
    }
    app.exit(0);
  })();
});

app.on('window-all-closed', () => app.quit());
