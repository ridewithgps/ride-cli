import { loadConfig } from "./config.js";
import { parseToolArgs } from "./tool-args.js";
import { AuthRefreshError, ensureAccessToken, hasRefreshToken } from "./auth.js";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly isNetworkError: boolean = false
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function resolveUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return new URL(path, baseUrl).toString();
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: string;
      errors?: unknown;
      message?: string;
    };

    if (typeof payload.error === "string") {
      return payload.error;
    }

    if (typeof payload.message === "string") {
      return payload.message;
    }

    if (Array.isArray(payload.errors)) {
      const first = payload.errors.find((value) => typeof value === "string");
      if (typeof first === "string") {
        return first;
      }
    }
  } catch {
    // fallback below
  }

  return `HTTP ${response.status}`;
}

async function fetchWithNetworkHandling(
  url: string,
  options: RequestInit
): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new ApiError(
      `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      undefined,
      true
    );
  }
}

async function apiRawRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const config = loadConfig();
  const url = resolveUrl(config.apiUrl, path);
  const headers = new Headers(options.headers || {});

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const method = String(options.method || "GET").toUpperCase();
  if (
    options.body !== undefined &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const token = await ensureAccessToken(false);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  } catch (error) {
    if (error instanceof AuthRefreshError) {
      throw new ApiError(error.message, 401);
    }
    throw error;
  }

  let response = await fetchWithNetworkHandling(url, { ...options, headers });

  if (response.status !== 401 || !hasRefreshToken()) {
    return response;
  }

  try {
    const refreshedToken = await ensureAccessToken(true);
    if (!refreshedToken) {
      return response;
    }

    const retryHeaders = new Headers(headers);
    retryHeaders.set("Authorization", `Bearer ${refreshedToken}`);
    response = await fetchWithNetworkHandling(url, {
      ...options,
      headers: retryHeaders,
    });

    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof AuthRefreshError) {
      // Return original unauthorized response if refresh fails.
      return response;
    }

    throw new ApiError(error instanceof Error ? error.message : "Unknown error");
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await apiRawRequest(path, options);

  if (!response.ok) {
    const errorMessage = await parseApiError(response);
    throw new ApiError(errorMessage, response.status, false);
  }

  return response.json() as Promise<T>;
}

export interface ApiResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    entries[key] = value;
  }
  return entries;
}

export async function requestApi(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse> {
  const response = await apiRawRequest(path, options);
  const body = await response.text();
  return {
    status: response.status,
    body,
    headers: headersToRecord(response.headers),
  };
}

// Prompt
export interface PromptResponse {
  prompt: string;
  conversation_id: number;
  tools: ToolSchema[];
}

export interface ToolSchema {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export async function getPrompt(): Promise<PromptResponse> {
  return apiRequest<PromptResponse>("/cadence/cli/prompt");
}

// Tools
export interface ToolsListResponse {
  tools: ToolSchema[];
}

export async function listTools(): Promise<ToolsListResponse> {
  return apiRequest<ToolsListResponse>("/cadence/cli/tools");
}

export interface ToolExecuteResponse {
  output: string;
  error: boolean;
}

export async function executeTool(
  toolName: string,
  args: string[]
): Promise<ToolExecuteResponse> {
  const toolArgs = parseToolArgs(args);

  return apiRequest<ToolExecuteResponse>("/cadence/cli/tools/execute", {
    method: "POST",
    body: JSON.stringify({ tool: toolName, arguments: toolArgs }),
  });
}

export interface CurrentUserResponse {
  user: { id: number; name?: string; email?: string };
}

export async function getCurrentUserV1(): Promise<CurrentUserResponse> {
  return apiRequest<CurrentUserResponse>("/api/v1/users/current");
}
