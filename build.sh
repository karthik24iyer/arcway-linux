#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Prerequisites ─────────────────────────────────────────────────────────────

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: '$1' not found. Please install it and re-run." >&2
    exit 1
  fi
}

check_cmd node
check_cmd npm

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js >= 18 required (found $(node --version))." >&2
  exit 1
fi

# arcway-backend must be a sibling directory (bundled into resources)
BACKEND_DIR="$(cd "$SCRIPT_DIR/../arcway-backend" 2>/dev/null && pwd)" || {
  echo "ERROR: ../arcway-backend not found next to arcway-linux." >&2
  echo "  Clone it: git clone <arcway-backend-repo> alongside arcway-linux" >&2
  exit 1
}

echo "→ arcway-linux : $SCRIPT_DIR"
echo "→ arcway-backend: $BACKEND_DIR"
echo "→ node          : $(node --version)"
echo "→ npm           : $(npm --version)"
echo ""

# ── Detect arch ───────────────────────────────────────────────────────────────

ARCH="${BUILD_ARCH:-}"
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    x86_64)  ARCH="x64"   ;;
    aarch64) ARCH="arm64" ;;
    arm64)   ARCH="arm64" ;;
    *)       ARCH="x64"   ;;
  esac
fi
echo "→ target arch   : $ARCH"
echo ""

# ── Install dependencies ───────────────────────────────────────────────────────

echo "[1/3] Installing npm dependencies..."
npm install --prefer-offline 2>&1 | grep -E "^(added|removed|changed|up to date|npm warn deprecated [^:]+:)" || true

# ── Build ─────────────────────────────────────────────────────────────────────

echo ""
echo "[2/3] Building Linux packages (AppImage + deb) for $ARCH..."
./node_modules/.bin/electron-builder --linux --"$ARCH" 2>&1

# ── Report ────────────────────────────────────────────────────────────────────

echo ""
echo "[3/3] Build complete. Output files:"
ls -lh dist/*.AppImage dist/*.deb 2>/dev/null | awk '{print "  " $5 "  " $9}'
echo ""
echo "Install instructions:"
echo "  AppImage : chmod +x dist/Arcway-*.AppImage && ./dist/Arcway-*.AppImage"
echo "  Deb      : sudo dpkg -i dist/arcway-linux_*_*.deb && sudo apt-get install -f"
