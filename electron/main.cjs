// OpenTodo desktop shell: serves the built app (dist/) from app://todo-plus
// so the data (localStorage) always lives under the same, fixed origin.
// Closing the window keeps the app running in the tray so reminders still fire.
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, protocol, net, shell, session } = require('electron');
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
});

// The tray keeps the app alive; quitting happens only via "Çık"
app.on('window-all-closed', () => {});
