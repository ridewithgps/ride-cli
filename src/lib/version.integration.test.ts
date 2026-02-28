import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchLatestRelease } from "./version.js";

const originalFetch = globalThis.fetch;
const originalConfigDir = process.env.RIDE_CONFIG_DIR;
let tempConfigDir = "";

beforeEach(() => {
  tempConfigDir = mkdtempSync(join(tmpdir(), "ride-version-test-"));
  process.env.RIDE_CONFIG_DIR = tempConfigDir;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalConfigDir === undefined) {
    delete process.env.RIDE_CONFIG_DIR;
  } else {
    process.env.RIDE_CONFIG_DIR = originalConfigDir;
  }

  if (tempConfigDir) {
    rmSync(tempConfigDir, { recursive: true, force: true });
  }
});

describe("fetchLatestRelease", () => {
  test("uses cache by default and bypasses it with refresh=true", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          tag_name: "v9.9.9",
          assets: [
            {
              name: "ride-linux-x64",
              browser_download_url: "https://example.com/ride-linux-x64",
            },
          ],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const first = await fetchLatestRelease();
    expect(first?.latest).toBe("9.9.9");
    expect(fetchCount).toBe(1);

    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          tag_name: "v9.9.8",
          assets: [],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const cached = await fetchLatestRelease();
    expect(cached?.latest).toBe("9.9.9");
    expect(fetchCount).toBe(1);

    const refreshed = await fetchLatestRelease({ refresh: true });
    expect(refreshed?.latest).toBe("9.9.8");
    expect(fetchCount).toBe(2);
  });
});

