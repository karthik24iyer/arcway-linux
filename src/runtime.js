// Where the bundled node + arcway-backend live, plus the Mac app's CLIInstaller and ShellHook.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

let cached = null;

// AppImages mount at a new /tmp path per launch and vanish on quit, so copy the runtime
// out once per version; the `arcway` command and shell hook then work with the app closed.
function paths() {
  if (cached) return cached;
  if (!app.isPackaged) {
    return (cached = { node: 'node', service: path.join(__dirname, '../../arcway-backend') });
  }
  let dir = process.resourcesPath;
  if (process.env.APPIMAGE) {
    dir = path.join(app.getPath('userData'), 'runtime');
    const stamp = path.join(dir, 'version');
    let current = null;
    try { current = fs.readFileSync(stamp, 'utf8'); } catch {}
    if (current !== app.getVersion()) {
      fs.rmSync(dir, { recursive: true, force: true });
      for (const name of ['node', 'service']) {
        fs.cpSync(path.join(process.resourcesPath, name), path.join(dir, name), { recursive: true, verbatimSymlinks: true });
      }
      fs.writeFileSync(stamp, app.getVersion());
    }
  }
  return (cached = { node: path.join(dir, 'node'), service: path.join(dir, 'service') });
}

// ── CLIInstaller: `arcway <agent>` on PATH via ~/.local/bin (no admin prompt needed on Linux).
const CLI_DIR = path.join(os.homedir(), '.local/bin');
const CLI_PATH = path.join(CLI_DIR, 'arcway');
const q = (s) => `'${s.replace(/'/g, "'\\''")}'`;

function cliScript() {
  const { node, service } = paths();
  return `#!/bin/sh\nexec ${q(node)} ${q(path.join(service, 'bin/arcway'))} "$@"\n`;
}

function cliInstalled() {
  try { return fs.readFileSync(CLI_PATH, 'utf8') === cliScript(); } catch { return false; }
}

// Re-run on every launch so a moved/updated app re-installs.
function installCLI() {
  if (cliInstalled()) return true;
  try {
    fs.mkdirSync(CLI_DIR, { recursive: true });
    fs.writeFileSync(CLI_PATH, cliScript(), { mode: 0o755 });
    fs.chmodSync(CLI_PATH, 0o755);
    return true;
  } catch { return false; }
}

// ── ShellHook: rc block routing bare `claude`, `codex`, ... through arcway. Block present = toggle on.
const BEGIN = '# >>> arcway >>>';
const END = '# <<< arcway <<<';
// ponytail: mirrors arcway-backend src/agents/*.js; bash/zsh only.
const AGENTS = 'claude codex copilot agy';

// Resolved so the write doesn't replace a dotfiles symlink.
function rcPath() {
  const rc = path.join(os.homedir(), (process.env.SHELL || '').endsWith('zsh') ? '.zshrc' : '.bashrc');
  try { return fs.realpathSync(rc); } catch { return rc; }
}

// Falls back to the real binary inside tmux, off a tty, or if the app is gone.
function hookBlock() {
  const { node, service } = paths();
  return [
    BEGIN,
    '# Managed by Arcway; edits here are overwritten.',
    `_arcway_node=${q(node)}`,
    `_arcway_cli=${q(path.join(service, 'bin/arcway'))}`,
    `for _arcway_a in ${AGENTS}; do`,
    '  eval "$_arcway_a() { if [[ -n \\$TMUX || ! -t 1 || ! -x \\$_arcway_node ]]; then command $_arcway_a \\"\\$@\\"; else \\$_arcway_node \\$_arcway_cli $_arcway_a \\"\\$@\\"; fi }"',
    'done',
    'unset _arcway_a',
    END,
  ].join('\n');
}

// null = unreadable; never overwrite.
function readRC() {
  try { return fs.readFileSync(rcPath(), 'utf8'); } catch (e) { return e.code === 'ENOENT' ? '' : null; }
}

function stripped(rc) {
  const b = rc.indexOf(BEGIN);
  const e = rc.indexOf(END, b);
  if (b < 0 || e < 0) return rc;
  return (rc.slice(0, b) + rc.slice(e + END.length)).replace(/^\n+|\n+$/g, '') + '\n';
}

const hookEnabled = () => readRC()?.includes(BEGIN) ?? false;

function setHook(enabled) {
  const rc = readRC();
  if (rc === null) return false;
  const block = hookBlock();
  if (enabled && rc.includes(block)) return true;
  const base = stripped(rc);
  const out = enabled ? (base === '\n' ? '' : base + '\n') + block + '\n' : base;
  try { fs.writeFileSync(rcPath(), out); return true; } catch { return false; }
}

// Re-embeds a moved app's path.
function refreshHook() { if (hookEnabled()) setHook(true); }

module.exports = { paths, cliInstalled, installCLI, CLI_PATH, hookEnabled, setHook, refreshHook, rcPath };
