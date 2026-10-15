// Meridian desktop shell (Electron). Serves the web build from a private
// app:// origin, keeps save games as gzip files in the user's data folder and
// exposes them to the game through the preload bridge (window.meridianNative).
const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

// Tests point the app at a throwaway data folder.
if (process.env.MERIDIAN_USER_DATA) app.setPath('userData', process.env.MERIDIAN_USER_DATA);

const webRoot = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'dist');
const savesDir = () => path.join(app.getPath('userData'), 'saves');

/** Save slot ids come from the game; never let them escape the saves folder. */
function slotPath(id, ext) {
  if (typeof id !== 'string' || !/^[\w-]{1,96}$/.test(id)) throw new Error('Invalid save slot id');
  return path.join(savesDir(), `${id}${ext}`);
}

async function listSlots() {
  await fs.mkdir(savesDir(), { recursive: true });
  const out = [];
  for (const f of await fs.readdir(savesDir())) {
    if (!f.endsWith('.meta.json')) continue;
    const id = f.slice(0, -'.meta.json'.length);
    try {
      const meta = JSON.parse(await fs.readFile(slotPath(id, '.meta.json'), 'utf8'));
      const stat = await fs.stat(slotPath(id, '.json.gz'));
      out.push({ id, meta: meta.meta, thumbnail: meta.thumbnail ?? '', bytes: stat.size });
    } catch {
      // Ignore half-written or foreign files.
    }
  }
  return out.sort((a, b) => (a.meta.savedAt < b.meta.savedAt ? 1 : -1));
}

async function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

// -- Updates: new versions come from the GitHub releases of the Meridian repository.
// They download quietly in the background and install when the game closes;
// the game's Update button can check now and restart into a new version.
let updater = null;
let updateState = { status: 'idle' };
function sendUpdate(state) {
  updateState = state;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', state);
}
function setupUpdates() {
  if (!app.isPackaged || process.argv.includes('--e2e')) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => sendUpdate({ status: 'checking' }));
  updater.on('update-available', (i) => sendUpdate({ status: 'downloading', version: i.version, percent: 0 }));
  updater.on('update-not-available', () => sendUpdate({ status: 'latest', version: app.getVersion() }));
  updater.on('download-progress', (p) => sendUpdate({ ...updateState, status: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (i) => sendUpdate({ status: 'ready', version: i.version }));
  updater.on('error', (e) => sendUpdate({ status: 'error', message: String(e && e.message ? e.message : e).slice(0, 200) }));
  const check = () => updater.checkForUpdates().catch(() => undefined);
  setTimeout(check, 8_000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

function registerIpc() {
  ipcMain.handle('update:check', async () => {
    if (!updater) return { status: 'unavailable', version: app.getVersion() };
    await updater.checkForUpdates().catch(() => undefined);
    return updateState;
  });
  ipcMain.handle('update:state', () => (updater ? updateState : { status: 'unavailable', version: app.getVersion() }));
  ipcMain.on('update:install', () => {
    if (!updater || updateState.status !== 'ready') return;
    quitting = true;
    updater.quitAndInstall(true, true);
  });
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('saves:list', () => listSlots());
  ipcMain.handle('saves:save', async (_e, id, data, thumbnail) => {
    await fs.mkdir(savesDir(), { recursive: true });
    await writeAtomic(slotPath(id, '.json.gz'), await gzip(Buffer.from(JSON.stringify(data))));
    await writeAtomic(slotPath(id, '.meta.json'), JSON.stringify({ meta: data.meta, thumbnail }));
  });
  ipcMain.handle('saves:load', async (_e, id) => {
    try {
      return JSON.parse((await gunzip(await fs.readFile(slotPath(id, '.json.gz')))).toString('utf8'));
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    }
  });
  ipcMain.handle('saves:remove', async (_e, id) => {
    await fs.rm(slotPath(id, '.json.gz'), { force: true });
    await fs.rm(slotPath(id, '.meta.json'), { force: true });
  });
  ipcMain.on('app:quit', () => {
    quitting = true;
    app.quit();
  });
  ipcMain.on('app:fullscreen', (e, on) => BrowserWindow.fromWebContents(e.sender)?.setFullScreen(!!on));
  ipcMain.handle('app:is-fullscreen', (e) => !!BrowserWindow.fromWebContents(e.sender)?.isFullScreen());
}

/** Set once the game has agreed to quit (or the app is quitting for another reason). */
let quitting = false;

/** Window preferences (fullscreen on by default), kept beside the saves. */
const displayFile = () => path.join(app.getPath('userData'), 'display.json');
function readDisplay() {
  try {
    return { fullscreen: true, ...JSON.parse(require('node:fs').readFileSync(displayFile(), 'utf8')) };
  } catch {
    return { fullscreen: true };
  }
}
function writeDisplay(d) {
  require('node:fs').promises.mkdir(path.dirname(displayFile()), { recursive: true }).then(() => fs.writeFile(displayFile(), JSON.stringify(d))).catch(() => undefined);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0b1117',
    title: 'Meridian',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  // Start fullscreen unless the player left fullscreen last time (tests always run windowed).
  const e2e = process.argv.includes('--e2e');
  if (!e2e && readDisplay().fullscreen) win.setFullScreen(true);
  win.on('enter-full-screen', () => { if (!e2e) writeDisplay({ fullscreen: true }); });
  win.on('leave-full-screen', () => { if (!e2e) writeDisplay({ fullscreen: false }); });
  // Closing the window lets the game offer to save first; it quits through `app:quit`.
  win.on('close', (e) => {
    if (quitting || win.webContents.isCrashed()) return;
    e.preventDefault();
    win.webContents.send('app:close-requested');
  });
  win.once('ready-to-show', () => win.show());
  // F11 (or Ctrl+Cmd+F on a Mac) toggles fullscreen; the game handles every other key.
  win.webContents.on('before-input-event', (e, input) => {
    const macFull = input.meta && input.control && input.code === 'KeyF';
    if (input.type === 'keyDown' && (input.key === 'F11' || macFull)) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  // Links open in the system browser; the window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  const query = process.argv.includes('--e2e') ? '?e2e=1' : '';
  void win.loadURL(`app://meridian/index.html${query}`);
  return win;
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(webRoot, rel));
    if (!file.startsWith(webRoot)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  registerIpc();
  createWindow();
  setupUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quitting from code (the game, the OS or a test harness) skips the save prompt.
app.on('before-quit', () => {
  quitting = true;
});

// A game quits with its window, on a Mac too.
app.on('window-all-closed', () => {
  app.quit();
});
