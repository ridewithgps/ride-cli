import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { requestApi, ApiError } from "./api.js";
import { getConfigDir, loadConfig } from "./config.js";

const OPENAPI_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const OPENAPI_SPEC_PATH = "/api/v1/openapi.yaml";

type JsonObject = Record<string, unknown>;

interface OpenApiCache {
  apiUrl: string;
  fetchedAt: number;
  rawSpec: string;
}

interface OpenApiDocument extends JsonObject {
  paths?: Record<string, unknown>;
  security?: unknown;
}

interface OpenApiParameter extends JsonObject {
  name?: unknown;
  in?: unknown;
  required?: unknown;
  description?: unknown;
  schema?: unknown;
}

interface OpenApiMediaType extends JsonObject {
  schema?: unknown;
}

interface OpenApiRequestBody extends JsonObject {
  required?: unknown;
  content?: Record<string, unknown>;
}

interface OpenApiResponse extends JsonObject {
  description?: unknown;
}

interface OpenApiOperation extends JsonObject {
  summary?: unknown;
  description?: unknown;
  tags?: unknown;
  operationId?: unknown;
  parameters?: unknown;
  requestBody?: unknown;
  responses?: unknown;
  security?: unknown;
}

export interface ApiParameterDoc {
  name: string;
  in: string;
  required: boolean;
  type: string;
  description?: string;
}

export interface ApiRequestBodyDoc {
  contentType: string;
  required: boolean;
  schemaType: string;
}

export interface ApiResponseDoc {
  status: string;
  description: string;
}

export interface ApiOperationDoc {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags: string[];
  operationId?: string;
  parameters: ApiParameterDoc[];
  requestBodies: ApiRequestBodyDoc[];
  responses: ApiResponseDoc[];
  security: string[];
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function extractRefTarget(spec: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = spec;
  for (const part of parts) {
    if (!isObject(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

function resolveRef<T>(spec: OpenApiDocument, value: T): T {
  if (!isObject(value)) {
    return value;
  }

  const ref = value.$ref;
  if (typeof ref !== "string") {
    return value;
  }

  const resolved = extractRefTarget(spec, ref);
  if (resolved === undefined) {
    return value;
  }

  return resolved as T;
}

function schemaTypeToText(spec: OpenApiDocument, schemaValue: unknown): string {
  const schema = resolveRef(spec, schemaValue);
  if (!isObject(schema)) {
    return "any";
  }

  const type = schema.type;
  if (typeof type === "string") {
    if (type === "array") {
      const itemType = schemaTypeToText(spec, schema.items);
      return `array<${itemType}>`;
    }

    const format = schema.format;
    if (typeof format === "string" && format.length > 0) {
      return `${type} (${format})`;
    }

    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return `${type} enum`;
    }

    return type;
  }

  if (Array.isArray(schema.oneOf)) return "oneOf";
  if (Array.isArray(schema.anyOf)) return "anyOf";
  if (Array.isArray(schema.allOf)) return "allOf";
  if (isObject(schema.properties)) return "object";

  return "any";
}

function loadOpenApiCache(): OpenApiCache | null {
  try {
    const cacheFile = getOpenApiCacheFile();
    if (!existsSync(cacheFile)) {
      return null;
    }

    const parsed = JSON.parse(readFileSync(cacheFile, "utf-8")) as
      | Partial<OpenApiCache>
      | undefined;
    if (
      !parsed ||
      typeof parsed.apiUrl !== "string" ||
      typeof parsed.fetchedAt !== "number" ||
      typeof parsed.rawSpec !== "string"
    ) {
      return null;
    }

    const currentApiUrl = loadConfig().apiUrl;
    if (parsed.apiUrl !== currentApiUrl) {
      return null;
    }

    if (Date.now() - parsed.fetchedAt > OPENAPI_CACHE_TTL_MS) {
      return null;
    }

    return {
      apiUrl: parsed.apiUrl,
      fetchedAt: parsed.fetchedAt,
      rawSpec: parsed.rawSpec,
    };
  } catch {
    return null;
  }
}

function saveOpenApiCache(rawSpec: string): void {
  try {
    const configDir = getConfigDir();
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }

    const cache: OpenApiCache = {
      apiUrl: loadConfig().apiUrl,
      fetchedAt: Date.now(),
      rawSpec,
    };

    writeFileSync(getOpenApiCacheFile(), JSON.stringify(cache), { mode: 0o600 });
  } catch {
    // cache failures are non-critical
  }
}

async function fetchOpenApiSpecRaw(refresh: boolean): Promise<string> {
  if (!refresh) {
    const cached = loadOpenApiCache();
    if (cached) {
      return cached.rawSpec;
    }
  }

  const response = await requestApi(OPENAPI_SPEC_PATH, {
    method: "GET",
    headers: {
      Accept: "application/yaml, text/yaml, application/x-yaml, text/plain",
    },
  });

  if (response.status >= 400) {
    throw new ApiError(
      `Failed to load OpenAPI spec (HTTP ${response.status})`,
      response.status
    );
  }

  const body = response.body.trim();
  if (!body) {
    throw new Error("OpenAPI spec response was empty.");
  }

  saveOpenApiCache(body);
  return body;
}

function parseOpenApiSpec(rawSpec: string): OpenApiDocument {
  let parsed: unknown;
  try {
    parsed = parseYaml(rawSpec);
  } catch (error) {
    throw new Error(
      `Failed to parse OpenAPI spec: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  if (!isObject(parsed)) {
    throw new Error("OpenAPI spec is not an object.");
  }

  const spec = parsed as OpenApiDocument;
  if (!isObject(spec.paths)) {
    throw new Error("OpenAPI spec does not include valid paths.");
  }

  return spec;
}

function derivePathTag(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 3) {
    return "general";
  }

  const candidate = segments[2];
  return candidate.replace(/\.json$/i, "");
}

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
] as const;

function extractParameters(
  spec: OpenApiDocument,
  pathItem: JsonObject,
  operation: OpenApiOperation
): ApiParameterDoc[] {
  const merged = [
    ...toArray<unknown>(pathItem.parameters),
    ...toArray<unknown>(operation.parameters),
  ];

  const result: ApiParameterDoc[] = [];
  const byKey = new Map<string, number>();

  for (const parameterValue of merged) {
    const resolved = resolveRef(spec, parameterValue);
    if (!isObject(resolved)) {
      continue;
    }

    const parameter = resolved as OpenApiParameter;
    if (typeof parameter.name !== "string" || typeof parameter.in !== "string") {
      continue;
    }

    const key = `${parameter.in}:${parameter.name}`;
    const item: ApiParameterDoc = {
      name: parameter.name,
      in: parameter.in,
      required: parameter.required === true,
      type: schemaTypeToText(spec, parameter.schema),
      description:
        typeof parameter.description === "string" ? parameter.description : undefined,
    };

    if (byKey.has(key)) {
      result[byKey.get(key) as number] = item;
    } else {
      byKey.set(key, result.length);
      result.push(item);
    }
  }

  return result;
}

function extractRequestBodies(
  spec: OpenApiDocument,
  operation: OpenApiOperation
): ApiRequestBodyDoc[] {
  const resolved = resolveRef(spec, operation.requestBody);
  if (!isObject(resolved)) {
    return [];
  }

  const requestBody = resolved as OpenApiRequestBody;
  if (!isObject(requestBody.content)) {
    return [];
  }

  const result: ApiRequestBodyDoc[] = [];
  for (const [contentType, mediaTypeValue] of Object.entries(requestBody.content)) {
    const mediaType = resolveRef(spec, mediaTypeValue);
    if (!isObject(mediaType)) {
      continue;
    }

    const typedMedia = mediaType as OpenApiMediaType;
    result.push({
      contentType,
      required: requestBody.required === true,
      schemaType: schemaTypeToText(spec, typedMedia.schema),
    });
  }

  return result;
}

function extractResponses(
  spec: OpenApiDocument,
  operation: OpenApiOperation
): ApiResponseDoc[] {
  if (!isObject(operation.responses)) {
    return [];
  }

  const result: ApiResponseDoc[] = [];
  for (const [status, responseValue] of Object.entries(operation.responses)) {
    const resolved = resolveRef(spec, responseValue);
    if (!isObject(resolved)) {
      continue;
    }

    const response = resolved as OpenApiResponse;
    result.push({
      status,
      description:
        typeof response.description === "string"
          ? response.description
          : "No description",
    });
  }

  return result.sort((a, b) => a.status.localeCompare(b.status));
}

function extractSecurity(
  securityValue: unknown
): string[] {
  const requirements = toArray<Record<string, unknown>>(securityValue);
  const result: string[] = [];

  for (const requirement of requirements) {
    if (!isObject(requirement)) {
      continue;
    }
    for (const [scheme, scopesValue] of Object.entries(requirement)) {
      if (Array.isArray(scopesValue) && scopesValue.length > 0) {
        const scopes = scopesValue
          .filter((scope): scope is string => typeof scope === "string")
          .join(", ");
        result.push(`${scheme} (${scopes})`);
      } else {
        result.push(scheme);
      }
    }
  }

  return Array.from(new Set(result));
}

function buildOperationDocs(spec: OpenApiDocument): ApiOperationDoc[] {
  const docs: ApiOperationDoc[] = [];
  const paths = spec.paths as Record<string, unknown>;

  for (const [path, pathItemValue] of Object.entries(paths)) {
    if (!isObject(pathItemValue)) {
      continue;
    }

    const pathItem = pathItemValue as JsonObject;
    for (const method of HTTP_METHODS) {
      const opValue = pathItem[method];
      if (!opValue) {
        continue;
      }

      const resolvedOp = resolveRef(spec, opValue);
      if (!isObject(resolvedOp)) {
        continue;
      }

      const operation = resolvedOp as OpenApiOperation;
      const tags = toArray<string>(operation.tags).filter(
        (tag): tag is string => typeof tag === "string" && tag.length > 0
      );

      docs.push({
        method,
        path,
        summary: typeof operation.summary === "string" ? operation.summary : undefined,
        description:
          typeof operation.description === "string"
            ? operation.description
            : undefined,
        tags: tags.length > 0 ? tags : [derivePathTag(path)],
        operationId:
          typeof operation.operationId === "string" ? operation.operationId : undefined,
        parameters: extractParameters(spec, pathItem, operation),
        requestBodies: extractRequestBodies(spec, operation),
        responses: extractResponses(spec, operation),
        security: extractSecurity(operation.security ?? spec.security),
      });
    }
  }

  return docs.sort((a, b) => {
    if (a.path === b.path) {
      return a.method.localeCompare(b.method);
    }
    return a.path.localeCompare(b.path);
  });
}

export interface LoadOpenApiDocsOptions {
  refresh?: boolean;
}

export async function loadOpenApiDocs(
  options: LoadOpenApiDocsOptions = {}
): Promise<ApiOperationDoc[]> {
  const rawSpec = await fetchOpenApiSpecRaw(!!options.refresh);
  const spec = parseOpenApiSpec(rawSpec);
  return buildOperationDocs(spec);
}

export function normalizeApiPathForDocs(path: string): string {
  const cleaned = path.trim().split("?")[0];
  if (!cleaned) {
    return "/api/v1";
  }

  const withLeadingSlash = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  if (withLeadingSlash === "/api/v1" || withLeadingSlash.startsWith("/api/v1/")) {
    return withLeadingSlash;
  }

  return `/api/v1${withLeadingSlash}`;
}

function templatePathMatches(operationPath: string, requestedPath: string): boolean {
  const opParts = operationPath.split("/").filter(Boolean);
  const reqParts = requestedPath.split("/").filter(Boolean);
  if (opParts.length !== reqParts.length) {
    return false;
  }

  for (let index = 0; index < opParts.length; index += 1) {
    const opPart = opParts[index];
    const reqPart = reqParts[index];
    const escaped = opPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const withPlaceholders = escaped.replace(/\\\{[^}]+\\\}/g, "[^/]+");
    const matcher = new RegExp(`^${withPlaceholders}$`);
    if (!matcher.test(reqPart)) {
      return false;
    }
  }

  return true;
}

function getOpenApiCacheFile(): string {
  return join(getConfigDir(), "openapi-cache.json");
}

export function findOperationDoc(
  operations: ApiOperationDoc[],
  method: string,
  path: string
): ApiOperationDoc | undefined {
  const normalizedMethod = method.toLowerCase();
  const normalizedPath = normalizeApiPathForDocs(path);

  const exact = operations.find(
    (operation) =>
      operation.method === normalizedMethod && operation.path === normalizedPath
  );
  if (exact) {
    return exact;
  }

  return operations.find(
    (operation) =>
      operation.method === normalizedMethod &&
      templatePathMatches(operation.path, normalizedPath)
  );
}
