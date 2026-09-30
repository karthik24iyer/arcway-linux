// Settings (UserDefaults on Mac) and credentials (Keychain on Mac), both under ~/.config/Arcway.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_RELAY_URL = 'https://claude-relay-server.duckdns.org';

const file = (name) => path.join(app.getPath('userData'), name);

function write(name, data) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(file(name), data, { mode: 0o600 });
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(file('config.json'), 'utf8')); } catch { return {}; }
}

const settings = {
  get: (key) => readSettings()[key],
  set: (key, value) => write('config.json', JSON.stringify({ ...readSettings(), [key]: value }, null, 2)),
};

// safeStorage uses libsecret/kwallet when available; the file is 0600 either way.
function readCredentials() {
  try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(file('credentials')))); } catch { return {}; }
}

const credentials = {
  load: (key) => readCredentials()[key] || null,
  save: (key, value) => write('credentials', safeStorage.encryptString(JSON.stringify({ ...readCredentials(), [key]: value }))),
  clearAll: () => fs.rmSync(file('credentials'), { force: true }),
};

// Custom relay only in self-host mode, same as the Mac app.
function relayUrl() {
  const custom = settings.get('selfHost') ? settings.get('relayUrl') : '';
  return (custom || '').trim().replace(/\/+$/, '') || DEFAULT_RELAY_URL;
}

module.exports = { settings, credentials, relayUrl, DEFAULT_RELAY_URL };
