const { shell } = require('electron');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const credentials = require('./credentials');

const LINUX_CLIENT_ID = 'YOUR_LINUX_CLIENT_ID.apps.googleusercontent.com'; // TODO: replace with Desktop app OAuth client ID
const RELAY_HTTP_URL = 'https://claude-relay-server.duckdns.org';

async function login() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  const { code, redirectUri } = await new Promise((resolve, reject) => {
    let redirectUri;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h3>Login complete. You can close this window.</h3></body></html>');
      server.close();
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error) reject(new Error(`OAuth denied: ${error}`));
      else if (code) resolve({ code, redirectUri });
      else reject(new Error('No authorization code received'));
    });

    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const params = new URLSearchParams({
        client_id: LINUX_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    });

    server.on('error', reject);
  });

  const idToken = await exchangeCode(code, verifier, redirectUri);
  const { sessionToken, email } = await authenticateWithRelay(idToken);
  credentials.save('session_token', sessionToken);
  credentials.save('user_email', email);
  const deviceCredential = await registerDevice(sessionToken);
  credentials.save('device_credential', deviceCredential);
}

function logout() {
  credentials.clearAll();
}

function decodeEmailFromJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload).email || null;
  } catch (_) { return null; }
}

async function exchangeCode(code, verifier, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: LINUX_CLIENT_ID,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    grant_type: 'authorization_code',
  }).toString();

  const json = await httpsPost('https://oauth2.googleapis.com/token', body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  if (!json.id_token) throw new Error('Token exchange failed');
  return json.id_token;
}

async function authenticateWithRelay(idToken) {
  const json = await httpsPost(`${RELAY_HTTP_URL}/auth/google`, JSON.stringify({ id_token: idToken }), {
    'Content-Type': 'application/json',
  });
  if (!json.session_token) throw new Error('Relay authentication failed');
  const email = decodeEmailFromJWT(json.session_token) || 'unknown';
  return { sessionToken: json.session_token, email };
}

async function registerDevice(sessionToken) {
  const json = await httpsPost(
    `${RELAY_HTTP_URL}/api/devices/register`,
    JSON.stringify({ name: require('os').hostname() }),
    { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }
  );
  if (!json.device_credential) throw new Error('Device registration failed');
  return json.device_credential;
}

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body;
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch (_) { reject(new Error('Invalid response from server')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = { login, logout };
