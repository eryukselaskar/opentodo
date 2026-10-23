// OpenTodo desktop shell: serves the built app (dist/) from app://todo-plus
// so the data (localStorage) always lives under the same, fixed origin.
// Closing the window keeps the app running in the tray so reminders still fire.
const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, protocol, net, shell, session } = require('electron');
const { spawn } = require('node:child_process');
const { isNewer } = require('./version.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const ORIGIN = 'app://todo-plus';
const ICON = path.join(__dirname, 'icon.png');
const STARTED_HIDDEN = process.argv.includes('--hidden');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Keep the data folder from the Todo Plus days (%APPDATA%\todo-plus) whatever the app is called
app.setPath('userData', path.join(app.getPath('appData'), 'todo-plus'));

// Tray / notification texts follow the system language
const TR = () => app.getLocale().toLowerCase().startsWith('tr');
const L = (en, tr) => (TR() ? tr : en);

// One instance only: opening the app again shows the running one
if (!app.requestSingleInstanceLock()) app.quit();
// Windows shows notifications only for apps with an id
app.setAppUserModelId('com.todoplus.app');

let win = null;
let tray = null;
let quitting = false;

/** Small settings file next to the app data (first-run flags) */
const settingsFile = () => path.join(app.getPath('userData'), 'desktop-settings.json');
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeSettings(patch) {
  fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2));
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: !STARTED_HIDDEN,
    title: 'OpenTodo',
    icon: ICON,
    backgroundColor: '#080808',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      // Reminders are checked on a timer; keep it running while the window is hidden
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.loadURL(`${ORIGIN}/`);
  // Links open in the normal browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Closing hides to the tray; "Çık" in the tray menu really quits
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!readSettings().trayHintShown) {
      writeSettings({ trayHintShown: true });
      new Notification({
        title: L('OpenTodo is still running', 'OpenTodo arka planda çalışıyor'),
        body: L(
          'Reminders keep coming. To quit completely, right-click the tray icon and choose "Quit".',
          'Hatırlatmalar gelmeye devam edecek. Tamamen kapatmak için tepsideki simgeye sağ tıklayıp "Çık" deyin.'
        ),
        icon: ICON,
      }).show();
    }
  });
}

const LOGIN_ARGS = ['--hidden'];
const autoStartEnabled = () => app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin;
function setAutoStart(on) {
  app.setLoginItemSettings({ openAtLogin: on, args: LOGIN_ARGS });
}

function buildTrayMenu() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: L('Open OpenTodo', 'OpenTodo’yu aç'), click: showWindow },
      { type: 'separator' },
      {
        label: L('Start with Windows', 'Windows açılışında başlat'),
        type: 'checkbox',
        checked: autoStartEnabled(),
        enabled: app.isPackaged,
        click: (item) => {
          setAutoStart(item.checked);
          buildTrayMenu();
        },
      },
      { label: L('Check for updates', 'Güncellemeleri denetle'), enabled: app.isPackaged, click: () => checkForUpdate(true) },
      { type: 'separator' },
      { label: L('Quit', 'Çık'), click: () => app.quit() },
    ])
  );
}

function createTray() {
  tray = new Tray(ICON);
  tray.setToolTip('OpenTodo');
  tray.on('click', showWindow);
  buildTrayMenu();
}

// ---- Updates: compare with the latest GitHub release, download the installer and run it ----
const RELEASES_API = 'https://api.github.com/repos/eryukselaskar/opentodo/releases/latest';
let updateBusy = false;

async function installUpdate(version, url) {
  const file = path.join(app.getPath('temp'), `OpenTodo-Setup-${version}.exe`);
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  // The one-click installer replaces this version and starts the new one; data stays in %APPDATA%\todo-plus
  spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
  quitting = true;
  app.quit();
}

async function askToInstall(version, url) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'OpenTodo',
    message: L(`OpenTodo ${version} is available`, `OpenTodo ${version} çıktı`),
    detail: L(
      `You have ${app.getVersion()}. The update downloads and installs in a minute; your tasks stay where they are.`,
      `Sizdeki sürüm ${app.getVersion()}. Güncelleme bir dakikada inip kurulur; görevleriniz yerinde kalır.`
    ),
    buttons: [L('Install now', 'Şimdi kur'), L('Later', 'Sonra'), L('Skip this version', 'Bu sürümü atla')],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 2) writeSettings({ skippedVersion: version });
  if (response !== 0) return;
  try {
    await installUpdate(version, url);
  } catch {
    dialog.showErrorBox('OpenTodo', L('The update could not be downloaded. Try again later.', 'Güncelleme indirilemedi. Daha sonra tekrar deneyin.'));
  }
}

/** manual = from the tray menu: also report "up to date" and errors */
async function checkForUpdate(manual = false) {
  if (!app.isPackaged || updateBusy) return;
  updateBusy = true;
  try {
    const res = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenTodo' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const release = await res.json();
    const version = String(release.tag_name || '').replace(/^v/i, '');
    const asset = (release.assets || []).find((a) => /\.exe$/i.test(a.name));
    if (!asset || !isNewer(version, app.getVersion())) {
      if (manual) dialog.showMessageBox({ type: 'info', title: 'OpenTodo', message: L('OpenTodo is up to date.', 'OpenTodo güncel.') });
      return;
    }
    if (!manual && readSettings().skippedVersion === version) return;
    if (manual || (win && win.isVisible())) {
      await askToInstall(version, asset.browser_download_url);
    } else {
      // Running in the tray: a notification, the question comes when it is clicked
      const n = new Notification({
        title: L(`OpenTodo ${version} is available`, `OpenTodo ${version} çıktı`),
        body: L('Click to update.', 'Güncellemek için tıklayın.'),
        icon: ICON,
      });
      n.on('click', () => {
        showWindow();
        askToInstall(version, asset.browser_download_url);
      });
      n.show();
    }
  } catch {
    if (manual) dialog.showErrorBox('OpenTodo', L('Could not check for updates.', 'Güncellemeler denetlenemedi.'));
  } finally {
    updateBusy = false;
  }
}

/** /ollama/* goes to the local Ollama server (same path the dev server proxies) */
function proxyOllama(req, url) {
  const headers = new Headers(req.headers);
  headers.delete('origin');
  return net.fetch(`http://localhost:11434${url.pathname.slice('/ollama'.length)}${url.search}`, {
    method: req.method,
    headers,
    body: req.body,
    duplex: 'half',
  });
}

function serveFile(url) {
  const file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
  const exists = fs.existsSync(file) && fs.statSync(file).isFile();
  return net.fetch(pathToFileURL(exists ? file : path.join(DIST, 'index.html')).toString());
}

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    return url.pathname.startsWith('/ollama/') ? proxyOllama(req, url) : serveFile(url);
  });
  // Reminders (notifications) and the auto-backup folder need these
  const allowed = new Set(['notifications', 'fileSystem', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ipcMain.on('show-window', showWindow);

  // Start with Windows by default (first run of the installed app only; the tray menu can turn it off)
  if (app.isPackaged && !readSettings().autoStartInitialized) {
    setAutoStart(true);
    writeSettings({ autoStartInitialized: true });
  }

  createWindow();
  createTray();

  // Look for a new version shortly after start, then every 6 hours
  setTimeout(() => checkForUpdate(false), 15000);
  setInterval(() => checkForUpdate(false), 6 * 60 * 60 * 1000);
});

// The tray keeps the app alive; quitting happens only via "Quit"
app.on('window-all-closed', () => {});
