const { app, BrowserWindow, Tray, ipcMain, screen, powerMonitor, powerSaveBlocker, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const auth = require('./src/auth');
const agent = require('./src/agent');
const credentials = require('./src/credentials');

let win, tray;
let psbId = null;
let currentState = { type: 'loggedOut' };

// Heights per state so window sizes to content
const STATE_HEIGHTS = { loggedOut: 130, connecting: 110, connected: 300, error: 140 };

function sendState(stateObj) {
  currentState = stateObj;
  updateTrayIcon(stateObj.type === 'connected');
  if (win && !win.isDestroyed()) {
    const h = STATE_HEIGHTS[stateObj.type] || 200;
    win.setContentSize(260, h);
    win.webContents.send('state', stateObj);
  }
}

function updateTrayIcon(connected) {
  if (!tray) return;
  if (connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="22" height="22">
      <rect x="2" y="3" width="18" height="13" rx="2" fill="none" stroke="black" stroke-width="1.5"/>
      <line x1="7" y1="20" x2="15" y2="20" stroke="black" stroke-width="1.5"/>
      <line x1="11" y1="16" x2="11" y2="20" stroke="black" stroke-width="1.5"/>
      <circle cx="18" cy="18" r="4" fill="#22c55e"/>
    </svg>`;
    tray.setImage(nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`));
  } else {
    tray.setImage(nativeImage.createFromPath(path.join(__dirname, 'assets/tray.svg')));
  }
}

function positionWindow() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { bounds } = display;
  const [winW, winH] = win.getSize();

  let x, y;
  // Wayland fallback: cursor at {0,0}
  if (cursor.x === 0 && cursor.y === 0) {
    x = bounds.x + Math.round((bounds.width - winW) / 2);
    y = bounds.y + bounds.height - winH - 40;
  } else {
    x = cursor.x - Math.round(winW / 2);
    const isLowerHalf = cursor.y > bounds.y + bounds.height / 2;
    y = isLowerHalf ? cursor.y - winH - 10 : cursor.y + 10;
    x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - winW));
    y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - winH));
  }
  win.setPosition(x, y);
}

agent.on('connecting', () => sendState({ type: 'connecting' }));
agent.on('connected', (userName) => sendState({ type: 'connected', userName }));
agent.on('disconnected', () => sendState({ type: 'connecting' }));

app.whenReady().then(() => {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets/tray.svg')));
  tray.setToolTip('Arcway');

  win = new BrowserWindow({
    width: 260,
    height: 130,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  win.loadFile('renderer/index.html');

  win.webContents.on('did-finish-load', () => sendState(currentState));

  win.on('blur', () => win.hide());

  tray.on('click', () => {
    positionWindow();
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });

  ipcMain.handle('login', async () => {
    try {
      sendState({ type: 'connecting' });
      await auth.login();
      agent.startIfCredentialed();
    } catch (e) {
      sendState({ type: 'error', message: e.message });
    }
  });

  ipcMain.handle('logout', () => {
    agent.stop();
    auth.logout();
    sendState({ type: 'loggedOut' });
  });

  ipcMain.handle('retry', () => {
    sendState({ type: 'connecting' });
    agent.start();
  });

  ipcMain.handle('set-autostart', (_, enabled) => {
    const desktopPath = path.join(os.homedir(), '.config/autostart/arcway.desktop');
    if (enabled) {
      fs.mkdirSync(path.dirname(desktopPath), { recursive: true });
      fs.writeFileSync(desktopPath, [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Arcway',
        `Exec=${process.execPath} --hidden`,
        'Icon=arcway',
        'X-GNOME-Autostart-enabled=true',
      ].join('\n'));
    } else {
      try { fs.unlinkSync(desktopPath); } catch (_) {}
    }
  });

  ipcMain.handle('set-keep-awake', (_, enabled) => {
    if (enabled) {
      psbId = powerSaveBlocker.start('prevent-display-sleep');
    } else if (psbId !== null) {
      powerSaveBlocker.stop(psbId);
      psbId = null;
    }
  });

  ipcMain.handle('quit', () => app.quit());

  powerMonitor.on('resume', () => {
    agent.stop();
    agent.startIfCredentialed();
  });

  app.on('before-quit', () => agent.stop());

  if (credentials.load('device_credential')) {
    sendState({ type: 'connecting' });
    agent.startIfCredentialed();
  }
});

app.on('window-all-closed', () => {});
