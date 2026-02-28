import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CachedUser {
  id: number;
  name: string;
  email: string;
}

export interface OAuthSession {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: number;
  scope?: string;
}

export interface Config {
  apiUrl: string;
  oauth?: OAuthSession;
  // Legacy fields kept for migration/backward compatibility.
  token?: string;
  apikey?: string;
  user?: CachedUser;
}

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "ride");
const DEFAULT_API_URL = "https://cowboy.ridewithgps.com";

function isLoopbackHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveConfigDir(): string {
  return process.env.RIDE_CONFIG_DIR || DEFAULT_CONFIG_DIR;
}

function resolveConfigFile(): string {
  return join(resolveConfigDir(), "config.json");
}

export function getConfigDir(): string {
  return resolveConfigDir();
}

function normalizeConfig(config: Config): Config {
  if (!config.oauth?.accessToken && config.token) {
    config.oauth = {
      accessToken: config.token,
      tokenType: "Bearer",
    };
  }

  return config;
}

export function loadConfig(): Config {
  const configFile = resolveConfigFile();
  const apiUrlOverride = process.env.RIDE_API_URL;
  const defaults: Config = {
    apiUrl: apiUrlOverride || DEFAULT_API_URL,
  };

  if (!existsSync(configFile)) {
    return defaults;
  }

  try {
    const raw = readFileSync(configFile, "utf-8");
    const saved = JSON.parse(raw) as Partial<Config>;
    const merged = normalizeConfig({ ...defaults, ...saved });

    if (apiUrlOverride) {
      merged.apiUrl = apiUrlOverride;
      return merged;
    }

    // Guard against stale local-development config leaking into production usage.
    if (!apiUrlOverride && isLoopbackHost(merged.apiUrl)) {
      merged.apiUrl = DEFAULT_API_URL;
    }

    return merged;
  } catch {
    return defaults;
  }
}

export function saveConfig(config: Config): void {
  const normalized = normalizeConfig(config);
  // Drop legacy fields from persisted state once oauth session exists.
  if (normalized.oauth?.accessToken) {
    delete normalized.token;
    delete normalized.apikey;
  }

  const configDir = resolveConfigDir();
  const configFile = resolveConfigFile();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  const tmpFile = configFile + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  renameSync(tmpFile, configFile);
}

export function isAuthenticated(): boolean {
  const config = loadConfig();
  return !!(config.oauth?.accessToken || config.oauth?.refreshToken || config.token);
}

export function clearAuth(): void {
  const config = loadConfig();
  delete config.oauth;
  delete config.token;
  delete config.apikey;
  delete config.user;
  saveConfig(config);
}
