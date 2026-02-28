import { describe, expect, test } from "bun:test";
import { isOutdated, isValidVersion } from "./version.js";

describe("isValidVersion", () => {
  test("accepts semantic versions with optional v prefix", () => {
    expect(isValidVersion("1.2.3")).toBe(true);
    expect(isValidVersion("v1.2.3")).toBe(true);
    expect(isValidVersion("1.2.3-beta.1")).toBe(true);
  });

  test("rejects placeholders and malformed versions", () => {
    expect(isValidVersion("__VERSION__")).toBe(false);
    expect(isValidVersion("1.2")).toBe(false);
    expect(isValidVersion("abc")).toBe(false);
  });
});

describe("isOutdated", () => {
  test("compares major/minor/patch correctly", () => {
    expect(isOutdated("1.2.3", "1.2.4")).toBe(true);
    expect(isOutdated("1.2.3", "1.3.0")).toBe(true);
    expect(isOutdated("1.2.3", "2.0.0")).toBe(true);
    expect(isOutdated("2.0.0", "1.9.9")).toBe(false);
    expect(isOutdated("1.2.3", "1.2.3")).toBe(false);
  });

  test("returns false when either version is invalid", () => {
    expect(isOutdated("__VERSION__", "1.0.0")).toBe(false);
    expect(isOutdated("1.0.0", "invalid")).toBe(false);
  });
});
