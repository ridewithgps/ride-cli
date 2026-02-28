#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(bun --print "await Bun.file('package.json').json().then((pkg) => pkg.version)")
echo "Building ride-cli v${VERSION}..."

# Install dependencies
bun install --frozen-lockfile 2>/dev/null || bun install

cleanup() {
  if [[ -f src/lib/version.ts.bak ]]; then
    mv src/lib/version.ts.bak src/lib/version.ts
  fi
}
trap cleanup EXIT

# Create temp source with version injected
cp src/lib/version.ts src/lib/version.ts.bak
RIDE_VERSION="$VERSION" perl -0pi -e 's/"__VERSION__"/"$ENV{RIDE_VERSION}"/' src/lib/version.ts

# Build for current platform
echo "Compiling binary..."
mkdir -p dist
bun build src/index.ts --compile --outfile dist/ride

echo ""
echo "Build complete: dist/ride (v${VERSION})"
echo "Install with: sudo cp dist/ride /usr/local/bin/ride"
