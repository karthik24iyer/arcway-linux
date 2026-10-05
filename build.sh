#!/usr/bin/env bash
# Builds dist/Arcway-<arch>.{AppImage,deb} inside Docker, so node-pty
# compiles for Linux even when run from a Mac. Needs Docker and ../arcway-backend.
# Usage: ./build.sh [x64|arm64]
set -euo pipefail
cd "$(dirname "$0")"

ARCH="${1:-x64}"
case "$ARCH" in
  x64)   PLATFORM=linux/amd64 ;;
  arm64) PLATFORM=linux/arm64 ;;
  *) echo "usage: $0 [x64|arm64]" >&2; exit 1 ;;
esac
NODE_VERSION=20.18.2 # keep in sync with arcway-mac/Scripts/bundle-node.sh
BACKEND="$(cd ../arcway-backend && pwd)" || { echo "../arcway-backend not found" >&2; exit 1; }

# node_modules lives in a per-arch volume so the host checkout keeps its own.
docker run --rm --platform "$PLATFORM" \
  -v "$PWD:/app" -v "$BACKEND:/backend:ro" -v "arcway-linux-nm-$ARCH:/app/node_modules" \
  -w /app -e ARCH="$ARCH" "node:$NODE_VERSION-bookworm" bash -euc '
    echo "[1/3] Bundling node $(node -v) + arcway-backend"
    rm -rf build/runtime && mkdir -p build/runtime/service
    cp "$(command -v node)" build/runtime/node
    cp -r /backend/src /backend/config /backend/bin /backend/package.json /backend/package-lock.json build/runtime/service/
    (cd build/runtime/service && npm ci --omit=dev --no-fund --no-audit --loglevel=error)

    echo "[2/3] Installing electron + electron-builder"
    npm ci --no-fund --no-audit --loglevel=error

    echo "[3/3] Packaging AppImage + deb"
    if [ "$ARCH" = arm64 ]; then # electron-builder ships fpm for x64 only
      apt-get update -qq && apt-get install -y -qq ruby ruby-dev rpm >/dev/null && gem install -q --no-document fpm >/dev/null
      export USE_SYSTEM_FPM=true
    fi
    npx electron-builder --linux "--$ARCH" --publish never
  '

ls -lh dist/*.AppImage dist/*.deb
