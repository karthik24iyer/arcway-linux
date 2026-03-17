const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const credentials = require('./credentials');

const emitter = new EventEmitter();
const backendPath = path.join(__dirname, '../../arcway-backend');
const serverScript = path.join(backendPath, 'src/server.js');

let proc = null;
let stopped = false;

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
  const credential = credentials.load('device_credential') || '';
  const env = {
    ...getShellEnv(),
    RELAY_URL: 'wss://claude-relay-server.duckdns.org',
    DEVICE_CREDENTIAL: credential,
  };

  proc = spawn('node', [serverScript], { env, cwd: backendPath });

  let buffer = '';
  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'STATUS:connected') {
        const email = credentials.load('user_email') || '';
        const name = email.split('@')[0] || 'there';
        emitter.emit('connected', name || 'there');
      } else if (trimmed === 'STATUS:disconnected') {
        emitter.emit('disconnected');
      }
    }
  });

  proc.stderr.on('data', () => {});

  proc.on('exit', () => {
    proc = null;
    if (!stopped) {
      emitter.emit('disconnected');
      setTimeout(() => {
        if (!stopped) start();
      }, 5000);
    }
  });
}

function startIfCredentialed() {
  if (!credentials.load('device_credential')) return;
  emitter.emit('connecting');
  start();
}

function stop() {
  stopped = true;
  if (proc) {
    proc.kill();
    proc = null;
  }
}

module.exports = { start, startIfCredentialed, stop, on: emitter.on.bind(emitter) };
