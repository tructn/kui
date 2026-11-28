import { describe, expect, test } from "bun:test";

import { previewLine } from "./format";

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
