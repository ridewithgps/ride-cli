import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, saveConfig } from "./config.js";

const originalConfigDir = process.env.RIDE_CONFIG_DIR;
const originalApiUrl = process.env.RIDE_API_URL;
let tempConfigDir = "";

beforeEach(() => {
  tempConfigDir = mkdtempSync(join(tmpdir(), "ride-config-test-"));
  process.env.RIDE_CONFIG_DIR = tempConfigDir;
  delete process.env.RIDE_API_URL;
});

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.RIDE_CONFIG_DIR;
  } else {
    process.env.RIDE_CONFIG_DIR = originalConfigDir;
  }

  if (originalApiUrl === undefined) {
    delete process.env.RIDE_API_URL;
  } else {
    process.env.RIDE_API_URL = originalApiUrl;
  }

  if (tempConfigDir) {
    rmSync(tempConfigDir, { recursive: true, force: true });
  }
});

describe("config integration", () => {
  test("defaults to cowboy API host", () => {
    const config = loadConfig();
    expect(config.apiUrl).toBe("https://cowboy.ridewithgps.com");
  });

  test("ignores saved localhost URL when no override is set", () => {
    saveConfig({
      apiUrl: "http://localhost:6500",
      token: "dev-token",
    });

    const config = loadConfig();
    expect(config.apiUrl).toBe("https://cowboy.ridewithgps.com");
    expect(config.oauth?.accessToken).toBe("dev-token");
  });

  test("respects explicit RIDE_API_URL override", () => {
    saveConfig({ apiUrl: "http://localhost:6500" });
    process.env.RIDE_API_URL = "http://localhost:7000";

    const config = loadConfig();
    expect(config.apiUrl).toBe("http://localhost:7000");
  });

  test("migrates legacy token field into oauth session", () => {
    saveConfig({
      apiUrl: "https://ride.test",
      token: "legacy-token",
    });

    const config = loadConfig();
    expect(config.oauth?.accessToken).toBe("legacy-token");
    expect(config.oauth?.tokenType).toBe("Bearer");
  });

  test("drops legacy auth fields when oauth is persisted", () => {
    saveConfig({
      apiUrl: "https://ride.test",
      oauth: {
        accessToken: "oauth-token",
        tokenType: "Bearer",
      },
      token: "legacy-token",
      apikey: "legacy-apikey",
    });

    const config = loadConfig();
    expect(config.oauth?.accessToken).toBe("oauth-token");
    expect(config.token).toBeUndefined();
    expect(config.apikey).toBeUndefined();
  });
});
