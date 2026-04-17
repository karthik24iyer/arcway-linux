const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'arcway');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_RELAY_URL = 'https://claude-relay-server.duckdns.org';

function load() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (_) { return {}; }
}

function getRelayUrl() {
  return load().relayUrl || DEFAULT_RELAY_URL;
}

function setRelayUrl(url) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const trimmed = (url || '').trim();
  const data = { ...load(), relayUrl: trimmed || DEFAULT_RELAY_URL };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

module.exports = { getRelayUrl, setRelayUrl, DEFAULT_RELAY_URL };
