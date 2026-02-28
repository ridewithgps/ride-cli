import { describe, expect, test } from "bun:test";
import { shouldRunClaudeDirectly } from "./invocation.js";

describe("shouldRunClaudeDirectly", () => {
  test("runs Claude directly with no args", () => {
    expect(shouldRunClaudeDirectly([])).toBe(true);
  });

  test("keeps built-in commands in ride", () => {
    expect(shouldRunClaudeDirectly(["login"])).toBe(false);
    expect(shouldRunClaudeDirectly(["status"])).toBe(false);
    expect(shouldRunClaudeDirectly(["tool"])).toBe(false);
    expect(shouldRunClaudeDirectly(["api"])).toBe(false);
    expect(shouldRunClaudeDirectly(["help"])).toBe(false);
  });

  test("keeps ride help/version options in ride", () => {
    expect(shouldRunClaudeDirectly(["--help"])).toBe(false);
    expect(shouldRunClaudeDirectly(["-h"])).toBe(false);
    expect(shouldRunClaudeDirectly(["--version"])).toBe(false);
    expect(shouldRunClaudeDirectly(["-V"])).toBe(false);
  });

  test("passes unknown/claude flags straight through", () => {
    expect(shouldRunClaudeDirectly(["--continue"])).toBe(true);
    expect(shouldRunClaudeDirectly(["--dangerously-skip-permissions"])).toBe(
      true
    );
    expect(shouldRunClaudeDirectly(["--model", "sonnet"])).toBe(true);
  });
});
