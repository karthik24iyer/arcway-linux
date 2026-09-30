// Port of arcway-mac AgentService: runs the bundled arcway-backend and maps its STATUS: lines to app state.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { settings, credentials, relayUrl } = require('./store');
const runtime = require('./runtime');

const CA_BUNDLES = ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/ca-bundle.pem'];

let proc = null;
let stopped = false;
let generation = 0;
let watchdog = null;
let watchdogFallback = 'loggedOut';
let getState = () => ({});
let setState = () => {};

function init(get, set) { getState = get; setState = set; }

function startIfCredentialed() {
  if (!credentials.load('device_credential')) return;
  setState({ type: 'connecting' });
  start('networkOffline');
}

async function start(fallbackState = 'loggedOut') {
  if (proc) { generation++; proc.kill(); proc = null; }
  stopped = false;
  const myGeneration = ++generation;

  const env = await shellEnvironment();
  if (stopped || myGeneration !== generation) return;
  env.RELAY_URL = relayUrl().replace(/^http/, 'ws');
  env.DEVICE_CREDENTIAL = credentials.load('device_credential') || '';
  const deviceId = credentials.load('device_id');
  if (deviceId) env.DEVICE_ID = deviceId;
  // Corporate proxies: trust the distro CA store like the Mac app trusts the keychain.
  env.NODE_EXTRA_CA_CERTS ||= CA_BUNDLES.find((p) => fs.existsSync(p));
  if (!env.NODE_EXTRA_CA_CERTS) delete env.NODE_EXTRA_CA_CERTS;

  const { node, service } = runtime.paths();
  const p = spawn(node, [path.join(service, 'src/server.js')], { env, cwd: service, stdio: ['ignore', 'pipe', 'ignore'] });
  p.on('error', (err) => {
    if (myGeneration !== generation) return;
    stopped = true;
    setState({ type: 'error', message: `Failed to start agent: ${err.message}` });
  });
  readline.createInterface({ input: p.stdout }).on('line', (line) => {
    if (myGeneration === generation && line.trim()) handle(line.trim());
  });
  p.on('exit', () => handleTermination(myGeneration));

  proc = p;
  watchdogFallback = fallbackState;
  cancelWatchdog();
  armWatchdog();
}

// Falls back if `connecting` persists 15s. Re-armed on every entry to `connecting`;
// cancelled on `connected` / stop().
function armWatchdog() {
  if (watchdog) return;
  const gen = generation;
  const fallback = watchdogFallback;
  watchdog = setTimeout(() => {
    watchdog = null;
    if (stopped || gen !== generation) return;
    if (getState().type === 'connecting') {
      stop();
      setState({ type: fallback });
    }
  }, 15000);
}

function cancelWatchdog() {
  clearTimeout(watchdog);
  watchdog = null;
}

function stop() {
  setState({ phoneConnected: false });
  stopped = true;
  generation++;
  cancelWatchdog();
  proc?.kill();
  proc = null;
}

function handleTermination(gen) {
  if (gen !== generation) return;
  proc = null;
  if (stopped) return;
  setState({ type: 'connecting' });
  setTimeout(() => {
    if (!stopped && gen === generation) start('networkOffline');
  }, 5000);
}

function handle(line) {
  // "STATUS:client_connected[:<device name>]"
  const connectedPrefix = 'STATUS:client_connected';
  if (line.startsWith(connectedPrefix)) {
    const name = line.slice(connectedPrefix.length).replace(/^:+/, '').trim();
    setState({ phoneConnected: true, phoneName: name || null });
    return;
  }
  switch (line) {
    case 'STATUS:connected': {
      cancelWatchdog();
      const name = (credentials.load('user_email') || '').split('@')[0];
      setState({ type: 'connected', userName: name || 'there' });
      break;
    }
    case 'STATUS:disconnected':
      setState({ type: 'connecting', phoneConnected: false });
      armWatchdog();
      break;
    case 'STATUS:client_disconnected':
      setState({ phoneConnected: false });
      break;
    case 'STATUS:invalid_credential':
      stop();
      credentials.clearAll();
      setState({ type: 'loggedOut' });
      break;
    case 'STATUS:tmux_not_found':
      setState({ type: 'installing', message: 'tmux not found, installing...' });
      break;
    case 'STATUS:tmux_installing':
      setState({ type: 'installing', message: 'Installing tmux...' });
      break;
    case 'STATUS:tmux_ready':
      setState({ type: 'connecting' });
      break;
    // The backend only knows Homebrew; on Linux tmux comes from the distro (the .deb depends on it).
    case 'STATUS:error:tmux_no_brew':
      stopped = true;
      setState({ type: 'error', message: 'tmux is required but not installed.\nPlease install tmux manually:\nsudo apt install tmux\n(or dnf / pacman), then Retry.' });
      break;
    case 'STATUS:error:tmux_install_failed':
      stopped = true;
      setState({ type: 'error', message: 'Failed to install tmux.\nPlease install it manually:\nsudo apt install tmux\nthen relaunch Arcway.' });
      break;
  }
}

// Login-shell env so agents see the user's PATH. Cached; refreshed in the background.
function computeShellEnvironment() {
  const shell = process.env.SHELL || '/bin/bash';
  const args = shell.endsWith('fish') ? ['-l', '-c', 'env'] : ['-l', '-i', '-c', 'env'];
  return new Promise((resolve) => {
    execFile(shell, args, { timeout: 5000, encoding: 'utf8', maxBuffer: 4 << 20 }, (_err, stdout) => {
      const env = {};
      for (const line of (stdout || '').split('\n')) {
        const m = /^(\w+)=(.*)$/.exec(line);
        if (m) env[m[1]] = m[2];
      }
      if (env.PATH) settings.set('shellEnv', env);
      resolve(env.PATH ? env : { ...process.env });
    });
  });
}

async function shellEnvironment() {
  const cached = settings.get('shellEnv');
  if (cached) { computeShellEnvironment(); return { ...cached }; }
  return computeShellEnvironment();
}

module.exports = { init, start, startIfCredentialed, stop };
