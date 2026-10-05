# Arcway Linux

Linux tray app (Electron), 1:1 port of [arcway-mac](../arcway-mac). It bundles Node.js and
`../arcway-backend`, so users need nothing but tmux (the .deb depends on it).

| Mac | Linux |
| --- | --- |
| Menu bar popover | Tray icon → popover (tray menu "Open Arcway" on GNOME/AppIndicator) |
| Keychain | `~/.config/Arcway/credentials` encrypted with Electron `safeStorage` (libsecret/kwallet) |
| `arcway` in /opt/homebrew/bin or /usr/local/bin | `~/.local/bin/arcway` |
| Shell hook in `~/.zshrc` | `~/.zshrc` if `$SHELL` is zsh, else `~/.bashrc` |
| `caffeinate` | `powerSaveBlocker` |
| Sparkle | "Check for Updates…" against the same GitHub releases; the user downloads the new file |
| Custom URL scheme callbacks | `x-scheme-handler` .desktop in `~/.local/share/applications` |

Full-disk-access UI is Mac-only (Linux has no TCC).

## Build

```bash
./build.sh          # x64 → dist/Arcway-x86_64.AppImage + dist/Arcway-amd64.deb
./build.sh arm64
```

Everything runs in Docker (`node:20.18.2-bookworm`, same Node as the Mac bundle) because node-pty has no
Linux prebuilds. The backend is copied from `../arcway-backend`, so pull that first.

## Dev (on Linux)

```bash
npm install && (cd ../arcway-backend && npm install) && npm start
```

## Release

Keep `version` in `package.json` equal to the Mac `MARKETING_VERSION`. Upload the AppImage and .deb to the
same `vX.Y.Z` GitHub release on arcway-relay-server as the Mac DMG.
