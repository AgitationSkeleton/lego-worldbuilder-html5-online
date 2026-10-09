// What the app tells the game's page: that it is the app (the settings then show its version
// rather than offer the download), and when an update is ready to install.
const { contextBridge, ipcRenderer } = require('electron');

let ready = null;
const listeners = [];
ipcRenderer.on('update-ready', (_event, version) => {
  ready = version;
  for (const f of listeners) f(version);
});

contextBridge.exposeInMainWorld('worldbuilderApp', {
  version: ipcRenderer.sendSync('app-version'),
  onUpdateReady(f) {
    if (ready) f(ready);
    else listeners.push(f);
  },
});
