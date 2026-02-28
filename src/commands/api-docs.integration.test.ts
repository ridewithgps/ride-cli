import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  apiDocsFindCommand,
  apiDocsListCommand,
  apiDocsShowCommand,
} from "./api-docs.js";
import { saveConfig } from "../lib/config.js";

const OPENAPI_YAML = `
openapi: 3.0.1
security:
  - oauth2:
    - user
paths:
  /api/v1/users/current:
    get:
      summary: Current user profile
      tags:
        - users
      responses:
        "200":
          description: ok
  /api/v1/events/{id}.json:
    patch:
      summary: Update event
      tags:
        - events
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
      responses:
        "200":
          description: updated
        "422":
          description: invalid
`;

const originalFetch = globalThis.fetch;
const originalConfigDir = process.env.RIDE_CONFIG_DIR;
const originalWrite = process.stdout.write.bind(process.stdout);
let tempConfigDir = "";
let output = "";

beforeEach(() => {
  tempConfigDir = mkdtempSync(join(tmpdir(), "ride-api-docs-test-"));
  process.env.RIDE_CONFIG_DIR = tempConfigDir;
  output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

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

describe("api docs command", () => {
  test("lists grouped operations from OpenAPI", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(OPENAPI_YAML, { status: 200 });
    }) as unknown as typeof fetch;

    await apiDocsListCommand();

    expect(fetchCount).toBe(1);
    expect(output).toContain("API v1 operations: 2");
    expect(output).toContain("- users (1)");
    expect(output).toContain("- events (1)");
    expect(output).toContain("GET /api/v1/users/current");
  });

  test("find searches operations by query text", async () => {
    globalThis.fetch = (async () =>
      new Response(OPENAPI_YAML, { status: 200 })) as unknown as typeof fetch;

    await apiDocsFindCommand("update event");

    expect(output).toContain("Found 1 matching operation");
    expect(output).toContain("PATCH /api/v1/events/{id}.json");
  });

  test("show resolves templated path and prints details", async () => {
    globalThis.fetch = (async () =>
      new Response(OPENAPI_YAML, { status: 200 })) as unknown as typeof fetch;

    await apiDocsShowCommand("patch", "/api/v1/events/123.json");

    expect(output).toContain("PATCH /api/v1/events/{id}.json");
    expect(output).toContain("Summary: Update event");
    expect(output).toContain("Security: oauth2 (user)");
    expect(output).toContain("path.id (required): integer");
    expect(output).toContain("application/json: object (required)");
    expect(output).toContain("ride api patch /api/v1/events/<id>.json");
  });

  test("reuses cached spec unless refresh is set", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(OPENAPI_YAML, { status: 200 });
    }) as unknown as typeof fetch;

    await apiDocsListCommand();
    await apiDocsFindCommand("users");
    expect(fetchCount).toBe(1);

    await apiDocsListCommand({ refresh: true });
    expect(fetchCount).toBe(2);
  });
});

