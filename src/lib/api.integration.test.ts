import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError, executeTool, listTools, requestApi } from "./api.js";
import { loadConfig, saveConfig } from "./config.js";

const originalFetch = globalThis.fetch;
const originalConfigDir = process.env.RIDE_CONFIG_DIR;
const originalApiUrl = process.env.RIDE_API_URL;
let tempConfigDir = "";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  tempConfigDir = mkdtempSync(join(tmpdir(), "ride-api-test-"));
  process.env.RIDE_CONFIG_DIR = tempConfigDir;
  delete process.env.RIDE_API_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
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

describe("api integration", () => {
  test("listTools sends bearer auth from oauth config", async () => {
    saveConfig({
      apiUrl: "https://ride.test",
      oauth: {
        accessToken: "test-token",
        tokenType: "Bearer",
      },
    });

    let calledUrl = "";
    let calledHeaders = new Headers();
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      calledUrl = typeof input === "string" ? input : input.toString();
      calledHeaders = new Headers(init?.headers);
      return jsonResponse({ tools: [] });
    }) as unknown as typeof fetch;

    const result = await listTools();

    expect(result.tools).toEqual([]);
    expect(calledUrl).toBe("https://ride.test/cadence/cli/tools");
    expect(calledHeaders.get("authorization")).toBe("Bearer test-token");
    expect(calledHeaders.get("accept")).toBe("application/json");
  });

  test("executeTool sends parsed argument payload", async () => {
    saveConfig({
      apiUrl: "https://ride.test",
      oauth: {
        accessToken: "test-token",
        tokenType: "Bearer",
      },
    });

    let requestBody = "";
    let contentType = "";
    globalThis.fetch = (async (
      _input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      requestBody = String(init?.body ?? "");
      contentType = new Headers(init?.headers).get("content-type") || "";
      return jsonResponse({
        output: '{"ok":true}',
        error: false,
      });
    }) as unknown as typeof fetch;

    await executeTool("search_my_rides", [
      "--limit",
      "5",
      "--include=power",
      "gravel",
    ]);

    expect(contentType).toBe("application/json");
    expect(JSON.parse(requestBody)).toEqual({
      tool: "search_my_rides",
      arguments: {
        limit: 5,
        include: "power",
        _args: ["gravel"],
      },
    });
  });

  test("retries once with refreshed token after unauthorized response", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    saveConfig({
      apiUrl: "https://ride.test",
      oauth: {
        accessToken: "old-token",
        refreshToken: "refresh-token",
        tokenType: "Bearer",
        expiresAt: future,
      },
    });

    const authHeaders: string[] = [];
    let toolsCalls = 0;
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = new Headers(init?.headers);
      authHeaders.push(headers.get("authorization") || "");

      if (url === "https://ride.test/cadence/cli/tools") {
        toolsCalls += 1;
        if (toolsCalls === 1) {
          return jsonResponse({ errors: ["Failed to authenticate the request"] }, 401);
        }
        return jsonResponse({ tools: [] }, 200);
      }

      if (url === "https://ride.test/oauth/token") {
        return jsonResponse({
          access_token: "new-token",
          refresh_token: "new-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }

      return jsonResponse({ error: "unexpected request" }, 500);
    }) as unknown as typeof fetch;

    const result = await listTools();

    expect(result.tools).toEqual([]);
    expect(toolsCalls).toBe(2);
    expect(authHeaders).toContain("Bearer old-token");
    expect(authHeaders).toContain("Bearer new-token");
    expect(loadConfig().oauth?.accessToken).toBe("new-token");
  });

  test("requestApi returns raw response payload", async () => {
    saveConfig({
      apiUrl: "https://ride.test",
      oauth: {
        accessToken: "test-token",
        tokenType: "Bearer",
      },
    });

    globalThis.fetch = (async (): Promise<Response> => {
      return new Response("plain-text-response", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }) as unknown as typeof fetch;

    const result = await requestApi("/api/v1/users/current", { method: "GET" });
    expect(result.status).toBe(200);
    expect(result.body).toBe("plain-text-response");
    expect(result.headers["content-type"]).toBe("text/plain");
  });

  test("network errors surface ApiError with network flag", async () => {
    saveConfig({
      apiUrl: "https://ride.test",
      oauth: {
        accessToken: "test-token",
        tokenType: "Bearer",
      },
    });

    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;

    try {
      await listTools();
      throw new Error("Expected listTools to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.isNetworkError).toBe(true);
      expect(apiError.status).toBeUndefined();
      expect(apiError.message).toContain("Network error");
    }
  });
});
