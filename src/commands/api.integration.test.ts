import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiCommand } from "./api.js";
import { saveConfig } from "../lib/config.js";

const originalFetch = globalThis.fetch;
const originalConfigDir = process.env.RIDE_CONFIG_DIR;
const originalWrite = process.stdout.write.bind(process.stdout);
let tempConfigDir = "";

beforeEach(() => {
  tempConfigDir = mkdtempSync(join(tmpdir(), "ride-api-cmd-test-"));
  process.env.RIDE_CONFIG_DIR = tempConfigDir;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  saveConfig({
    apiUrl: "https://ride.test",
    oauth: {
      accessToken: "test-token",
      tokenType: "Bearer",
    },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalWrite;
  if (originalConfigDir === undefined) {
    delete process.env.RIDE_CONFIG_DIR;
  } else {
    process.env.RIDE_CONFIG_DIR = originalConfigDir;
  }
  if (tempConfigDir) {
    rmSync(tempConfigDir, { recursive: true, force: true });
  }
});

describe("api command", () => {
  test("sends method, headers, query params, and json body", async () => {
    let calledUrl = "";
    let calledMethod = "";
    let calledBody = "";
    let calledHeaders = new Headers();
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      calledUrl = typeof input === "string" ? input : input.toString();
      calledMethod = String(init?.method || "");
      calledBody = String(init?.body || "");
      calledHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await apiCommand("post", "/api/v1/events.json", {
      query: ["page=2"],
      header: ["X-Test: abc123"],
      json: '{"name":"demo"}',
    });

    expect(calledUrl).toBe("https://ride.test/api/v1/events.json?page=2");
    expect(calledMethod).toBe("POST");
    expect(calledBody).toBe('{"name":"demo"}');
    expect(calledHeaders.get("authorization")).toBe("Bearer test-token");
    expect(calledHeaders.get("x-test")).toBe("abc123");
    expect(calledHeaders.get("content-type")).toBe("application/json");
  });

  test("reads body from @file", async () => {
    const payloadPath = join(tempConfigDir, "body.json");
    writeFileSync(payloadPath, '{"source":"file"}');

    let calledBody = "";
    globalThis.fetch = (async (
      _input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      calledBody = String(init?.body || "");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await apiCommand("post", "/api/v1/events.json", {
      json: `@${payloadPath}`,
    });

    expect(calledBody).toBe('{"source":"file"}');
  });

  test("rejects non-v1 paths", async () => {
    try {
      await apiCommand("get", "/trips.json");
      throw new Error("Expected apiCommand to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("only supports /api/v1");
    }
  });
});
