function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function maybeParseJson(value: string): unknown {
  const trimmed = value.trim();
  const startsLikeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));

  if (!startsLikeJson) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function parseCliValue(value: string): unknown {
  const trimmed = value.trim();

  if (/^-?(0|[1-9]\d*)$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }

  if (
    /^-?(?:\d+\.\d+|\d+\.|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed) ||
    /^-?\d+[eE][+-]?\d+$/.test(trimmed)
  ) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;

  return maybeParseJson(value);
}

export function parseToolArgs(args: string[]): Record<string, unknown> {
  const namedArgs: Record<string, unknown> = {};
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith("--") || arg.length <= 2) {
      positionalArgs.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");

    if (equalsIndex > 0) {
      const key = raw.slice(0, equalsIndex);
      const value = raw.slice(equalsIndex + 1);
      namedArgs[key] = parseCliValue(value);
      continue;
    }

    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      namedArgs[raw] = parseCliValue(next);
      i++;
      continue;
    }

    namedArgs[raw] = true;
  }

  if (positionalArgs.length === 0) {
    return namedArgs;
  }

  if (Object.keys(namedArgs).length === 0) {
    if (positionalArgs.length === 1) {
      const parsed = parseCliValue(positionalArgs[0]);
      if (isPlainObject(parsed)) {
        return parsed;
      }
      return { query: parsed };
    }

    return { args: positionalArgs.map(parseCliValue) };
  }

  namedArgs._args = positionalArgs.map(parseCliValue);
  return namedArgs;
}
