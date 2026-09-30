// Linux port of arcway-mac (ClaudeRemoteApp + PopoverView). Keep behaviour 1:1 with the Mac app.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, powerMonitor, powerSaveBlocker, nativeImage, nativeTheme, net, shell, dialog } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const auth = require('./src/auth');
const agent = require('./src/agent');
const runtime = require('./src/runtime');
const { settings, DEFAULT_RELAY_URL } = require('./src/store');

const RELEASES_API = 'https://api.github.com/repos/karthik24iyer/arcway-relay-server/releases/latest';
const WIDTH = 272; // Mac popover: 240 content + 16 padding each side

if (!app.requestSingleInstanceLock()) app.exit(0);

let win, tray;
let keepAwakeId = null;
let state = { type: 'loggedOut', phoneConnected: false, phoneName: null };

function setState(patch) {
  state = { ...state, ...patch };
  updateIcon();
  if (win && !win.isDestroyed()) win.webContents.send('state', state);
}
agent.init(() => state, setState);

// Mac: green = phone connected, dark orange = connected without a phone, plain = not connected.
function updateIcon() {
  if (!tray) return;
  const theme = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
  const dot = state.type !== 'connected' ? '' : state.phoneConnected ? '-phone' : '-nophone';
  tray.setImage(nativeImage.createFromPath(path.join(__dirname, `assets/tray/${theme}${dot}.png`)));
}

// ── Desktop integration ────────────────────────────────────────────────────

function execLine() {
  const exe = process.env.APPIMAGE || process.execPath;
  return app.isPackaged ? `"${exe}"` : `"${exe}" "${app.getAppPath()}"`;
}

const AUTOSTART = path.join(os.homedir(), '.config/autostart/arcway.desktop');
const launchAtLogin = () => fs.existsSync(AUTOSTART);

function setLaunchAtLogin(enabled) {
  if (!enabled) return fs.rmSync(AUTOSTART, { force: true });
  fs.mkdirSync(path.dirname(AUTOSTART), { recursive: true });
  fs.writeFileSync(AUTOSTART, `[Desktop Entry]\nType=Application\nName=Arcway\nExec=${execLine()}\nIcon=arcway-desktop\nX-GNOME-Autostart-enabled=true\n`);
}

// OAuth callbacks (Google's custom scheme, arcway-auth for Apple) come back as a second
// instance whose argv holds the URL. Rewritten every launch because AppImage paths move.
function registerSchemes() {
  const dir = path.join(os.homedir(), '.local/share/applications');
  const mimes = auth.SCHEMES.map((s) => `x-scheme-handler/${s}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'arcway-auth.desktop'),
      `[Desktop Entry]\nType=Application\nName=Arcway\nExec=${execLine()} %u\nNoDisplay=true\nMimeType=${mimes.join(';')};\n`);
    execFile('xdg-mime', ['default', 'arcway-auth.desktop', ...mimes], () => {});
    execFile('update-desktop-database', [dir], () => {});
  } catch {}
}

function handleArgv(argv) {
  const url = argv.find((a) => auth.SCHEMES.some((s) => a.startsWith(`${s}:`)));
  if (url) auth.handleCallback(url);
}

// Mac `caffeinate -dims` equivalent.
function applyKeepAwake(enabled) {
  if (enabled && keepAwakeId === null) keepAwakeId = powerSaveBlocker.start('prevent-display-sleep');
  if (!enabled && keepAwakeId !== null) { powerSaveBlocker.stop(keepAwakeId); keepAwakeId = null; }
}

// ── Updates (Sparkle on Mac): same GitHub release feed; the user downloads the new build. ──

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

async function checkForUpdates(silent) {
  try {
    const release = await (await net.fetch(RELEASES_API)).json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    if (latest && newer(latest, app.getVersion())) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        message: `Arcway ${latest} is available`,
        detail: `You have ${app.getVersion()}. Download the new AppImage or .deb from the release page.`,
        buttons: ['Download', 'Later'],
      });
      if (response === 0) shell.openExternal(release.html_url);
    } else if (!silent) {
      dialog.showMessageBox({ type: 'info', message: 'You’re up to date!', detail: `Arcway ${app.getVersion()} is the newest version.` });
    }
  } catch (err) {
    if (!silent) dialog.showMessageBox({ type: 'error', message: 'Update check failed', detail: err.message });
  }
}

// ── Popover window ─────────────────────────────────────────────────────────

function positionWindow() {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const [w, h] = win.getSize();
  // Wayland reports the cursor at 0,0: anchor top-right, where most panels keep the tray.
  let x = workArea.x + workArea.width - w - 8;
  let y = workArea.y + 8;
  if (cursor.x || cursor.y) {
    x = cursor.x - Math.round(w / 2);
    y = cursor.y > workArea.y + workArea.height / 2 ? cursor.y - h - 10 : cursor.y + 10;
  }
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - w));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - h));
  win.setPosition(x, y);
}

function togglePopover() {
  if (win.isVisible()) return win.hide();
  positionWindow();
  win.show();
  win.focus();
  win.webContents.send('shown');
}

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH,
    height: 160,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ececec',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.send('state', state));
  win.on('blur', () => win.hide()); // NSPopover .transient
}

function finishLogin() {
  setState({ type: 'connecting' });
  agent.start();
}

async function login(fn) {
  try {
    await fn();
    finishLogin();
    return null;
  } catch (err) {
    return err instanceof auth.CancelledError ? null : err.message;
  }
}

function registerIpc() {
  const handlers = {
    'login-google': () => login(auth.loginWithGoogle),
    'login-apple': () => login(auth.loginWithApple),
    'pair': () => login(auth.pair),
    'fetch-pair-code': () => auth.fetchPairCode().catch(() => null),
    'logout': () => { agent.stop(); auth.logout(); setState({ type: 'loggedOut' }); },
    'reconnect': () => { agent.stop(); agent.startIfCredentialed(); },
    'retry-offline': () => { setState({ type: 'connecting' }); agent.start('networkOffline'); },
    'retry': () => agent.start(),
    'check-updates': () => checkForUpdates(false),
    'quit': () => app.quit(),
    'resize': (height) => win.setContentSize(WIDTH, Math.ceil(height)),
    'get-settings': () => ({
      launchAtLogin: launchAtLogin(),
      keepAwake: !!settings.get('keepAwake'),
      selfHost: !!settings.get('selfHost'),
      relayUrl: settings.get('relayUrl') ?? DEFAULT_RELAY_URL,
      shellHook: runtime.hookEnabled(),
      shellRc: path.basename(runtime.rcPath()),
      cliInstalled: runtime.installCLI(),
    }),
    'set-setting': (key, value) => {
      if (key === 'launchAtLogin') setLaunchAtLogin(value);
      else if (key === 'keepAwake') { settings.set('keepAwake', value); applyKeepAwake(value); }
      else if (key === 'shellHook') return runtime.setHook(value) ? value : runtime.hookEnabled();
      else if (key === 'selfHost' || key === 'relayUrl') settings.set(key, value);
      return value;
    },
    'install-cli': () => runtime.installCLI(),
  };
  for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, (_e, ...args) => fn(...args));
}

app.on('second-instance', (_e, argv) => handleArgv(argv));

app.whenReady().then(() => {
  registerIpc();
  registerSchemes();
  createWindow();

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Arcway');
  tray.on('click', togglePopover);
  // Many Linux trays (GNOME AppIndicator) only open a menu on click, so offer the popover there too.
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Arcway', click: togglePopover },
    { label: 'Quit', click: () => app.quit() },
  ]));
  updateIcon();
  nativeTheme.on('updated', updateIcon);

  try { runtime.paths(); } catch (err) {
    setState({ type: 'error', message: `Failed to prepare Arcway: ${err.message}` });
  }
  runtime.installCLI();
  runtime.refreshHook();
  applyKeepAwake(!!settings.get('keepAwake'));
  agent.startIfCredentialed();
  handleArgv(process.argv);
  if (app.isPackaged) checkForUpdates(true);

  powerMonitor.on('resume', () => {
    agent.stop();
    agent.startIfCredentialed();
  });
});

app.on('before-quit', () => agent.stop());
app.on('window-all-closed', () => {});
