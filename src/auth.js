// Port of arcway-mac AuthService. Google and Apple both finish in the default browser and
// come back through x-scheme-handler URLs registered by main.js (registerSchemes).
const { shell, net } = require('electron');
const crypto = require('crypto');
const os = require('os');
const { credentials, relayUrl, DEFAULT_RELAY_URL } = require('./store');

// Same OAuth clients as the Mac app, so the relay accepts the tokens unchanged.
const GOOGLE_CLIENT_ID = '260109272007-m8upo6vn1531vrtsiepmgc4ukthr35bd.apps.googleusercontent.com';
const GOOGLE_SCHEME = 'com.googleusercontent.apps.260109272007-m8upo6vn1531vrtsiepmgc4ukthr35bd';
const GOOGLE_REDIRECT = `${GOOGLE_SCHEME}:/oauth2callback`;
const APPLE_CLIENT_ID = 'com.arcway.app.macsignin';
const APPLE_SCHEME = 'arcway-auth';

class CancelledError extends Error {}

let pending = null;

// Opens the browser and resolves with the ?code= of the callback URL.
function waitForCode(url) {
  pending?.reject(new CancelledError('cancelled'));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    shell.openExternal(url).catch(reject);
  });
}

function handleCallback(url) {
  if (!pending) return;
  const { resolve, reject } = pending;
  pending = null;
  const q = new URL(url).searchParams;
  if (q.get('error')) reject(new Error(`Login denied: ${q.get('error')}`));
  else if (q.get('code')) resolve(q.get('code'));
  else reject(new Error('No authorization code received'));
}

async function request(url, { body, form, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  else if (body) headers['Content-Type'] = 'application/json';
  const res = await net.fetch(url, {
    method: body || form ? 'POST' : 'GET',
    headers,
    body: form ? new URLSearchParams(form).toString() : body && JSON.stringify(body),
  });
  let json = {};
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function saveSession(json, baseUrl, email) {
  if (!json.session_token) throw new Error('Sign-in failed. Please try again.');
  credentials.save('session_token', json.session_token);
  credentials.save('user_email', email ?? json.email ?? 'unknown');

  const { status, json: dev } = await request(`${baseUrl}/api/devices/register`, {
    body: { name: os.hostname() },
    token: json.session_token,
  });
  if (status === 403) throw new Error('Free accounts can pair one host. Get Arcway Forever in the Arcway phone app, then try again.');
  if (!dev.device_credential || !dev.device_id) throw new Error('Failed to register device');
  credentials.save('device_credential', dev.device_credential);
  credentials.save('device_id', dev.device_id);
}

async function loginWithGoogle() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const code = await waitForCode('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }));

  const { json: tok } = await request('https://oauth2.googleapis.com/token', {
    form: { code, client_id: GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_REDIRECT, code_verifier: verifier, grant_type: 'authorization_code' },
  });
  if (!tok.id_token) throw new Error('Failed to exchange authorization code');

  const { json } = await request(`${DEFAULT_RELAY_URL}/auth/google`, { body: { id_token: tok.id_token } });
  await saveSession(json, DEFAULT_RELAY_URL);
}

// The relay's /auth/apple/callback bounces the code to arcway-auth://callback.
async function loginWithApple() {
  const code = await waitForCode('https://appleid.apple.com/auth/authorize?' + new URLSearchParams({
    client_id: APPLE_CLIENT_ID,
    redirect_uri: `${DEFAULT_RELAY_URL}/auth/apple/callback`,
    response_type: 'code',
    response_mode: 'query',
    state: crypto.randomUUID(),
  }));
  const { json } = await request(`${DEFAULT_RELAY_URL}/auth/apple/mac`, { body: { authorization_code: code } });
  await saveSession(json, DEFAULT_RELAY_URL);
}

async function pair() {
  const baseUrl = relayUrl();
  const { status, json } = await request(`${baseUrl}/auth/pair-initiate`, { body: {} });
  if (status === 409) throw new Error('Another device is using this relay. Stop them or reset the relay to continue.');
  if (status === 401) throw new Error('Pairing failed');
  if (status === 429) throw new Error('Too many attempts. Please wait a minute and try again.');
  if (status !== 200 || !json.pair_code) throw new Error('Sign-in failed. Please try again.');
  await saveSession(json, baseUrl, 'self-host');
  return json.pair_code;
}

async function fetchPairCode() {
  const token = credentials.load('session_token');
  if (!token) return null;
  const { json } = await request(`${relayUrl()}/api/pair/code`, { token });
  return json.pair_code || null;
}

const logout = () => credentials.clearAll();

module.exports = {
  loginWithGoogle, loginWithApple, pair, fetchPairCode, logout, handleCallback,
  CancelledError, SCHEMES: [GOOGLE_SCHEME, APPLE_SCHEME],
};
