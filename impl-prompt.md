You are implementing `arcway-linux` — an Electron-based Linux system tray app that mirrors the macOS `arcway-mac` Swift app. The repo is already cloned (empty) at `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-linux`.

**Before writing any code**, read all these files to fully understand what you're porting:
- `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-mac/ClaudeRemote/App/ClaudeRemoteApp.swift`
- `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-mac/ClaudeRemote/App/AppState.swift`
- `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-mac/ClaudeRemote/Services/AuthService.swift`
- `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-mac/ClaudeRemote/Services/AgentService.swift`
- `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-mac/ClaudeRemote/Services/KeychainService.swift`
- `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-mac/ClaudeRemote/Views/PopoverView.swift`
- `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-mac/ClaudeRemote/Views/LoginView.swift`
- `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-mac/ClaudeRemote/Views/ConnectedView.swift`
- `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-backend/src/server.js` (to understand what process gets spawned)

---

## What to Build

8 files total under `/Users/karthikeyaniyer/Documents/Misc/Arcway/arcway-linux/`:

```
package.json
main.js
preload.js
src/auth.js
src/agent.js
src/credentials.js
renderer/index.html
assets/tray.svg  (simple terminal/monitor SVG icon)
```

---

## Exact Specs Per File

### `package.json`
- `name`: `arcway-linux`, `main`: `main.js`
- Dependencies: `electron`, `@napi-rs/keyring`
- Scripts: `start`: `electron .`
- No build tooling needed

### `src/credentials.js`
Port of `KeychainService.swift`. Uses `@napi-rs/keyring`:
- Service name: `arcway-linux`
- 3 keys: `session_token`, `device_credential`, `user_email`
- Methods: `save(key, value)`, `load(key)`, `delete(key)`, `clearAll()`

### `src/auth.js`
Port of `AuthService.swift`. Key difference: **no custom URL scheme** — use localhost loopback instead:
- `LINUX_CLIENT_ID` constant at top of file with a `// TODO: replace with Desktop app OAuth client ID` comment
- `RELAY_HTTP_URL` = `https://claude-relay-server.duckdns.org`
- `login()`: generate PKCE verifier+challenge, spin up `http.createServer()` on port `0` (random), open Google auth URL via `shell.openExternal()` with `redirect_uri=http://127.0.0.1:{port}`, wait for the callback request, extract `?code=`, close server, exchange code → ID token → relay auth → device registration → save to credentials
- `logout()`: calls `credentials.clearAll()`
- Helper: `decodeEmailFromJWT(token)` — same JWT payload base64 decode as Swift version
- Export: `{ login, logout }`

### `src/agent.js`
Port of `AgentService.swift`:
- Spawns `node` (from PATH) with args `[path_to_arcway_backend/src/server.js]`
- Sets env: `RELAY_URL=wss://claude-relay-server.duckdns.org`, `DEVICE_CREDENTIAL=<from credentials>`
- Also inherits full shell environment so Claude Code / node are found in PATH
- Parses stdout line by line for `STATUS:connected` / `STATUS:disconnected`
- On `STATUS:connected`: emits `connected` event with email username
- Auto-restarts on crash after 5s delay (same as Mac), unless `stop()` was called
- The arcway-backend path is `path.join(__dirname, '../../arcway-backend')` (sibling repo)
- Export: `{ start, startIfCredentialed, stop, on }` — use `EventEmitter`

### `main.js`
Main Electron process:
- Creates `Tray` with `assets/tray.svg`; switches to a version with a green dot overlay when connected (draw programmatically with `nativeImage` + canvas, or keep 2 icon files)
- Creates a frameless `BrowserWindow` (width: 260, height: auto/fit-content, `frame: false`, `skipTaskbar: true`, `alwaysOnTop: true`, `resizable: false`, `show: false`, `webPreferences: { preload, contextIsolation: true }`)
- On tray `click`: position window near cursor using `screen.getCursorScreenPoint()` — place above cursor if in lower half of screen, below if upper half. Then toggle show/hide
- On `blur`: hide window
- IPC handlers (from renderer via `ipcMain.handle`):
  - `login`: calls `auth.login()`, on success starts agent, sends state update
  - `logout`: stops agent, calls `auth.logout()`, sends state update
  - `retry`: calls `agent.start()`
  - `set-autostart(enabled)`: writes/deletes `~/.config/autostart/arcway.desktop`
  - `set-keep-awake(enabled)`: `powerSaveBlocker.start/stop('prevent-display-sleep')`
  - `quit`: `app.quit()`
- State machine: `loggedOut | connecting | connected(userName) | error(msg)` — send to renderer via `win.webContents.send('state', stateObj)` on every change
- On app ready: check if `device_credential` exists → if yes, set state `connecting`, start agent
- On system resume (`powerMonitor.on('resume')`): stop and restart agent (port of Mac's `didWakeNotification`)
- Autostart `.desktop` file content:
  ```ini
  [Desktop Entry]
  Type=Application
  Name=Arcway
  Exec={app_path} --hidden
  Icon=arcway
  X-GNOME-Autostart-enabled=true
  ```

### `preload.js`
`contextBridge.exposeInMainWorld('api', { ... })` exposing:
- `login()`, `logout()`, `retry()`, `quit()`
- `setAutostart(enabled)`, `setKeepAwake(enabled)`
- `onState(callback)` — wraps `ipcRenderer.on('state', ...)`

### `renderer/index.html`
Single file, no external dependencies. Inline CSS + JS. 4 views matching the Mac popover visually:

**Styling**: Dark background (`#1e1e2e`), white text, compact padding, same layout proportions as Mac popover. Font: system-ui. Width: 260px.

**loggedOut view:**
- Title "Arcway" (bold)
- Button "Login with Google" (prominent blue button, shows spinner while loading)

**connecting view:**
- Title "Arcway"
- Spinner + "Connecting..."
- "Quit" button (plain text)

**connected view:**
- Green dot + "Arcway" title on same line
- "Hello, {name}" subtitle
- "Connected" caption (muted)
- Divider
- Toggle: "Launch at login"
- Toggle: "Keep System Awake"
- Divider
- "Reconnect" button (plain) — stops and restarts agent
- "Logout" button (red)
- "Quit" button (plain)

**error view:**
- Title "Arcway"
- Error message (red, small)
- "Retry" button

JS in the HTML: listens to `window.api.onState(state => ...)` and renders the appropriate view. Each button calls the corresponding `window.api.*` method.

---

## Key Notes / Gotchas

1. **`tray.getBounds()` does NOT work on Linux** — use `screen.getCursorScreenPoint()` for window positioning
2. **`app.setLoginItemSettings()` does NOT work on Linux** — write the XDG `.desktop` file manually
3. **`keytar` is archived** — use `@napi-rs/keyring` only
4. **Wayland**: window positioning is unreliable; fall back to centering near bottom of screen if `getCursorScreenPoint()` returns `{x:0, y:0}`
5. The arcway-backend `server.js` emits `STATUS:connected` and `STATUS:disconnected` lines on stdout — agent.js must watch for these

---

## What NOT to Do
- Don't bundle Node.js — use system `node` from PATH
- Don't add webpack, bundlers, or build steps
- Don't add error handling for impossible cases
- Don't create any additional `.md` files
- No comments beyond what's needed for non-obvious logic

---

Implement all 8 files. After writing, run `git diff` in the repo to review, then do a final check that the auth flow, agent spawn path, and IPC wiring are all consistent end-to-end.
