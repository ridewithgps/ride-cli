#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(bun --print "await Bun.file('package.json').json().then((pkg) => pkg.version)")
echo "Building ride-cli v${VERSION} release binaries..."

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

mkdir -p dist/release

# Build for each platform
TARGETS=("bun-linux-x64" "bun-darwin-x64" "bun-darwin-arm64")
NAMES=("ride-linux-x64" "ride-darwin-x64" "ride-darwin-arm64")

for i in "${!TARGETS[@]}"; do
  target="${TARGETS[$i]}"
  name="${NAMES[$i]}"
  echo "  Building ${name}..."
  bun build src/index.ts --compile --target="${target}" --outfile "dist/release/${name}"
done

echo ""
echo "Release binaries:"
ls -lh dist/release/
echo ""
echo "Upload these to GitHub release v${VERSION}"
