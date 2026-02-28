#!/bin/bash
set -euo pipefail

REPO="ridewithgps/ride-cli"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="ride"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)  PLATFORM="linux" ;;
  darwin) PLATFORM="darwin" ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

ASSET_NAME="ride-${PLATFORM}-${ARCH}"
echo "Installing ride CLI (${PLATFORM}-${ARCH})..."

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required to install ride."
  exit 1
fi

# Resolve latest release asset URL (no JSON parsing required).
LATEST_URL="https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"

if ! curl -fsSLI "$LATEST_URL" >/dev/null; then
  echo "Error: No published release binary found for ${PLATFORM}-${ARCH}."
  echo "A GitHub Release may not be published yet."
  echo ""
  echo "Install from source instead:"
  echo "  git clone https://github.com/${REPO}.git"
  echo "  cd ride-cli"
  echo "  bun install"
  echo "  bun run build"
  echo "  sudo cp dist/ride /usr/local/bin/ride"
  echo ""
  echo "Or check releases at: https://github.com/${REPO}/releases"
  exit 1
fi

# Download
TMP=$(mktemp)
cleanup() {
  rm -f "$TMP"
}
trap cleanup EXIT

echo "Downloading from ${LATEST_URL}..."
curl -fsSL "$LATEST_URL" -o "$TMP"
chmod +x "$TMP"

# Install
if [ -w "$INSTALL_DIR" ]; then
  install -m 0755 "$TMP" "${INSTALL_DIR}/${BINARY_NAME}"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo install -m 0755 "$TMP" "${INSTALL_DIR}/${BINARY_NAME}"
fi

echo ""
echo "  ✓ ride installed to ${INSTALL_DIR}/${BINARY_NAME}"
echo ""
echo "  Get started:"
echo "    ride login    # authenticate with Ride with GPS"
echo "    ride          # start a session"
echo ""
