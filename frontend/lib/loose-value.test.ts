import { describe, expect, it } from "bun:test";

import { formatLooseValue, parseLooseValue } from "./loose-value";

describe("parseLooseValue", () => {
  it("reads JSON scalars and structures, and anything else as text", () => {
    expect(parseLooseValue("42")).toBe(42);
    expect(parseLooseValue("true")).toBe(true);
    expect(parseLooseValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseLooseValue("kafka")).toBe("kafka");
    expect(parseLooseValue('"42"')).toBe("42");
  });

  it("treats blank as no value", () => {
    expect(parseLooseValue("  ")).toBeNull();
  });
});

describe("formatLooseValue", () => {
  it("round-trips every kind of value", () => {
    for (const value of [42, true, { a: 1 }, ["x"], "kafka", "42", "true", "has space"]) {
      expect(parseLooseValue(formatLooseValue(value))).toEqual(value);
    }
  });

  it("shows nothing for no value", () => {
    expect(formatLooseValue(null)).toBe("");
    expect(formatLooseValue(undefined)).toBe("");
  });
});
