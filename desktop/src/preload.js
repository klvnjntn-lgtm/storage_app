// Runs before every page in the window (sandboxed, context-isolated).
const { contextBridge, ipcRenderer } = require('electron');

const versionArg = process.argv.find((a) => a.startsWith('--waresys-version='));

// Read by the frontend (lib/desktop.ts) to switch to the desktop app's
// Sales / Purchasing / Accounting-only navigation.
contextBridge.exposeInMainWorld('waresysDesktop', {
  isDesktop: true,
  version: versionArg ? versionArg.split('=')[1] : '',
});

// Only the app's own startup screen (a local file) gets these; the WareSys
// pages served over http never see them.
if (window.location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('waresysUi', {
    onState: (cb) => ipcRenderer.on('ui:state', (_e, state) => cb(state)),
    ready: () => ipcRenderer.send('ui:ready'),
    chooseRole: (role) => ipcRenderer.send('ui:role', role),
    submitLicense: (key) => ipcRenderer.send('ui:license', key),
    search: () => ipcRenderer.send('ui:search'),
    // A found PC: { name, addresses }; a typed one: { address }.
    connect: (target) => ipcRenderer.send('ui:connect', target),
    back: () => ipcRenderer.send('ui:back'),
    chooseMain: () => ipcRenderer.send('ui:choose-main'),
    retry: () => ipcRenderer.send('ui:retry'),
    restore: () => ipcRenderer.send('ui:restore'),
    openLogs: () => ipcRenderer.send('ui:open-logs'),
  });
}
