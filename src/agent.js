const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const credentials = require('./credentials');
const config = require('./config');

const emitter = new EventEmitter();
let backendPath = path.join(__dirname, '../../arcway-backend');

let proc = null;
let stopped = false;
let generation = 0;

function setBackendPath(p) { backendPath = p; }

function getShellEnv() {
  const shell = process.env.SHELL || '/bin/bash';
  const args = shell.endsWith('fish') ? ['-l', '-c', 'env'] : ['-l', '-i', '-c', 'env'];
  try {
    const result = spawnSync(shell, args, { encoding: 'utf8', timeout: 5000 });
    if (result.stdout) {
      const env = {};
      for (const line of result.stdout.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
      }
      return { ...process.env, ...env };
    }
  } catch (_) {}
  return process.env;
}

function start() {
  stopped = false;
  const myGeneration = generation;
  const credential = credentials.load('device_credential') || '';
  const httpUrl = config.getRelayUrl();
  const wsUrl = httpUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');

  const env = {
    ...getShellEnv(),
    RELAY_URL: wsUrl,
    DEVICE_CREDENTIAL: credential,
  };
  const deviceId = credentials.load('device_id');
  if (deviceId) env.DEVICE_ID = deviceId;

  const serverScript = path.join(backendPath, 'src/server.js');
  proc = spawn('node', [serverScript], { env, cwd: backendPath });

  let buffer = '';
  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      switch (trimmed) {
        case 'STATUS:connected': {
          const email = credentials.load('user_email') || '';
          const name = email.split('@')[0] || 'there';
          emitter.emit('connected', name || 'there');
          break;
        }
        case 'STATUS:disconnected':
          emitter.emit('disconnected');
          break;
        case 'STATUS:invalid_credential':
          stopped = true;
          generation++;
          if (proc) { proc.kill(); proc = null; }
          credentials.clearAll();
          emitter.emit('loggedOut');
          break;
        case 'STATUS:tmux_not_found':
          emitter.emit('installing', 'tmux not found, installing...');
          break;
        case 'STATUS:tmux_installing':
          emitter.emit('installing', 'Installing tmux...');
          break;
        case 'STATUS:tmux_ready':
          emitter.emit('connecting');
          break;
        case 'STATUS:error:tmux_no_brew':
          stopped = true;
          emitter.emit('error', 'tmux is required but not installed.\nPlease install it manually:\n  sudo apt install tmux\nthen relaunch Arcway.');
          break;
        case 'STATUS:error:tmux_install_failed':
          stopped = true;
          emitter.emit('error', 'Failed to install tmux automatically.\nPlease install it manually:\n  sudo apt install tmux\nthen relaunch Arcway.');
          break;
      }
    }
  });

  proc.stderr.on('data', (d) => process.stderr.write(d));

  proc.on('exit', () => {
    proc = null;
    if (stopped || myGeneration !== generation) return;
    emitter.emit('disconnected');
    setTimeout(() => {
      if (!stopped && myGeneration === generation) start();
    }, 5000);
  });
}

function startIfCredentialed() {
  if (!credentials.load('device_credential')) return;
  emitter.emit('connecting');
  start();
}

function stop() {
  stopped = true;
  generation++;
  if (proc) {
    proc.kill();
    proc = null;
  }
}

module.exports = { start, startIfCredentialed, stop, setBackendPath, on: emitter.on.bind(emitter) };
