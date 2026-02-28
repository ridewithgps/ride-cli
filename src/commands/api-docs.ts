import {
  findOperationDoc,
  loadOpenApiDocs,
  normalizeApiPathForDocs,
  type ApiOperationDoc,
} from "../lib/openapi.js";

const DEFAULT_LIST_LIMIT = 30;
const DEFAULT_FIND_LIMIT = 20;
const MAX_RESULTS_LIMIT = 200;

export interface ApiDocsCommandOptions {
  refresh?: boolean;
  limit?: number;
}

function normalizeLimit(input: unknown, fallback: number): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return fallback;
  }

  const rounded = Math.floor(input);
  if (rounded < 1) {
    return fallback;
  }

  return Math.min(rounded, MAX_RESULTS_LIMIT);
}

function operationLine(operation: ApiOperationDoc): string {
  const headline = operation.summary || operation.description;
  if (headline) {
    return `${operation.method.toUpperCase()} ${operation.path} — ${headline}`;
  }
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

function groupOperationsByTag(
  operations: ApiOperationDoc[]
): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    const primary = operation.tags[0] || "general";
    counts.set(primary, (counts.get(primary) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => {
      if (a.count === b.count) {
        return a.tag.localeCompare(b.tag);
      }
      return b.count - a.count;
    });
}

export async function apiDocsListCommand(
  options: ApiDocsCommandOptions = {}
): Promise<void> {
  const operations = await loadOpenApiDocs({ refresh: !!options.refresh });
  const limit = normalizeLimit(options.limit, DEFAULT_LIST_LIMIT);
  const grouped = groupOperationsByTag(operations);

  process.stdout.write(`API v1 operations: ${operations.length}\n`);
  process.stdout.write("Groups:\n");
  for (const group of grouped) {
    process.stdout.write(`- ${group.tag} (${group.count})\n`);
  }

  if (operations.length === 0) {
    process.stdout.write("\nNo operations were found in the OpenAPI spec.\n");
    return;
  }

  const visible = operations.slice(0, limit);
  process.stdout.write(
    `\nOperations (showing ${visible.length} of ${operations.length}):\n`
  );
  for (const operation of visible) {
    process.stdout.write(`- ${operationLine(operation)}\n`);
  }

  process.stdout.write(
    "\nUse `ride api docs find <query>` or `ride api docs show <method> <path>` for deeper lookup.\n"
  );
}

function scoreOperation(operation: ApiOperationDoc, tokens: string[]): number {
  const haystack = [
    operation.method,
    operation.path,
    operation.summary || "",
    operation.description || "",
    operation.operationId || "",
    operation.tags.join(" "),
    operation.parameters.map((parameter) => parameter.name).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (haystack.includes(token)) {
      score += 1;
      if (operation.path.toLowerCase().includes(token)) score += 1;
      if (operation.method.toLowerCase() === token) score += 2;
    }
  }

  const fullQuery = tokens.join(" ").trim();
  if (fullQuery && haystack.includes(fullQuery)) {
    score += 2;
  }

  return score;
}

export async function apiDocsFindCommand(
  query: string,
  options: ApiDocsCommandOptions = {}
): Promise<void> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    throw new Error("Query cannot be empty.");
  }

  const operations = await loadOpenApiDocs({ refresh: !!options.refresh });
  const tokens = normalizedQuery.split(/\s+/);
  const limit = normalizeLimit(options.limit, DEFAULT_FIND_LIMIT);

  const matches = operations
    .map((operation) => ({
      operation,
      score: scoreOperation(operation, tokens),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => {
      if (a.score === b.score) {
        return operationLine(a.operation).localeCompare(operationLine(b.operation));
      }
      return b.score - a.score;
    })
    .slice(0, limit);

  if (matches.length === 0) {
    process.stdout.write(`No API operations matched "${query}".\n`);
    return;
  }

  process.stdout.write(
    `Found ${matches.length} matching operation${matches.length === 1 ? "" : "s"}:\n`
  );
  for (const match of matches) {
    process.stdout.write(`- ${operationLine(match.operation)}\n`);
  }
}

function formatParameter(parameter: ApiOperationDoc["parameters"][number]): string {
  const required = parameter.required ? " (required)" : "";
  const details = parameter.description ? ` — ${parameter.description}` : "";
  return `- ${parameter.in}.${parameter.name}${required}: ${parameter.type}${details}`;
}

function formatUsagePath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "<$1>");
}

export async function apiDocsShowCommand(
  method: string,
  path: string,
  options: ApiDocsCommandOptions = {}
): Promise<void> {
  const operations = await loadOpenApiDocs({ refresh: !!options.refresh });
  const operation = findOperationDoc(operations, method, path);

  if (!operation) {
    throw new Error(
      `No API operation found for ${method.toUpperCase()} ${normalizeApiPathForDocs(path)}`
    );
  }

  process.stdout.write(`${operation.method.toUpperCase()} ${operation.path}\n`);
  if (operation.summary) {
    process.stdout.write(`Summary: ${operation.summary}\n`);
  }
  if (operation.description) {
    process.stdout.write(`Description: ${operation.description}\n`);
  }
  if (operation.operationId) {
    process.stdout.write(`Operation ID: ${operation.operationId}\n`);
  }

  process.stdout.write(
    `Tags: ${operation.tags.length > 0 ? operation.tags.join(", ") : "none"}\n`
  );
  process.stdout.write(
    `Security: ${
      operation.security.length > 0 ? operation.security.join(", ") : "not declared"
    }\n`
  );

  process.stdout.write("\nParameters:\n");
  if (operation.parameters.length === 0) {
    process.stdout.write("- none\n");
  } else {
    for (const parameter of operation.parameters) {
      process.stdout.write(`${formatParameter(parameter)}\n`);
    }
  }

  process.stdout.write("\nRequest Body:\n");
  if (operation.requestBodies.length === 0) {
    process.stdout.write("- none\n");
  } else {
    for (const requestBody of operation.requestBodies) {
      const required = requestBody.required ? "required" : "optional";
      process.stdout.write(
        `- ${requestBody.contentType}: ${requestBody.schemaType} (${required})\n`
      );
    }
  }

  process.stdout.write("\nResponses:\n");
  if (operation.responses.length === 0) {
    process.stdout.write("- none\n");
  } else {
    for (const response of operation.responses) {
      process.stdout.write(`- ${response.status}: ${response.description}\n`);
    }
  }

  process.stdout.write("\nCLI usage:\n");
  process.stdout.write(
    `- ride api ${operation.method.toLowerCase()} ${formatUsagePath(operation.path)}\n`
  );
}

