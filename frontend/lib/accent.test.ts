import { describe, expect, test } from "bun:test";

import { isAccent, readableForeground } from "./accent";

describe("isAccent", () => {
  test("accepts presets and #rrggbb colors", () => {
    expect(isAccent("blue")).toBe(true);
    expect(isAccent("#1A2b3C")).toBe(true);
  });

  test("rejects anything else", () => {
    for (const value of ["purple", "#abc", "#12345g", "toString", null, 3]) expect(isAccent(value)).toBe(false);
  });
});

describe("readableForeground", () => {
  test("white text on dark and mid-tone colors", () => {
    // Navy, blue-500, orange-500, red-500, purple-500.
    for (const hex of ["#1e3a8a", "#3b82f6", "#f97316", "#ef4444", "#a855f7"])
      expect(readableForeground(hex)).toBe("oklch(0.985 0 0)");
  });

  test("dark text on light colors", () => {
    for (const hex of ["#fde047", "#a3e635", "#ffffff", "#bae6fd"]) expect(readableForeground(hex)).toBe("oklch(0.205 0 0)");
  });
});
