// LEGO World Builder Online as an app (Electron): the same game as the website, from files
// that come with the app, in a window of its own.  On starting, it looks for a newer version on
// the repository's GitHub Releases and, if there is one, fetches it and installs it on quitting.
//
// The game's files are served as app://game/..., a scheme of the app's own (a page from file://
// may not fetch its own data).  The score tables, races and the random missions' log go to the
// same server as the website's.

const { app, BrowserWindow, protocol, net, shell, Menu, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// Where the game's files are: packaged, in the app's resources; run from the repository
// (npm start), the repository itself.
const GAME = app.isPackaged ? path.join(process.resourcesPath, 'game') : path.join(__dirname, '..');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function serveGame() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(GAME, rel));
    if (!file.startsWith(path.normalize(GAME))) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

let win = null;

// (for tests, tools/verify/app.py: --test-window=x,y opens the window there, shown without
// taking the focus from whatever has it, and muted)
const testAt = (process.argv.find((a) => a.startsWith('--test-window=')) || '').slice(14).split(',').map(Number);

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    ...(testAt.length === 2 ? { x: testAt[0], y: testAt[1], show: false } : {}),
    minWidth: 640,
    minHeight: 440,
    backgroundColor: '#ffffff',
    title: 'LEGO World Builder Online',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  if (testAt.length === 2) {
    win.webContents.setAudioMuted(true);
    win.showInactive();
  }
  // (--server=URL: another server, as ?server= on the website; for testing)
  const server = process.argv.find((a) => a.startsWith('--server='));
  win.loadURL('app://game/index.html' + (server ? '?server=' + encodeURIComponent(server.slice(9)) : ''));
  // Links out (the releases page, the credits) open in the browser, not in the game's window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // F11: full screen (the game's settings ask for it too).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', (info) => {
      if (win) win.webContents.send('update-ready', info.version);
    });
    autoUpdater.checkForUpdates().catch(() => {});
  } catch (e) {
    // (no updates, then)
  }
}

ipcMain.on('app-version', (event) => { event.returnValue = app.getVersion(); });

app.whenReady().then(() => {
  serveGame();
  createWindow();
  checkForUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
