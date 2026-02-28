import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { getPrompt } from "../lib/api.js";
import { isClaudeInstalled } from "../lib/claude.js";

interface ClaudeCommandDeps {
  isClaudeInstalled: () => boolean;
  getPrompt: typeof getPrompt;
  spawn: typeof spawn;
  mkdtempSync: typeof mkdtempSync;
  writeFileSync: typeof writeFileSync;
  rmSync: typeof rmSync;
  tmpdir: typeof tmpdir;
  dirname: typeof dirname;
  processArgv0: string;
  processEnv: NodeJS.ProcessEnv;
  logError: (...data: unknown[]) => void;
  exit: (code?: number) => never;
}

function withDefaultDeps(
  overrides: Partial<ClaudeCommandDeps> = {}
): ClaudeCommandDeps {
  return {
    isClaudeInstalled,
    getPrompt,
    spawn,
    mkdtempSync,
    writeFileSync,
    rmSync,
    tmpdir,
    dirname,
    processArgv0: process.argv[0] ?? "",
    processEnv: process.env,
    logError: (...data: unknown[]) => console.error(...data),
    exit: (code?: number): never => process.exit(code),
    ...overrides,
  };
}

function buildAllowedTools(promptFile: string): string[] {
  return [`Bash(ride tool:*)`, `Bash(ride api:*)`, `Read(${promptFile})`];
}

export async function claudeCommandWithDeps(
  args: string[],
  overrides: Partial<ClaudeCommandDeps> = {}
): Promise<void> {
  const deps = withDefaultDeps(overrides);

  if (!deps.isClaudeInstalled()) {
    deps.logError("Claude Code is not installed.");
    deps.logError("Install with: npm install -g @anthropic-ai/claude-code");
    deps.exit(1);
  }

  deps.logError("Fetching your personalized prompt and tools...");

  const promptData = await deps.getPrompt();

  // Build tool documentation for the system prompt
  const toolDocs = buildToolDocs(promptData.tools);

  const systemPrompt = [
    promptData.prompt,
    "",
    "## Available Tools",
    "Execute tools via `ride tool <name> [args]`. Arguments are passed as `--key value` or `--key=value` pairs.",
    "Do not prepend `cd` or shell wrappers. Invoke `ride tool ...` directly.",
    "Tool output is JSON. Always call tools to get real data — never guess or fabricate.",
    "",
    "## Public API v1 (On-Demand)",
    "Use `ride api ...` for raw endpoint access when you need fields or actions not covered by Cadence tools.",
    "Use `ride api docs list`, `ride api docs find <query>`, and `ride api docs show <method> <path>` to discover endpoint coverage and required parameters before calling endpoints.",
    "Prefer `ride tool ...` for higher-level cycling analysis and fewer calls.",
    "",
    toolDocs,
  ].join("\n");

  // Write full prompt to a temp file so we don't hit CLI arg limits
  const promptDir = deps.mkdtempSync(join(deps.tmpdir(), "ride-cli-"));
  const promptFile = join(promptDir, "system-prompt.md");
  deps.writeFileSync(promptFile, systemPrompt);

  // Find ride binary location to ensure it's in PATH
  const rideBin = deps.dirname(deps.processArgv0) || "";

  // Detect if this is print mode (non-interactive ask)
  const isPrintMode = args.includes("-p") || args.includes("--print");

  // Bootstrap: short append that tells Claude to read the full prompt from file
  const bootstrap = [
    "IMPORTANT: You are Cadence, the Ride with GPS cycling assistant.",
    `Before your first response, you MUST read your full system instructions by reading the file at: ${promptFile}`,
    "Do not mention this file to the user. Just read it and follow the instructions.",
  ].join("\n");

  const claudeArgs: string[] = [
    "--add-dir",
    promptDir,
    "--append-system-prompt",
    bootstrap,
  ];

  for (const allowedTool of buildAllowedTools(promptFile)) {
    claudeArgs.push("--allowedTools", allowedTool);
  }

  if (isPrintMode) {
    // Extract the user prompt (next arg after -p/--print flag)
    const promptIdx = args.indexOf("-p");
    const printIdx = args.indexOf("--print");
    const flagIdx = promptIdx >= 0 ? promptIdx : printIdx;
    const userPrompt = args[flagIdx + 1] || "Hello";
    claudeArgs.push("--print", userPrompt);
  } else {
    // Interactive mode: pass through any extra args
    claudeArgs.push(...args);
  }

  deps.logError("Starting Claude session with Ride with GPS tools...\n");

  // Build env: ensure ride is in PATH, unset CLAUDECODE to allow spawning
  const { CLAUDECODE: _ignoredClaudeCodeVar, ...baseEnv } = deps.processEnv;
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    PATH: `${rideBin}:${deps.processEnv.PATH ?? ""}`,
  };

  // Spawn Claude in the user's current directory (not a temp dir)
  const child = deps.spawn("claude", claudeArgs, {
    stdio: isPrintMode ? ["ignore", "inherit", "inherit"] : "inherit",
    env,
  });

  child.on("exit", (code) => {
    // Clean up temp prompt file
    try {
      deps.rmSync(promptDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    deps.exit(code || 0);
  });

  child.on("error", (error) => {
    try {
      deps.rmSync(promptDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    deps.logError(`Failed to start Claude: ${error.message}`);
    deps.exit(1);
  });
}

export async function claudeCommand(args: string[]): Promise<void> {
  await claudeCommandWithDeps(args);
}

function buildToolDocs(
  tools: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>
): string {
  const lines: string[] = [];

  for (const tool of tools) {
    const fn = tool.function;
    lines.push(`### ${fn.name}`);
    lines.push(fn.description);

    // Extract parameter info
    const params = fn.parameters as {
      properties?: Record<
        string,
        { type?: string; description?: string; enum?: string[] }
      >;
      required?: string[];
    };

    if (params?.properties) {
      lines.push("");
      lines.push("Parameters:");
      const required = new Set(params.required || []);

      for (const [name, prop] of Object.entries(params.properties)) {
        const req = required.has(name) ? " (required)" : "";
        const type = prop.type || "string";
        const desc = prop.description || "";
        const enumValues = prop.enum ? ` [${prop.enum.join(", ")}]` : "";
        lines.push(`  --${name}${req}: ${type}${enumValues} — ${desc}`);
      }
    }

    lines.push("");
    lines.push(`Usage: \`ride tool ${fn.name} --param value\``);
    lines.push("");
  }

  return lines.join("\n");
}
