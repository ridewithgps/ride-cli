import { describe, expect, test } from "bun:test";
import { parseCliValue, parseToolArgs } from "./tool-args.js";

describe("parseCliValue", () => {
  test("parses numeric, boolean, null, and JSON values", () => {
    expect(parseCliValue("42")).toBe(42);
    expect(parseCliValue("-7")).toBe(-7);
    expect(parseCliValue("3.14")).toBe(3.14);
    expect(parseCliValue("1e3")).toBe(1000);
    expect(parseCliValue("true")).toBe(true);
    expect(parseCliValue("false")).toBe(false);
    expect(parseCliValue("null")).toBeNull();
    expect(parseCliValue("[1,2,3]")).toEqual([1, 2, 3]);
  });

  test("keeps invalid JSON as string", () => {
    expect(parseCliValue("{broken")).toBe("{broken");
  });
});

describe("parseToolArgs", () => {
  test("parses --key value and --key=value pairs", () => {
    expect(
      parseToolArgs([
        "--ride_id",
        "123",
        "--verbose",
        "--include=power",
        "--include=hr",
      ])
    ).toEqual({
      ride_id: 123,
      verbose: true,
      include: "hr",
    });
  });

  test("maps a single positional argument to query", () => {
    expect(parseToolArgs(["gravel rides near me"])).toEqual({
      query: "gravel rides near me",
    });
  });

  test("uses object JSON as argument payload", () => {
    expect(parseToolArgs(['{"ride_id": 101, "include_power": true}'])).toEqual({
      ride_id: 101,
      include_power: true,
    });
  });

  test("preserves extra positional args when named args are present", () => {
    expect(parseToolArgs(["--limit", "10", "extra", "terms"])).toEqual({
      limit: 10,
      _args: ["extra", "terms"],
    });
  });

  test("maps multiple positional args to args array", () => {
    expect(parseToolArgs(["1", "2", "3"])).toEqual({
      args: [1, 2, 3],
    });
  });
});
