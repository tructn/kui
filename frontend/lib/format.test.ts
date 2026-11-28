import { describe, expect, test } from "bun:test";

import { formatDateTime, formatTimestamp, previewLine } from "./format";

describe("previewLine", () => {
  test("collapses a pretty-printed tree onto one line", () => {
    const tree = JSON.stringify({ a: { b: [1, 2] } }, null, 2);
    expect(previewLine(tree)).toBe('{ "a": { "b": [ 1, 2 ] } }');
  });

  test("leaves short text whole", () => {
    expect(previewLine("hello")).toBe("hello");
  });

  test("cuts long text and marks the cut", () => {
    const out = previewLine("x".repeat(5000), 100);
    expect(out).toBe(`${"x".repeat(100)}…`);
  });
});

describe("times are UTC", () => {
  const at = Date.UTC(2026, 9, 12, 8, 15, 2, 123);

  test("formatTimestamp keeps milliseconds", () => {
    expect(formatTimestamp(at)).toBe("2026-10-12 08:15:02.123 UTC");
    expect(formatTimestamp(null)).toBe("—");
  });

  test("formatDateTime stops at the second", () => {
    expect(formatDateTime(at)).toBe("2026-10-12 08:15:02 UTC");
  });
});
