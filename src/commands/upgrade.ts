import {
  createWriteStream,
  chmodSync,
  renameSync,
  unlinkSync,
  accessSync,
  constants,
} from "node:fs";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Writable } from "node:stream";
import {
  CURRENT_VERSION,
  fetchLatestRelease,
  getPlatformKey,
  isOutdated,
  isValidVersion,
} from "../lib/version.js";

function isRuntimeBinary(path: string): boolean {
  const name = basename(path).toLowerCase();
  return !["bun", "bunx", "node"].includes(name);
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveFromPath(binaryName: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binaryName);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeInvocationPath(path: string | undefined): string | null {
  if (!path) return null;

  if (path.includes("/") || path.includes("\\")) {
    const absolutePath = isAbsolute(path) ? path : resolve(process.cwd(), path);
    return isExecutable(absolutePath) ? absolutePath : null;
  }

  return resolveFromPath(path);
}

function detectInstalledBinaryPath(): string | null {
  const candidates = [
    normalizeInvocationPath(process.execPath),
    normalizeInvocationPath(process.argv[0]),
  ];

  for (const candidate of candidates) {
    if (candidate && isRuntimeBinary(candidate)) {
      return candidate;
    }
  }

  // Fallback for shell wrappers where argv[0] points at a runtime binary.
  const rideFromPath = resolveFromPath("ride");
  if (rideFromPath && isRuntimeBinary(rideFromPath)) {
    return rideFromPath;
  }

  return null;
}

function canWritePath(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function installWithSudo(source: string, destination: string): void {
  const result = spawnSync(
    "sudo",
    ["install", "-m", "0755", source, destination],
    { stdio: "inherit" }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`sudo install failed with exit code ${result.status}`);
  }
}

export async function upgradeCommand(): Promise<void> {
  console.log(`  Current version: ${CURRENT_VERSION}`);
  console.log("  Checking for updates...");

  if (!isValidVersion(CURRENT_VERSION)) {
    console.error(
      "  Upgrade is only supported from installed release binaries."
    );
    console.error(
      "  Build and reinstall ride, or download from: https://github.com/ridewithgps/ride-cli/releases/latest"
    );
    process.exit(1);
  }

  const currentBinary = detectInstalledBinaryPath();
  if (!currentBinary) {
    console.error("  Could not determine the installed ride binary path.");
    console.error(
      "  Refusing to self-upgrade from a development runtime (bun/node)."
    );
    process.exit(1);
  }

  // Explicit refresh: manual upgrade should not depend on update-check TTL cache.
  const release = await fetchLatestRelease({ refresh: true });

  if (!release) {
    console.error("  Could not check for updates. Try again later.");
    process.exit(1);
  }

  if (!isOutdated(CURRENT_VERSION, release.latest)) {
    console.log(`  Already up to date (v${release.latest}).`);
    return;
  }

  console.log(`  New version available: v${release.latest}`);

  const platformKey = getPlatformKey();
  const downloadUrl = release.downloadUrl?.[platformKey];

  if (!downloadUrl) {
    console.error(`  No binary available for your platform (${platformKey}).`);
    console.error(
      "  Download manually from: https://github.com/ridewithgps/ride-cli/releases/latest"
    );
    process.exit(1);
  }

  console.log(`  Downloading for ${platformKey}...`);

  // Always download to a writable temp location first.
  const tmpPath = join(tmpdir(), `ride-upgrade-${randomUUID()}`);

  try {
    const response = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Download failed: HTTP ${response.status}`);
    }

    // Stream to temp file
    const fileStream = createWriteStream(tmpPath);
    const writer = Writable.toWeb(fileStream);
    await response.body.pipeTo(writer);

    // Make executable
    chmodSync(tmpPath, 0o755);

    if (canWritePath(currentBinary)) {
      // Direct replace for writable install locations.
      renameSync(tmpPath, currentBinary);
    } else {
      console.log("  Elevated permissions required to install update.");
      installWithSudo(tmpPath, currentBinary);
      // install copies the file; remove temp explicitly.
      unlinkSync(tmpPath);
    }

    console.log(`  ✓ Updated to v${release.latest}`);
    console.log("");
  } catch (error) {
    // Clean up temp file
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }

    console.error(
      `  Upgrade failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    console.error(
      "  Download manually from: https://github.com/ridewithgps/ride-cli/releases/latest"
    );
    process.exit(1);
  }
}
