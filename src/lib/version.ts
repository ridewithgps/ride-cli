import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "./config.js";

// Build script replaces this placeholder with the actual version
export const CURRENT_VERSION = "__VERSION__";

const GITHUB_REPO = "ridewithgps/ride-cli";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface VersionCache {
  latest: string;
  checkedAt: number;
  downloadUrl?: Record<string, string>;
}

interface GitHubRelease {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null;
}

export function isOutdated(current: string, latest: string): boolean {
  const c = parseVersion(current);
  const l = parseVersion(latest);

  if (!c || !l) {
    return false;
  }

  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  return l.patch > c.patch;
}

function loadCache(): VersionCache | null {
  try {
    const cacheFile = getVersionCacheFile();
    if (!existsSync(cacheFile)) return null;
    const data = JSON.parse(readFileSync(cacheFile, "utf-8")) as
      | Partial<VersionCache>
      | undefined;
    if (!data || typeof data.latest !== "string" || typeof data.checkedAt !== "number") {
      return null;
    }
    if (Date.now() - data.checkedAt > CACHE_TTL_MS) return null;
    return {
      latest: data.latest,
      checkedAt: data.checkedAt,
      downloadUrl: data.downloadUrl,
    };
  } catch {
    return null;
  }
}

function saveCache(cache: VersionCache): void {
  try {
    const configDir = getConfigDir();
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(getVersionCacheFile(), JSON.stringify(cache), { mode: 0o600 });
  } catch {
    // non-critical
  }
}

export interface FetchLatestReleaseOptions {
  refresh?: boolean;
}

export async function fetchLatestRelease(
  options: FetchLatestReleaseOptions = {}
): Promise<VersionCache | null> {
  // Check cache first unless explicitly bypassed.
  if (!options.refresh) {
    const cached = loadCache();
    if (cached) return cached;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "ride-cli-version-check",
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) return null;

    const release = (await response.json()) as GitHubRelease;
    const downloadUrl: Record<string, string> = {};

    for (const asset of release.assets) {
      if (asset.name.includes("linux-x64")) {
        downloadUrl["linux-x64"] = asset.browser_download_url;
      } else if (asset.name.includes("darwin-x64")) {
        downloadUrl["darwin-x64"] = asset.browser_download_url;
      } else if (asset.name.includes("darwin-arm64")) {
        downloadUrl["darwin-arm64"] = asset.browser_download_url;
      }
    }

    const cache: VersionCache = {
      latest: release.tag_name.replace(/^v/, ""),
      checkedAt: Date.now(),
      downloadUrl,
    };

    saveCache(cache);
    return cache;
  } catch {
    return null;
  }
}

export function getPlatformKey(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  return `${platform}-${arch}`;
}

/**
 * Check if CLI is outdated. Returns null if up-to-date or can't check.
 * Returns the latest version string if outdated.
 */
export async function checkForUpdate(): Promise<string | null> {
  // In dev mode (version not injected), skip check
  if (!isValidVersion(CURRENT_VERSION)) return null;

  const release = await fetchLatestRelease();
  if (!release) return null;

  if (isOutdated(CURRENT_VERSION, release.latest)) {
    return release.latest;
  }

  return null;
}

function getVersionCacheFile(): string {
  return join(getConfigDir(), "version-cache.json");
}
