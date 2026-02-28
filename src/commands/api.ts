import { readFileSync } from "node:fs";
import { ApiError, requestApi } from "../lib/api.js";

export interface ApiCommandOptions {
  query?: string[];
  header?: string[];
  json?: string;
  data?: string;
}

export async function apiCommand(
  method: string,
  path: string,
  options: ApiCommandOptions = {}
): Promise<void> {
  const normalizedPath = appendQueryParams(normalizeApiPath(path), options.query || []);
  const headers = parseHeaderOptions(options.header || []);
  const body = readRequestBody(options);

  if (options.json && !hasHeader(headers, "content-type")) {
    headers["Content-Type"] = "application/json";
  }

  const response = await requestApi(normalizedPath, {
    method: method.toUpperCase(),
    headers,
    body,
  });

  const output = formatResponseBody(response.body);
  if (response.status >= 400) {
    const fallback = `Request failed with HTTP ${response.status}`;
    const message = output || fallback;
    throw new ApiError(message, response.status);
  }

  if (output) {
    process.stdout.write(output);
    if (!output.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
}

function normalizeApiPath(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    throw new Error("Use relative API paths (for example: /api/v1/trips.json).");
  }

  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!(normalized === "/api/v1" || normalized.startsWith("/api/v1/"))) {
    throw new Error("ride api only supports /api/v1 paths.");
  }

  return normalized;
}

function appendQueryParams(path: string, queryParams: string[]): string {
  if (queryParams.length === 0) {
    return path;
  }

  const url = new URL(path, "https://ride-cli.local");
  for (const entry of queryParams) {
    const idx = entry.indexOf("=");
    if (idx <= 0) {
      throw new Error(`Invalid --query value '${entry}'. Expected key=value.`);
    }
    const key = entry.slice(0, idx);
    const value = entry.slice(idx + 1);
    url.searchParams.append(key, value);
  }

  return `${url.pathname}${url.search}`;
}

function parseHeaderOptions(values: string[]): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const entry of values) {
    const idx = entry.indexOf(":");
    if (idx <= 0) {
      throw new Error(
        `Invalid --header value '${entry}'. Expected 'Header-Name: value'.`
      );
    }

    const key = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (!key) {
      throw new Error(`Invalid --header value '${entry}'. Header name is empty.`);
    }
    headers[key] = value;
  }

  return headers;
}

function hasHeader(headers: Record<string, string>, targetName: string): boolean {
  return Object.keys(headers).some(
    (key) => key.trim().toLowerCase() === targetName.toLowerCase()
  );
}

function readRequestBody(options: ApiCommandOptions): string | undefined {
  if (options.json && options.data) {
    throw new Error("Use either --json or --data, not both.");
  }

  if (options.json) {
    const raw = readInlineOrFile(options.json);
    try {
      JSON.parse(raw);
    } catch {
      throw new Error("--json must be valid JSON.");
    }
    return raw;
  }

  if (options.data) {
    return readInlineOrFile(options.data);
  }

  return undefined;
}

function readInlineOrFile(value: string): string {
  if (!value.startsWith("@")) {
    return value;
  }

  const filePath = value.slice(1);
  if (!filePath) {
    throw new Error("Missing path after '@' for body content.");
  }

  try {
    return readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to read '${filePath}': ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

function formatResponseBody(body: string): string {
  if (!body) {
    return "";
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return body;
  }
}
