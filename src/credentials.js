const { Keyring } = require('@napi-rs/keyring');

const keyring = new Keyring('arcway-linux');
const KEYS = ['session_token', 'device_credential', 'device_id', 'user_email'];

function save(key, value) {
  keyring.setPassword(key, value);
}

function load(key) {
  try { return keyring.getPassword(key) || null; }
  catch (_) { return null; }
}

function del(key) {
  try { keyring.deletePassword(key); } catch (_) {}
}

function clearAll() {
  KEYS.forEach(del);
}

module.exports = { save, load, delete: del, clearAll };
