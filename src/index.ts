#!/usr/bin/env bun
/**
 * ride — Ride with GPS CLI
 *
 * Claude Code integration for cycling intelligence.
 * Provides authenticated access to RWGPS tools and data.
 *
 * Commands:
 *   ride                    Interactive Claude session with RWGPS tools
 *   ride login              Authenticate with Ride with GPS
 *   ride logout             Clear credentials
 *   ride status             Show auth + system info
 *   ride tool <name>        Execute a tool (list with 'ride tool list')
 *   ride api <...>          Call public API v1 endpoints
 *   ride ask <prompt>       Non-interactive Claude query
 *   ride upgrade            Update to latest version
 */

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { isAuthenticated } from "./lib/config.js";
import { CURRENT_VERSION, checkForUpdate } from "./lib/version.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { statusCommand } from "./commands/status.js";
import { toolCommand } from "./commands/tool.js";
import { claudeCommand } from "./commands/claude.js";
import { upgradeCommand } from "./commands/upgrade.js";
import { apiCommand, type ApiCommandOptions } from "./commands/api.js";
import {
  apiDocsListCommand,
  apiDocsFindCommand,
  apiDocsShowCommand,
  type ApiDocsCommandOptions,
} from "./commands/api-docs.js";
import { shouldRunClaudeDirectly } from "./lib/invocation.js";
import {
  isUpgradeAccepted,
  shouldCheckForUpdates,
  shouldPromptForUpgrade,
} from "./lib/update.js";

const program = new Command();

program
  .name("ride")
  .description("Ride with GPS CLI — cycling intelligence powered by Claude")
  .version(CURRENT_VERSION)
  .enablePositionalOptions();

// Login
program
  .command("login")
  .description("Authenticate with Ride with GPS")
  .option("--no-browser", "Do not try to open a browser automatically")
  .option("--reauth", "Force a fresh OAuth login even if already authenticated")
  .action(async (options: { noBrowser?: boolean; reauth?: boolean }) => {
    try {
      await loginCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Login failed");
      process.exit(1);
    }
  });

// Logout
program
  .command("logout")
  .description("Clear stored credentials")
  .action(() => {
    logoutCommand();
  });

// Status
program
  .command("status")
  .description("Show authentication and system status")
  .action(() => {
    statusCommand();
  });

// Tool
program
  .command("tool")
  .description("Execute a Ride with GPS tool")
  .argument("<name>", "Tool name (or 'list' to see available tools)")
  .argument("[args...]", "Tool arguments (--key value pairs)")
  .allowUnknownOption()
  .passThroughOptions()
  .action(async (name: string, args: string[]) => {
    requireAuth();
    try {
      await toolCommand(name, args);
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Tool execution failed"
      );
      process.exit(1);
    }
  });

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function addApiOptions(command: Command): Command {
  return command
    .option(
      "-q, --query <key=value>",
      "Query parameter (repeatable)",
      collect,
      [] as string[]
    )
    .option(
      "-H, --header <name:value>",
      "Request header (repeatable)",
      collect,
      [] as string[]
    )
    .option("--json <json|@file>", "JSON request body")
    .option("--data <text|@file>", "Raw request body");
}

async function runApiCommand(
  method: string,
  path: string,
  options: ApiCommandOptions
): Promise<void> {
  requireAuth();
  await apiCommand(method, path, options);
}

const api = program
  .command("api")
  .description("Call the Ride with GPS public API v1");

addApiOptions(
  api
    .command("request")
    .description("Send an API request")
    .argument("<method>", "HTTP method")
    .argument("<path>", "API path, must start with /api/v1")
).action(async (method: string, path: string, options: ApiCommandOptions) => {
  try {
    await runApiCommand(method, path, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "API request failed");
    process.exit(1);
  }
});

for (const method of ["get", "post", "put", "patch", "delete"]) {
  addApiOptions(
    api
      .command(method)
      .description(`${method.toUpperCase()} request to /api/v1`)
      .argument("<path>", "API path, must start with /api/v1")
  ).action(async (path: string, options: ApiCommandOptions) => {
    try {
      await runApiCommand(method, path, options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "API request failed");
      process.exit(1);
    }
  });
}

function parseLimitOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  return parsed;
}

const docs = api
  .command("docs")
  .description("Browse API endpoint documentation from OpenAPI");

docs
  .command("list")
  .description("List available API operations")
  .option("--refresh", "Bypass cache and re-fetch OpenAPI spec")
  .option("--limit <n>", "Max operations to show", parseLimitOption)
  .action(async (options: ApiDocsCommandOptions) => {
    requireAuth();
    try {
      await apiDocsListCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "API docs failed");
      process.exit(1);
    }
  });

docs
  .command("find")
  .description("Search API operations by keyword")
  .argument("<query>", "Search text (for example: routes or users current)")
  .option("--refresh", "Bypass cache and re-fetch OpenAPI spec")
  .option("--limit <n>", "Max matches to show", parseLimitOption)
  .action(async (query: string, options: ApiDocsCommandOptions) => {
    requireAuth();
    try {
      await apiDocsFindCommand(query, options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "API docs failed");
      process.exit(1);
    }
  });

docs
  .command("show")
  .description("Show details for one API operation")
  .argument("<method>", "HTTP method")
  .argument("<path>", "Endpoint path (for example: /api/v1/routes/{id}.json)")
  .option("--refresh", "Bypass cache and re-fetch OpenAPI spec")
  .action(
    async (method: string, path: string, options: ApiDocsCommandOptions) => {
      requireAuth();
      try {
        await apiDocsShowCommand(method, path, options);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "API docs failed");
        process.exit(1);
      }
    }
  );

// Ask (non-interactive)
program
  .command("ask")
  .description("Ask a question (non-interactive, outputs to stdout)")
  .argument("<prompt>", "Your question")
  .action(async (prompt: string) => {
    requireAuth();
    try {
      await claudeCommand(["--print", prompt]);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Ask failed");
      process.exit(1);
    }
  });

// Upgrade
program
  .command("upgrade")
  .description("Update ride to the latest version")
  .action(async () => {
    try {
      await upgradeCommand();
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Upgrade failed"
      );
      process.exit(1);
    }
  });

function requireAuth(): void {
  if (!isAuthenticated()) {
    console.error("Not authenticated. Run 'ride login' first.");
    process.exit(1);
  }
}

async function promptForUpgrade(latest: string): Promise<boolean> {
  const prompt = `  Update available: ride v${CURRENT_VERSION} -> v${latest}. Upgrade now? [Y/n] `;
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question(prompt);
    return isUpgradeAccepted(answer);
  } finally {
    rl.close();
  }
}

// Update check: may prompt on interactive startup, otherwise warns.
async function maybeHandleUpdate(
  command: string | undefined,
  args: string[]
): Promise<void> {
  if (!shouldCheckForUpdates(command)) {
    return;
  }

  try {
    const latest = await checkForUpdate();
    if (!latest) {
      return;
    }

    const isInteractiveTerminal = !!process.stdin.isTTY && !!process.stderr.isTTY;
    if (shouldPromptForUpgrade(args, isInteractiveTerminal)) {
      console.error("");
      if (await promptForUpgrade(latest)) {
        console.error("");
        await upgradeCommand();
        console.error("  Restart ride to use the updated version.");
        console.error("");
        process.exit(0);
      }
      console.error("  Continuing without upgrade.");
      console.error("");
      return;
    }

    console.error("");
    console.error(
      `  Update available: ride v${CURRENT_VERSION} -> v${latest}`
    );
    console.error("  Run 'ride upgrade' to update.");
    console.error("");
  } catch {
    // Ignore update-check failures; they should not block commands.
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (shouldRunClaudeDirectly(args)) {
    await maybeHandleUpdate(command, args);
    requireAuth();
    try {
      await claudeCommand(args);
      return;
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Failed to start session"
      );
      process.exit(1);
    }
  }

  await maybeHandleUpdate(command, args);
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : "Unexpected CLI failure";
  console.error(message);
  process.exit(1);
});
