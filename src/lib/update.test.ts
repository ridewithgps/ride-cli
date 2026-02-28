import { describe, expect, test } from "bun:test";
import {
  isUpgradeAccepted,
  shouldCheckForUpdates,
  shouldPromptForUpgrade,
} from "./update.js";

describe("shouldCheckForUpdates", () => {
  test("skips non-runtime commands and options", () => {
    expect(shouldCheckForUpdates("upgrade")).toBe(false);
    expect(shouldCheckForUpdates("login")).toBe(false);
    expect(shouldCheckForUpdates("--help")).toBe(false);
    expect(shouldCheckForUpdates("-V")).toBe(false);
  });

  test("checks updates for normal startup and runtime flags", () => {
    expect(shouldCheckForUpdates(undefined)).toBe(true);
    expect(shouldCheckForUpdates("status")).toBe(true);
    expect(shouldCheckForUpdates("--continue")).toBe(true);
  });
});

describe("shouldPromptForUpgrade", () => {
  test("prompts only for interactive Claude startup", () => {
    expect(shouldPromptForUpgrade([], true)).toBe(true);
    expect(shouldPromptForUpgrade(["--continue"], true)).toBe(true);
    expect(shouldPromptForUpgrade(["status"], true)).toBe(false);
    expect(shouldPromptForUpgrade(["tool", "list"], true)).toBe(false);
    expect(shouldPromptForUpgrade([], false)).toBe(false);
  });
});

describe("isUpgradeAccepted", () => {
  test("accepts empty and yes answers", () => {
    expect(isUpgradeAccepted("")).toBe(true);
    expect(isUpgradeAccepted("y")).toBe(true);
    expect(isUpgradeAccepted("Y")).toBe(true);
    expect(isUpgradeAccepted(" yes ")).toBe(true);
  });

  test("rejects non-yes answers", () => {
    expect(isUpgradeAccepted("n")).toBe(false);
    expect(isUpgradeAccepted("no")).toBe(false);
    expect(isUpgradeAccepted("later")).toBe(false);
  });
});
