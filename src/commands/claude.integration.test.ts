import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { claudeCommandWithDeps } from "./claude.js";

type SpawnFn = typeof import("node:child_process").spawn;

describe("claudeCommand integration", () => {
  test("ask mode launches claude with --print and allowed tool scope", async () => {
    const spawnMock = mock(
      (_cmd: string, _args: string[], _options: Record<string, unknown>) => {
        return new EventEmitter() as unknown as ChildProcess;
      }
    );
    const getPromptMock = mock(async () => {
      return {
        prompt: "You are Cadence.",
        conversation_id: 42,
        tools: [
          {
            type: "function",
            function: {
              name: "search_my_rides",
              description: "Search rides",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Search query",
                  },
                },
                required: ["query"],
              },
            },
          },
        ],
      };
    });

    await claudeCommandWithDeps(["--print", "How hilly was my last ride?"], {
      isClaudeInstalled: () => true,
      getPrompt: getPromptMock,
      spawn: spawnMock as unknown as SpawnFn,
      processArgv0: "/usr/local/bin/ride",
      processEnv: { ...process.env, CLAUDECODE: "1", PATH: "/usr/bin:/bin" },
      logError: () => {},
      exit: ((code?: number) => {
        throw new Error(`Unexpected exit(${String(code)})`);
      }) as (code?: number) => never,
    });

    expect(getPromptMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [command, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { env?: NodeJS.ProcessEnv; stdio?: unknown }
    ];

    expect(command).toBe("claude");
    expect(args).toContain("--add-dir");
    const addDirFlagIndex = args.indexOf("--add-dir");
    expect(addDirFlagIndex).toBeGreaterThanOrEqual(0);
    const addDirValue = args[addDirFlagIndex + 1];
    expect(addDirValue).toContain("ride-cli-");
    const promptFile = join(addDirValue, "system-prompt.md");
    const systemPrompt = readFileSync(promptFile, "utf-8");
    expect(systemPrompt).toContain("## Public API v1 (On-Demand)");
    expect(systemPrompt).toContain("ride api docs find <query>");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("--allowedTools");
    const allowedToolValues = args
      .map((arg, index) => (arg === "--allowedTools" ? args[index + 1] : null))
      .filter((value): value is string => typeof value === "string");
    expect(allowedToolValues).toEqual(
      expect.arrayContaining(["Bash(ride tool:*)", "Bash(ride api:*)"])
    );
    expect(allowedToolValues.some((value) => value.startsWith("Read("))).toBe(
      true
    );
    expect(args).toEqual(
      expect.arrayContaining(["--print", "How hilly was my last ride?"])
    );
    expect(options.stdio).toEqual(["ignore", "inherit", "inherit"]);
    expect(options.env?.PATH).toBeDefined();
    expect(options.env?.CLAUDECODE).toBeUndefined();
  });

  test("interactive mode forwards extra cli args", async () => {
    const spawnMock = mock(
      (_cmd: string, _args: string[], _options: Record<string, unknown>) => {
        return new EventEmitter() as unknown as ChildProcess;
      }
    );

    await claudeCommandWithDeps(["--model", "sonnet", "--continue"], {
      isClaudeInstalled: () => true,
      getPrompt: async () => ({
        prompt: "You are Cadence.",
        conversation_id: 1,
        tools: [],
      }),
      spawn: spawnMock as unknown as SpawnFn,
      processArgv0: "/usr/local/bin/ride",
      processEnv: { ...process.env, PATH: "/usr/bin:/bin" },
      logError: () => {},
      exit: ((code?: number) => {
        throw new Error(`Unexpected exit(${String(code)})`);
      }) as (code?: number) => never,
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { stdio?: unknown }
    ];

    expect(args).toEqual(
      expect.arrayContaining(["--model", "sonnet", "--continue"])
    );
    expect(options.stdio).toBe("inherit");
  });
});
